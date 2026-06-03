import { FastifyInstance } from 'fastify';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { spawn } from 'child_process';
import * as path from 'path';
import { logBuffer, appendLog } from '../../../shared/logBuffer';

// __dirname = backend/src/modules/admin/controllers/ (tsx dev mode)
// 5 levels up -> project root
const PROJECT_ROOT = path.resolve(__dirname, '../../../../../');

const ALLOWED_COMMANDS: Record<string, string[]> = {
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

function verifyAdminToken(authHeader: string | undefined): boolean {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  try {
    const secret = process.env.JWT_SECRET ?? 'demo-local-secret-change-in-production';
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    return payload.role === 'admin';
  } catch {
    return false;
  }
}

export async function adminController(fastify: FastifyInstance) {

  // POST /admin/login
  fastify.post('/login', {
    schema: {
      tags: ['admin'],
      summary: 'Admin login (SHA-256 password check against ADM_PASS env var)',
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { username, password } = request.body as { username: string; password: string };

    const admUser = process.env.ADM_USER ?? 'admin';
    // ADM_PASS stores SHA-256 hash of the password
    const admPass = process.env.ADM_PASS ?? sha256('admin');

    if (username !== admUser || sha256(password) !== admPass) {
      return reply.status(401).send({ error: 'Invalid admin credentials' });
    }

    const secret = process.env.JWT_SECRET ?? 'demo-local-secret-change-in-production';
    const token = jwt.sign({ sub: 'admin', role: 'admin' }, secret, { expiresIn: '4h' });
    appendLog(`[admin] Login successful for user: ${username}`);
    return reply.send({ token });
  });

  // POST /admin/run: SSE stream of npm command output
  fastify.post('/run', {
    schema: {
      tags: ['admin'],
      summary: 'Execute an npm command and stream output via SSE',
      body: {
        type: 'object',
        required: ['command'],
        properties: {
          command: { type: 'string', enum: Object.keys(ALLOWED_COMMANDS) },
        },
      },
    },
  }, async (request, reply) => {
    if (!verifyAdminToken(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Invalid admin token' });
    }

    const { command } = request.body as { command: string };
    const args = ALLOWED_COMMANDS[command];
    if (!args) {
      return reply.status(400).send({ error: 'Unknown command' });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    reply.raw.flushHeaders();

    const sendEvent = (type: string, data: string) => {
      reply.raw.write(`event: ${type}\ndata: ${JSON.stringify({ text: data })}\n\n`);
      appendLog(`[cmd:${command}] ${data}`);
    };

    sendEvent('start', `> npm ${args.join(' ')}  (cwd: ${PROJECT_ROOT})`);

    const child = spawn('npm', args, {
      cwd: PROJECT_ROOT,
      shell: true,
      env: { ...process.env },
    });

    child.stdout.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').filter(Boolean).forEach((line) => sendEvent('log', line));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').filter(Boolean).forEach((line) => sendEvent('error', line));
    });

    await new Promise<void>((resolve) => {
      child.on('close', (code) => {
        sendEvent('done', `Process exited with code ${code ?? 0}`);
        reply.raw.end();
        resolve();
      });
      child.on('error', (err) => {
        sendEvent('error', `Failed to start: ${err.message}`);
        reply.raw.end();
        resolve();
      });
    });
  });

  // GET /admin/logs: SSE stream of recent server logs
  fastify.get('/logs', {
    schema: {
      tags: ['admin'],
      summary: 'Stream server log ring buffer via SSE',
    },
  }, async (request, reply) => {
    if (!verifyAdminToken(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Invalid admin token' });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    reply.raw.flushHeaders();

    // Send current buffer snapshot
    [...logBuffer].forEach((line) => {
      reply.raw.write(`event: log\ndata: ${JSON.stringify({ text: line })}\n\n`);
    });

    // Poll every 2s for new entries
    let lastLen = logBuffer.length;
    const interval = setInterval(() => {
      if (!reply.raw.writable) {
        clearInterval(interval);
        return;
      }
      const current = logBuffer.length;
      if (current > lastLen) {
        logBuffer.slice(lastLen).forEach((line) => {
          reply.raw.write(`event: log\ndata: ${JSON.stringify({ text: line })}\n\n`);
        });
        lastLen = current;
      } else if (current < lastLen) {
        lastLen = current;
      }
    }, 2000);

    request.raw.on('close', () => clearInterval(interval));

    // Keep response open
    await new Promise<void>(() => {
      request.raw.on('close', () => { /* cleaned above */ });
    });
  });
}
