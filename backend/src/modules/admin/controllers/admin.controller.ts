import { FastifyInstance } from 'fastify';
import * as jwt from 'jsonwebtoken';
import * as os from 'os';
import * as fs from 'fs';
import { spawn, execSync } from 'child_process';
import * as path from 'path';
import { reloadDbRuntime } from '../../../plugins/mongodb';
import { logBuffer, appendLog, writeCount } from '../../../shared/services/logBuffer';
import { beginSSE } from '../../../shared/services/sse';
import { resolveTestStrategy, resolveTestSequence, aggregateSummaries, NormalizedTestSummary } from '../services/testRunners';
import { jwtSecret, sha256 } from '../../../vendors/encryption/digest';

// In Docker (compiled dist/), __dirname gains an extra /dist/ level that breaks
// the naïve 5-levels-up heuristic. PSP_PROJECT_ROOT overrides cleanly in any env.
const PROJECT_ROOT: string = process.env.PSP_PROJECT_ROOT
  || path.resolve(__dirname, '../../../../../');

const SENSITIVE_KEY_PATTERNS = [
  /secret/i, /password/i, /passwd/i, /pass/i, /key/i,
  /token/i, /uri/i, /url/i, /dsn/i, /credential/i,
  /aws_/i, /mongo/i,
];

// Non-secret vars that match a sensitive pattern and must be shown in plain text.
const SAFE_KEYS = new Set([
  'MONGODB_DB_NAME',
  'MONGODB_CRYPT_SHARED_LIB_PATH',
]);

function isSensitiveKey(key: string): boolean {
  if (SAFE_KEYS.has(key)) return false;
  return SENSITIVE_KEY_PATTERNS.some((r) => r.test(key));
}

/**
 * Returns true when the env var is a MongoDB connection string that should
 * have only its password segment masked, not the entire value.
 */
function isMongoUri(key: string, value: string): boolean {
  return /uri/i.test(key) &&
    (value.startsWith('mongodb://') || value.startsWith('mongodb+srv://'));
}

/**
 * Replaces the password in a MongoDB URI with *** while keeping the rest
 * (scheme, username, host, port, database, options) visible. Only the credential
 * segment between the username colon and the @ is masked.
 */
function maskMongoUri(uri: string): string {
  return uri.replace(
    /^(mongodb(?:\+srv)?:\/\/[^:/?#]*:)([^@]*)(@)/,
    '$1***$3',
  );
}

const ENV_PATH = path.join(PROJECT_ROOT, '.env');

/** Returns the list of keys defined in the .env file (comments and blank lines skipped). */
function readDotenvKeys(): string[] {
  try {
    const keys: string[] = [];
    for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || /^[#;]/.test(trimmed)) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (/^[A-Z_][A-Z0-9_]*$/i.test(key)) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

/**
 * Writes or updates a single KEY=value line in the .env file.
 * - Preserves comments, blank lines, and original line-ending style.
 * - Appends the key if not present.
 * - Quotes values that contain whitespace, #, =, or backslashes.
 */
function updateEnvFile(key: string, value: string): void {
  let content = '';
  try { content = fs.readFileSync(ENV_PATH, 'utf-8'); } catch { /* create new */ }

  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);

  const needsQuotes = /[ \t"'#\\=]/.test(value) || value === '';
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const formatted = needsQuotes ? `"${escaped}"` : value;
  const newLine = `${key}=${formatted}`;

  let found = false;
  const updated = lines.map(line => {
    if (!line.trim() || /^\s*[#;]/.test(line)) return line;
    const eqIdx = line.indexOf('=');
    if (eqIdx !== -1 && line.slice(0, eqIdx).trim() === key) {
      found = true;
      return newLine;
    }
    return line;
  });

  if (!found) {
    while (updated.length && !updated[updated.length - 1].trim()) updated.pop();
    updated.push(newLine, '');
  }

  fs.writeFileSync(ENV_PATH, updated.join(eol), 'utf-8');
}

/** Parses the frontend port from PSP_CORS_ORIGIN (defaults to 8080). */
function getFrontendPort(): number {
  const origin = process.env.PSP_CORS_ORIGIN ?? 'http://localhost:8080,http://127.0.0.1:8080';
  try {
    const p = new URL(origin.split(',')[0]).port;
    return p ? parseInt(p, 10) : 8080;
  } catch {
    return 8080;
  }
}

/** Cross-platform: kills the process listening on the given TCP port. */
function killProcessOnPort(port: number): void {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr ":${port} "`, {
        encoding: 'utf-8', shell: 'cmd.exe',
      });
      for (const line of out.split('\n')) {
        if (/LISTEN/i.test(line)) {
          const pid = line.trim().split(/\s+/).pop() ?? '';
          if (/^\d+$/.test(pid) && pid !== '0') {
            try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch {}
          }
        }
      }
    } else {
      const pids = execSync(`lsof -ti:${port} -sTCP:LISTEN 2>/dev/null || echo ''`, {
        encoding: 'utf-8', shell: '/bin/sh',
      }).trim().split('\n').filter(Boolean);
      for (const pid of pids) {
        try { process.kill(parseInt(pid, 10), 'SIGTERM'); } catch {}
      }
    }
  } catch { /* no process on port - nothing to kill */ }
}

/** Spawns a new frontend dev server from the project root (detached, untracked). */
function spawnFrontend(): void {
  const child = spawn('npm', ['run', 'dev:frontend'], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore',
    shell: true,
    env: { ...process.env },
  });
  child.unref();
}

const ALLOWED_NPM_COMMANDS: Record<string, string[]> = {
  'setup':             ['run', 'setup'],
  'setup:key:master':  ['run', 'setup:key:master'],
  'setup:key:rsa':     ['run', 'setup:key:rsa'],
  'setup:db':          ['run', 'setup:db'],
  'setup:generate':    ['run', 'setup:generate'],
  'setup:seed':        ['run', 'setup:seed'],
  'test':              ['run', 'test'],
  'test:unit':         ['run', 'test:unit'],
  'test:integration':  ['run', 'test:integration'],
  'test:e2e':          ['run', 'test:e2e'],
  'type-check':        ['run', 'type-check'],
  'setup:db:drop':     ['run', 'setup:db:drop'],
  'setup:check':       ['run', 'setup:check'],
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
  opts: {
    env?: NodeJS.ProcessEnv;
    /** Called once on process close; a non-null return is emitted as a `summary` event. */
    summarize?: () => NormalizedTestSummary | null;
    /**
     * When false, this run is one step of a larger sequence: the `done` event is not
     * emitted and the response stream is left open for the next step. Defaults to true.
     */
    finalize?: boolean;
  } = {},
): Promise<number> {
  const finalize = opts.finalize !== false;
  const sendText = (type: string, text: string) => {
    raw.write(`event: ${type}\ndata: ${JSON.stringify({ text })}\n\n`);
    appendLog(`[${label}] ${text}`);
  };
  // The summary frame carries the structured object directly (not wrapped in {text}).
  const sendSummary = (summary: NormalizedTestSummary) => {
    raw.write(`event: summary\ndata: ${JSON.stringify(summary)}\n\n`);
  };

  sendText('start', `> ${command} ${args.join(' ')}  (cwd: ${cwd})`);

  const child = spawn(command, args, {
    cwd,
    shell: true,
    env: { ...process.env, ...(opts.env ?? {}) },
  });

  return new Promise((resolve) => {
    child.stdout.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').filter(Boolean).forEach((l) => sendText('log', l));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').filter(Boolean).forEach((l) => sendText('error', l));
    });
    child.on('close', (code, signal) => {
      // A process killed by a signal reports code === null; treat that as a failure (non-zero)
      // so a signalled/aborted run is never reported as success by the SSE stream or aggregate runner.
      const exitCode = code ?? (signal ? 1 : 0);
      if (opts.summarize) {
        try {
          const summary = opts.summarize();
          if (summary) sendSummary(summary);
        } catch (err) {
          sendText('error', `Could not parse test results: ${(err as Error).message}`);
        }
      }
      if (finalize) {
        sendText('done', signal ? `Process terminated by signal ${signal}` : `Process exited with code ${exitCode}`);
        (raw as import('http').ServerResponse).end?.();
      }
      resolve(exitCode);
    });
    child.on('error', (err) => {
      sendText('error', `Failed to start: ${err.message}`);
      if (finalize) (raw as import('http').ServerResponse).end?.();
      resolve(-1);
    });
  });
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
          username: { type: 'string', description: 'Admin username (matches PSP_ADM_USER env var).' },
          password: { type: 'string', description: 'Plaintext password (server computes SHA-256 and compares against PSP_ADM_PASS).' },
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
    if (process.env.NODE_ENV === 'production' && (!process.env.PSP_ADM_USER || !process.env.PSP_ADM_PASS)) {
      return reply.status(503).send({ error: 'Admin credentials not configured. Set PSP_ADM_USER and PSP_ADM_PASS environment variables.' });
    }
    const admUser = process.env.PSP_ADM_USER ?? 'admin';
    const admPass = process.env.PSP_ADM_PASS ?? sha256('admin');

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

    // Single-tool test commands run with their tool's native JSON reporter so the
    // result summary is parsed from structured output, not scraped from log text.
    const strategy = resolveTestStrategy(command, PROJECT_ROOT);
    // The `test` aggregate runs each suite in turn and combines the parsed results.
    const sequence = resolveTestSequence(command, PROJECT_ROOT);

    beginSSE(reply, request);

    if (sequence) {
      const summaries: NormalizedTestSummary[] = [];
      let anyFail = false;
      for (const step of sequence) {
        fs.mkdirSync(path.dirname(step.outputFile), { recursive: true });
        try { fs.rmSync(step.outputFile, { force: true }); } catch { /* none to remove */ }
        const code = await spawnSSE(reply.raw, 'npm', step.npmArgs, PROJECT_ROOT, `npm:${command}`, {
          env: step.env,
          finalize: false,
        });
        if (code !== 0) anyFail = true;
        try {
          summaries.push(step.parse(fs.readFileSync(step.outputFile, 'utf-8')));
        } catch {
          // Suite crashed before writing its JSON; the exit code already flags failure.
        }
      }
      const agg = aggregateSummaries(summaries);
      if (summaries.length > 0) {
        reply.raw.write(`event: summary\ndata: ${JSON.stringify(agg)}\n\n`);
      }
      if (agg.failed > 0) anyFail = true;
      reply.raw.write(`event: done\ndata: ${JSON.stringify({ text: `Process exited with code ${anyFail ? 1 : 0}` })}\n\n`);
      (reply.raw as import('http').ServerResponse).end?.();
    } else if (strategy) {
      fs.mkdirSync(path.dirname(strategy.outputFile), { recursive: true });
      // Drop a stale results file so a crash before write can't surface an old summary.
      try { fs.rmSync(strategy.outputFile, { force: true }); } catch { /* none to remove */ }
      await spawnSSE(reply.raw, 'npm', strategy.npmArgs, PROJECT_ROOT, `npm:${command}`, {
        env: strategy.env,
        summarize: () => {
          try {
            return strategy.parse(fs.readFileSync(strategy.outputFile, 'utf-8'));
          } catch {
            return null; // no file (tool crashed before writing) → log-only, no summary
          }
        },
      });
    } else {
      await spawnSSE(reply.raw, 'npm', args, PROJECT_ROOT, `npm:${command}`);
    }
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

    beginSSE(reply, request);
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

    beginSSE(reply, request);

    [...logBuffer].forEach((line) => {
      reply.raw.write(`event: log\ndata: ${JSON.stringify({ text: line })}\n\n`);
    });

    let lastWrite = writeCount;
    const interval = setInterval(() => {
      if (!reply.raw.writable) { clearInterval(interval); return; }
      const cur = writeCount;
      if (cur > lastWrite) {
        const newCount = Math.min(cur - lastWrite, logBuffer.length);
        logBuffer.slice(logBuffer.length - newCount).forEach((line) => {
          reply.raw.write(`event: log\ndata: ${JSON.stringify({ text: line })}\n\n`);
        });
        lastWrite = cur;
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
        if (isMongoUri(k, v)) {
          env[k] = maskMongoUri(v);
        } else if (isSensitiveKey(k)) {
          env[k] = '***';
        } else {
          env[k] = v;
        }
      }
    }

    const dotenvKeys = readDotenvKeys();
    return reply.send({ os: osInfo, node: nodeInfo, package: pkgInfo, env, dotenvKeys });
  });

  // PATCH /admin/env  -  update a single env var in .env and process.env
  fastify.patch('/env', {
    schema: {
      tags: ['admin'],
      summary: 'Update an environment variable',
      description: 'Updates a key in the project `.env` file and applies it to `process.env` immediately. Only keys already present in `.env` can be updated. A server restart is required for changes to fully propagate (e.g. reconnecting to a new database URI).',
      security: [{ adminAuth: [] }],
      body: {
        type: 'object',
        required: ['key', 'value'],
        properties: {
          key:   { type: 'string', description: 'Env var name (must exist in .env).' },
          value: { type: 'string', description: 'New value.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            updated:        { type: 'boolean' },
            reloadRequired: { type: 'boolean' },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
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

    const { key, value } = request.body as { key: string; value: string };

    if (!key || !/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
      return reply.status(400).send({ error: 'Invalid key: must be uppercase letters, digits, and underscores.' });
    }
    if (typeof value !== 'string') {
      return reply.status(400).send({ error: 'Value must be a string.' });
    }
    if (value.includes('\n') || value.includes('\r')) {
      return reply.status(400).send({ error: 'Value must not contain newline characters.' });
    }

    updateEnvFile(key, value);
    process.env[key] = value;

    return reply.send({ updated: true, reloadRequired: true });
  });

  // POST /admin/restart
  fastify.post('/restart', {
    schema: {
      tags: ['admin'],
      summary: 'Restart backend or frontend server',
      description: [
        'backend - calls process.exit(0); tsx watch auto-restarts the backend.',
        'frontend - kills the process on the configured frontend port (PSP_CORS_ORIGIN) and spawns a new dev server.',
      ].join(' '),
      security: [{ adminAuth: [] }],
      body: {
        type: 'object',
        required: ['target'],
        properties: {
          target: {
            type: 'string',
            enum: ['backend', 'frontend'],
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            ok:      { type: 'boolean' },
            message: { type: 'string' },
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

    const { target } = request.body as { target: 'backend' | 'frontend' };

    if (target === 'frontend') {
      const port = getFrontendPort();
      killProcessOnPort(port);
      await new Promise((r) => setTimeout(r, 600));
      spawnFrontend();
      appendLog(`[admin] Frontend restart initiated on port ${port}`);
      return reply.send({ ok: true, message: `Frontend restarting on port ${port}` });
    }

    // Backend: flush response, then exit so tsx watch can restart
    appendLog('[admin] Backend restart initiated');
    await reply.send({ ok: true, message: 'Backend restarting...' });
    setTimeout(() => process.exit(0), 800);
  });

  // POST /admin/reload
  // Hot-reload the DB runtime IN-PROCESS (no restart): reloads .env, rebuilds the Queryable
  // Encryption client + event bus/subscribers against a fresh connection. Use this after a
  // drop + setup:db + seed on servers that cannot be restarted — it picks up the new key
  // vault / DEKs and fixes "not all keys requested were satisfied" without exiting the process.
  // Cross-platform (pure Node). Independent of /admin/restart.
  fastify.post('/reload', {
    schema: {
      tags: ['admin'],
      summary: 'Hot-reload env + DB/QE runtime in-process (no restart)',
      description: 'Reloads .env and rebuilds the QE client + event bus/subscribers so a new key vault / DEK set (after drop + setup + seed) is picked up without restarting the process.',
      security: [{ adminAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            ok:      { type: 'boolean' },
            message: { type: 'string' },
            steps:   { type: 'array', items: { type: 'string' } },
          },
        },
        401: { $ref: 'Error#' },
        429: { $ref: 'Error#' },
        500: { $ref: 'Error#' },
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

    const startedIso = new Date().toISOString();
    appendLog(`[admin] command "reload" — hot-reload runtime (in-process, no restart) @ ${startedIso}`);
    appendLog(`[admin] reload requested from ${ip}`);
    try {
      const { steps } = await reloadDbRuntime(fastify);
      for (const s of steps) appendLog(`[admin] reload · ${s}`);
      appendLog('[admin] command "reload" finished OK (login/QE now use the current key vault)');
      return reply.send({
        ok: true,
        message: 'Runtime reloaded — .env + QE client + event bus rebuilt.',
        steps,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      appendLog(`[admin] command "reload" FAILED: ${reason}`);
      return reply.status(500).send({ error: `Reload failed: ${reason}` });
    }
  });
}
