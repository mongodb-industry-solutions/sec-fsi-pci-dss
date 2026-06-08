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
  'setup:db:drop':     ['run', 'setup:db:drop'],
  'setup:db:check':    ['run', 'setup:db:check'],
};

type RateLimitStore = Map<string, { count: number; reset: number }>;

function makeRateLimiter(maxRequests: number, windowMs: number) {
  const store: RateLimitStore = new Map();
  return function check(ip: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const entry = store.get(ip);
    if (!entry || entry.reset < now) {
      store.set(ip, { count: 1, reset: now + windowMs });
      return { allowed: true };
    }
    if (entry.count >= maxRequests) {
      return { allowed: false, retryAfter: Math.ceil((entry.reset - now) / 1000) };
    }
    entry.count++;
    return { allowed: true };
  };
}

// Strict: login endpoint  -  10 attempts per 15 min (brute-force protection)
const checkLoginRateLimit = makeRateLimiter(10, 15 * 60 * 1000);
// Lenient: command/exec/logs/system  -  300 requests per 15 min (demo usage)
const checkOpsRateLimit   = makeRateLimiter(300, 15 * 60 * 1000);

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
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  });
  reply.raw.flushHeaders();
}

export async function adminController(fastify: FastifyInstance) {

  // POST /admin/login
  fastify.post('/login', {
    schema: {
      tags: ['admin'],
      summary: 'Obtain an admin JWT',
      description: 'Validates username and password. Returns a JWT valid for 4 hours.',
      security: [],
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', description: 'Admin username (matches ADM_USER env var).' },
          password: { type: 'string', description: 'Plaintext password (server computes SHA-256 and compares against ADM_PASS).' },
        },
      },
      response: {
        200: {
          description: 'Login successful.',
          type: 'object',
          properties: {
            token: { type: 'string', description: 'Admin JWT. Valid 4 hours. Pass as Bearer token to other /admin/* endpoints.' },
          },
        },
        401: { $ref: 'Error#', description: 'Invalid credentials.' },
        429: { $ref: 'Error#', description: 'Too many attempts. Try again later.' },
        503: { $ref: 'Error#', description: 'Admin credentials not configured (production mode).' },
      },
    },
  }, async (request, reply) => {
    const ip = request.ip ?? 'unknown';
    const rl = checkLoginRateLimit(ip);
    if (!rl.allowed) {
      reply.header('Retry-After', String(rl.retryAfter));
      return reply.status(429).send({ error: `Too many login attempts. Retry after ${rl.retryAfter}s.` });
    }

    const { username, password } = request.body as { username: string; password: string };
    if (process.env.NODE_ENV === 'production' && (!process.env.ADM_USER || !process.env.ADM_PASS)) {
      return reply.status(503).send({ error: 'Admin credentials not configured. Set ADM_USER and ADM_PASS environment variables.' });
    }
    const admUser = process.env.ADM_USER ?? 'admin';
    const admPass = process.env.ADM_PASS ?? sha256('admin');

    if (username !== admUser || sha256(password) !== admPass) {
      return reply.status(401).send({ error: 'Invalid admin credentials' });
    }

    const token = jwt.sign({ sub: 'admin', role: 'admin' }, jwtSecret(), { expiresIn: '4h' });
    appendLog(`[admin] Login successful for: ${username}`);
    return reply.send({ token });
  });

  // POST /admin/run
  fastify.post('/run', {
    schema: {
      tags: ['admin'],
      summary: 'Run a predefined npm script (SSE output)',
      description: 'Executes a predefined npm script from the project root and streams output via Server-Sent Events.',
      security: [{ adminAuth: [] }],
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
    const ip = request.ip ?? 'unknown';
    const rl = checkOpsRateLimit(ip);
    if (!rl.allowed) {
      reply.header('Retry-After', String(rl.retryAfter));
      return reply.status(429).send({ error: `Too many requests. Retry after ${rl.retryAfter}s.` });
    }
    if (!verifyAdminToken(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Invalid admin token' });
    }
    const { command } = request.body as { command: string };
    const args = ALLOWED_NPM_COMMANDS[command];
    if (!args) return reply.status(400).send({ error: 'Unknown command' });

    beginSSE(reply);
    await spawnSSE(reply.raw, 'npm', args, PROJECT_ROOT, `npm:${command}`);
  });

  // POST /admin/exec
  fastify.post('/exec', {
    schema: {
      tags: ['admin'],
      summary: 'Execute any shell command (SSE output)',
      description: 'Runs an arbitrary shell command in the project root and streams stdout/stderr via Server-Sent Events.',
      security: [{ adminAuth: [] }],
      body: {
        type: 'object',
        required: ['command'],
        properties: {
          command: { type: 'string', description: 'Full shell command to execute, e.g. `ls -la`.' },
          cwd: { type: 'string', description: 'Working directory (default: project root).' },
        },
      },
    },
  }, async (request, reply) => {
    const ip = request.ip ?? 'unknown';
    const rl = checkOpsRateLimit(ip);
    if (!rl.allowed) {
      reply.header('Retry-After', String(rl.retryAfter));
      return reply.status(429).send({ error: `Too many requests. Retry after ${rl.retryAfter}s.` });
    }
    if (process.env.NODE_ENV === 'production') {
      return reply.status(403).send({ error: '/admin/exec is disabled in production' });
    }
    if (!verifyAdminToken(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Invalid admin token' });
    }
    const { command, cwd } = request.body as { command: string; cwd?: string };
    if (!command?.trim()) return reply.status(400).send({ error: 'command is required' });

    const resolvedRoot = path.resolve(PROJECT_ROOT);
    const requestedCwd = cwd?.trim() ? path.resolve(cwd.trim()) : resolvedRoot;
    if (!requestedCwd.startsWith(resolvedRoot)) {
      return reply.status(400).send({ error: 'cwd must be within the project directory' });
    }
    const workDir = requestedCwd;

    beginSSE(reply);
    await spawnSSE(reply.raw, command, [], workDir, `exec`);
  });

  // GET /admin/logs
  fastify.get('/logs', {
    schema: {
      tags: ['admin'],
      summary: 'Stream server request log ring-buffer via SSE',
      description: 'Sends the current log buffer snapshot (up to 500 entries) then polls every 2s for new entries.',
      security: [{ adminAuth: [] }],
    },
  }, async (request, reply) => {
    const ip = request.ip ?? 'unknown';
    const rl = checkOpsRateLimit(ip);
    if (!rl.allowed) {
      reply.header('Retry-After', String(rl.retryAfter));
      return reply.status(429).send({ error: `Too many requests. Retry after ${rl.retryAfter}s.` });
    }
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

  // GET /admin/system
  fastify.get('/system', {
    schema: {
      tags: ['admin'],
      summary: 'System information (OS, Node.js, package.json, env vars)',
      description: 'Returns a snapshot of the runtime environment. Sensitive env var values are masked with `***`.',
      security: [{ adminAuth: [] }],
      response: {
        200: {
          description: 'System information.',
          type: 'object',
          properties: {
            os:      { type: 'object', additionalProperties: true },
            node:    { type: 'object', additionalProperties: true },
            package: { type: 'object', additionalProperties: true },
            env:     { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
        401: { $ref: 'Error#' },
        429: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const ip = request.ip ?? 'unknown';
    const rl = checkOpsRateLimit(ip);
    if (!rl.allowed) {
      reply.header('Retry-After', String(rl.retryAfter));
      return reply.status(429).send({ error: `Too many requests. Retry after ${rl.retryAfter}s.` });
    }
    if (!verifyAdminToken(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Invalid admin token' });
    }

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

    const nodeInfo = {
      version: process.version,
      execPath: process.execPath,
      pid: process.pid,
      cwd: process.cwd(),
      projectRoot: PROJECT_ROOT,
      uptimeSeconds: Math.round(process.uptime()),
    };

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

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) {
        env[k] = isSensitiveKey(k) ? '***' : v;
      }
    }

    return reply.send({ os: osInfo, node: nodeInfo, package: pkgInfo, env });
  });
}
