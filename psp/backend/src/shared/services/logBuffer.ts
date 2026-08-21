// Shared in-memory ring buffer for server log streaming to the admin panel.
// Populated by Fastify hooks in bin/server.ts (requests, handler errors, pino warn+),
// by the console mirror below, and by the admin controller; read by the admin logs SSE endpoint.
const MAX = 500;
/** PCI DSS / GDPR: entries carry error TYPE + capped MESSAGE, never full stacks. */
const MAX_LINE = 500;

export const logBuffer: string[] = [];
export let writeCount = 0;

export function appendLog(line: string) {
  logBuffer.push(line);
  writeCount++;
  if (logBuffer.length > MAX) logBuffer.shift();
}

// Renders one log argument as a single-line, investigable string. Errors keep name + message;
// pino-style `{ err }` wrappers are unwrapped so the cause is visible, not "[object Object]".
function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') {
    const wrapped = (value as { err?: unknown }).err;
    if (wrapped !== undefined) return describe(wrapped);
    try { return JSON.stringify(value); } catch { return '[unserializable]'; }
  }
  return String(value);
}

/** Appends a kind-prefixed, timestamped, length-capped entry built from raw log arguments. */
export function appendLogEntry(kind: string, args: unknown[]) {
  const text = args.map(describe).join(' ').replace(/\s+/g, ' ').slice(0, MAX_LINE);
  appendLog(`[${new Date().toISOString()}] ${kind} ${text}`);
}

/** Numeric pino level to label (40 warn, 50 error, 60 fatal). */
export function levelLabel(level: number): string {
  return level >= 60 ? 'FATAL' : level >= 50 ? 'ERROR' : 'WARN';
}

let consoleMirrored = false;

/**
 * Mirrors console.warn/error into the buffer. Background work (event-bus subscribers, sagas,
 * payout orchestration, QE degradation, startup) reports there, outside any request, so without
 * this those failures were only visible in the container stdout and never in the admin panel.
 * The original console method is always called, so stdout output is unchanged.
 */
export function mirrorConsoleToLogBuffer(): void {
  if (consoleMirrored) return;
  consoleMirrored = true;
  const targets: Array<['warn' | 'error', string]> = [['warn', 'CONSOLE WARN'], ['error', 'CONSOLE ERROR']];
  for (const [method, kind] of targets) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      appendLogEntry(kind, args);
      original(...args);
    };
  }
}
