// v37 P11.6: the admin panel can rebuild and validate BOTH databases, and its output reaches the log buffer.
//
// The panel is how the demo is operated when nobody has a terminal, so "there is an npm script for it" is not
// the same claim. What matters is that the task is reachable from the panel, that its output streams back, and
// that a failure is visible rather than silent, which is what the log buffer is for.
//
// Skipped unless a PSP is listening.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from '../../../backend/src/config';

const PSP = process.env.PSP_BASE_URL ?? 'http://localhost:8081';
const ROOT = resolve(__dirname, '../../..');

function adminToken(): string {
  return jwt.sign({ role: 'admin', sub: 'p11-ops' }, config.app.jwtSecret, { expiresIn: 300 });
}

async function reachable(): Promise<boolean> {
  try {
    await fetch(`${PSP}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch { return false; }
}

// Reads a server-sent stream to completion, returning everything it emitted.
async function streamTask(command: string, token: string, timeoutMs = 240000): Promise<string> {
  const response = await fetch(`${PSP}/api/v1/admin/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  expect(response.status, `${command} was refused with ${response.status}`).toBe(200);
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe('v37 P11.6: the admin panel operates both databases', () => {
  let live = false;
  let token = '';

  beforeAll(async () => {
    live = await reachable();
    token = adminToken();
  });

  it('offers a bank-scoped task for every operation it offers on the PSP', () => {
    // Read from the source rather than asserted from memory: the allowlist is the security boundary, so a
    // task missing here is a task the panel cannot run however good the UI looks.
    const controller = readFileSync(
      resolve(ROOT, 'backend/src/modules/admin/controllers/admin.controller.ts'), 'utf8',
    );
    for (const task of ['setup:db:bankcore', 'setup:seed:bankcore', 'setup:check:bankcore', 'setup:db:drop:bankcore']) {
      expect(controller, `${task} must be in the allowlist`).toContain(`'${task}'`);
    }
    // And the unscoped ones, which cover both sides through the orchestrator.
    for (const task of ['setup:db', 'setup:seed', 'setup:check', 'setup:reset']) {
      expect(controller).toContain(`'${task}':`);
    }
  });

  it('refuses a task that is not on the allowlist', async () => {
    if (!live) return;
    // The allowlist is the point. If an arbitrary command ran, the panel would be a remote shell.
    const response = await fetch(`${PSP}/api/v1/admin/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'rm -rf /' }),
      signal: AbortSignal.timeout(15000),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses an unauthenticated caller', async () => {
    if (!live) return;
    const response = await fetch(`${PSP}/api/v1/admin/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'setup:check' }),
      signal: AbortSignal.timeout(15000),
    });
    expect(response.status).toBe(401);
  });

  it('validates the BANK database through the panel, and streams the result', async () => {
    if (!live) return;
    const output = await streamTask('setup:check:bankcore', token);
    // The bank's own validator, recognisable by what only it prints.
    expect(output).toContain('bankcore');
    expect(output.toLowerCase()).toContain('validation passed');
    // Its output must include the collections that arrived in P7 and P8, or the panel is validating a
    // database that predates them.
    expect(output).toContain('cardIssuerVault');
    expect(output).toContain('creditAssessmentState');
  }, 300000);

  it('validates the PSP database through the panel', async () => {
    if (!live) return;
    const output = await streamTask('setup:check', token);
    expect(output).toContain('Setup Validation');
    // The orchestrated task covers the bank too, which is the property the root scripts already had and
    // which the panel therefore inherits.
    expect(output).toContain('bankcore');
  }, 300000);

  it('reaches the log buffer, so a failure is visible in the panel rather than silent', async () => {
    if (!live) return;
    const response = await fetch(`${PSP}/api/v1/admin/logs?snapshot=true&follow=false`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    let text = '';
    if (reader) {
      const decoder = new TextDecoder();
      // One read is enough: the snapshot is written before the stream starts following.
      const { value } = await reader.read();
      text = decoder.decode(value ?? new Uint8Array(), { stream: true });
      await reader.cancel();
    }
    // Something was captured. An empty buffer means nothing the server did would be visible to an operator.
    expect(text.length, 'the log buffer returned nothing').toBeGreaterThan(0);
  }, 60000);
});
