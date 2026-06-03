import { FastifyInstance } from 'fastify';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as os from 'os';
import * as fs from 'fs';
import { spawn } from 'child_process';
import * as path from 'path';
import { logBuffer, appendLog } from '../../../shared/logBuffer';

// __dirname = backend/src/modules/admin/controllers/ (tsx dev mode)
// 5 levels up -> project root
const PROJECT_ROOT = path.resolve(__dirname, '../../../../../');

// Env var keys whose values should be masked in the system-info endpoint
const SENSITIVE_KEY_PATTERNS = [
  /secret/i, /password/i, /passwd/i, /pass/i, /key/i,
  /token/i, /uri/i, /url/i, /dsn/i, /credential/i,
  /aws_/i, /mongo/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((r) => r.test(key));
}

const ALLOWED_NPM_COMMANDS: Record<string, string[]> = {
  'setup':             ['run', 'setup'],
  'setup:key':         ['run', 'setup:key'],
  'setup:db':          ['run', 'setup:db'],
  'setup:generate':    ['run', 'setup:generate'],
  'setup:seed':        ['run', 'setup:seed'],
  'test':              ['run', 'test'],
  'test:unit':         ['run', 'test:unit'],
  'test:integration':  ['run', 'test:integration'],
  'type-check':        ['run', 'type-check'],
};

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function jwtSecret(): string {
  return process.env.JWT_SECRET ?? 'demo-local-secret-change-in-production';
}

function verifyAdminToken(authHeader: string | undefined): boolean {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, jwtSecret()) as jwt.JwtPayload;
    return payload.role === 'admin';
  } catch {
    return false;
  }
}

function spawnSSE(
  raw: NodeJS.WritableStream,
  command: string,
  args: string[],
  cwd: string,
  label: string,
): Promise<void> {
  const sendEvent = (type: string, data: string) => {
    raw.write(`event: ${type}\ndata: ${JSON.stringify({ text: data })}\n\n`);
    appendLog(`[${label}] ${data}`);
  };

  sendEvent('start', `> ${command} ${args.join(' ')}  (cwd: ${cwd})`);

  const child = spawn(command, args, {
    cwd,
    shell: true,
    env: { ...process.env },
  });

  return new Promise((resolve) => {
    child.stdout.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').filter(Boolean).forEach((l) => sendEvent('log', l));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').filter(Boolean).forEach((l) => sendEvent('error', l));
    });
    child.on('close', (code) => {
      sendEvent('done', `Process exited with code ${code ?? 0}`);
      (raw as import('http').ServerResponse).end?.();
      resolve();
    });
    child.on('error', (err) => {
      sendEvent('error', `Failed to start: ${err.message}`);
      (raw as import('http').ServerResponse).end?.();
      resolve();
    });
  });
}

function beginSSE(reply: import('fastify').FastifyReply) {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  reply.raw.flushHeaders();
}

export async function adminController(fastify: FastifyInstance) {

  // ── POST /admin/login ─────────────────────────────────────────────────────
  fastify.post('/login', {
    schema: {
      tags: ['admin'],
      summary: 'Obtain an admin JWT (SHA-256 password check)',
      description: [
        'Validates `username` against `ADM_USER` and `sha256(password)` against `ADM_PASS`.',
        'Returns a JWT with `{ role: "admin" }` valid for 4 hours.',
        'Pass this token as `Authorization: Bearer <token>` to all other `/admin/*` endpoints.',
      ].join(' '),
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', description: 'Admin username (matches ADM_USER env var).' },
          password: { type: 'string', description: 'Plaintext password. Server computes SHA-256 and compares against ADM_PASS.' },
        },
      },
      response: {
        200: {
          description: 'Login successful.',
          type: 'object',
          properties: {
            token: { type: 'string', description: 'Admin JWT. Valid 4 h. Pass as Bearer token.' },
          },
        },
        401: { $ref: 'Error#', description: 'Invalid credentials.' },
      },
    },
  }, async (request, reply) => {
    const { username, password } = request.body as { username: string; password: string };
    const admUser = process.env.ADM_USER ?? 'admin';
    const admPass = process.env.ADM_PASS ?? sha256('admin');

    if (username !== admUser || sha256(password) !== admPass) {
      return reply.status(401).send({ error: 'Invalid admin credentials' });
    }

    const token = jwt.sign({ sub: 'admin', role: 'admin' }, jwtSecret(), { expiresIn: '4h' });
    appendLog(`[admin] Login successful for: ${username}`);
    return reply.send({ token });
  });

  // ── POST /admin/run ───────────────────────────────────────────────────────
  fastify.post('/run', {
    schema: {
      tags: ['admin'],
      summary: 'Run a predefined npm script (SSE output)',
      description: [
        'Executes a predefined npm script from the project root and streams stdout/stderr',
        'line by line via Server-Sent Events. Uses `shell: true` for cross-platform',
        'compatibility (cmd.exe on Windows, /bin/sh on Linux/macOS).',
        '',
        'Requires `Authorization: Bearer <admin-jwt>` (obtain via `POST /admin/login`).',
      ].join('\n'),
      body: {
        type: 'object',
        required: ['command'],
        properties: {
          command: {
            type: 'string',
            enum: Object.keys(ALLOWED_NPM_COMMANDS),
            description: 'One of the predefined npm scripts.',
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!verifyAdminToken(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Invalid admin token' });
    }
    const { command } = request.body as { command: string };
    const args = ALLOWED_NPM_COMMANDS[command];
    if (!args) return reply.status(400).send({ error: 'Unknown command' });

    beginSSE(reply);
    await spawnSSE(reply.raw, 'npm', args, PROJECT_ROOT, `npm:${command}`);
  });

  // ── POST /admin/exec ──────────────────────────────────────────────────────
  fastify.post('/exec', {
    schema: {
      tags: ['admin'],
      summary: 'Execute any shell command (SSE output)',
      description: [
        'Runs an arbitrary shell command in the project root directory and streams',
        'stdout/stderr via Server-Sent Events. The command is passed to the OS shell',
        '(`cmd.exe /d /s /c` on Windows, `/bin/sh -c` on Linux/macOS).',
        '',
        'Requires `Authorization: Bearer <admin-jwt>`.',
        '',
        '**Security note:** This endpoint is intentionally unrestricted — it is protected',
        'only by admin credentials and is intended for demo environment management.',
      ].join('\n'),
      body: {
        type: 'object',
        required: ['command'],
        properties: {
          command: { type: 'string', description: 'Full shell command to execute, e.g. `ls -la` or `npm run setup:db`.' },
          cwd: { type: 'string', description: 'Working directory (default: project root).' },
        },
      },
    },
  }, async (request, reply) => {
    if (!verifyAdminToken(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Invalid admin token' });
    }
    const { command, cwd } = request.body as { command: string; cwd?: string };
    if (!command?.trim()) return reply.status(400).send({ error: 'command is required' });

    const workDir = cwd?.trim() || PROJECT_ROOT;

    beginSSE(reply);
    await spawnSSE(reply.raw, command, [], workDir, `exec`);
  });

  // ── GET /admin/logs ───────────────────────────────────────────────────────
  fastify.get('/logs', {
    schema: {
      tags: ['admin'],
      summary: 'Stream server request log ring-buffer via SSE',
      description: [
        'Sends the current log buffer snapshot (up to 500 entries) then polls every 2 s',
        'for new entries. Each SSE event is `event: log\\ndata: { "text": "..." }\\n\\n`.',
        '',
        'Requires `Authorization: Bearer <admin-jwt>`.',
      ].join('\n'),
    },
  }, async (request, reply) => {
    if (!verifyAdminToken(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Invalid admin token' });
    }

    beginSSE(reply);

    [...logBuffer].forEach((line) => {
      reply.raw.write(`event: log\ndata: ${JSON.stringify({ text: line })}\n\n`);
    });

    let lastLen = logBuffer.length;
    const interval = setInterval(() => {
      if (!reply.raw.writable) { clearInterval(interval); return; }
      const cur = logBuffer.length;
      if (cur > lastLen) {
        logBuffer.slice(lastLen).forEach((line) => {
          reply.raw.write(`event: log\ndata: ${JSON.stringify({ text: line })}\n\n`);
        });
        lastLen = cur;
      } else if (cur < lastLen) {
        lastLen = cur;
      }
    }, 2000);

    request.raw.on('close', () => clearInterval(interval));
    await new Promise<void>(() => { /* held open until client disconnects */ });
  });

  // ── GET /admin/system ─────────────────────────────────────────────────────
  fastify.get('/system', {
    schema: {
      tags: ['admin'],
      summary: 'System information (OS, Node.js, package.json, env vars)',
      description: [
        'Returns a snapshot of the runtime environment. Sensitive environment variable',
        'values are masked with `***`. Requires `Authorization: Bearer <admin-jwt>`.',
      ].join(' '),
      response: {
        200: {
          description: 'System information.',
          type: 'object',
          properties: {
            os:      { type: 'object' },
            node:    { type: 'object' },
            package: { type: 'object' },
            env:     { type: 'object' },
          },
        },
        401: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    if (!verifyAdminToken(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Invalid admin token' });
    }

    // OS info
    const osInfo = {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      hostname: os.hostname(),
      type: os.type(),
      cpus: os.cpus().length,
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
      uptime: Math.round(os.uptime()),
    };

    // Node.js info
    const nodeInfo = {
      version: process.version,
      execPath: process.execPath,
      pid: process.pid,
      cwd: process.cwd(),
      projectRoot: PROJECT_ROOT,
      uptimeSeconds: Math.round(process.uptime()),
    };

    // Root package.json
    let pkgInfo: Record<string, unknown> = {};
    try {
      const pkgPath = path.join(PROJECT_ROOT, 'package.json');
      const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      pkgInfo = {
        name: raw.name,
        version: raw.version,
        description: raw.description,
        scripts: raw.scripts ?? {},
        workspaces: raw.workspaces,
      };
    } catch {
      pkgInfo = { error: 'Could not read package.json' };
    }

    // Sanitized env vars
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) {
        env[k] = isSensitiveKey(k) ? '***' : v;
      }
    }

    return reply.send({ os: osInfo, node: nodeInfo, package: pkgInfo, env });
  });
}
