// Ring buffer of recent bankcore log lines, read by the PSP admin panel through /system/logs.
//
// Deliberately bankcore's own, not the PSP's module: a ring buffer is per-process state, so sharing
// the implementation would still need two instances, and the PSP's version is wired into a tested
// admin surface that gains nothing from being generalised.
const MAX_LINES = 500;
const lines: string[] = [];
let consoleMirrored = false;

export function appendLog(line: string): void {
  lines.push(line);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

export function levelLabel(level: number): string {
  if (level >= 60) return 'FATAL';
  if (level >= 50) return 'ERROR';
  if (level >= 40) return 'WARN';
  return 'INFO';
}

// PCI DSS and GDPR: a capped message, never a full stack, since a stack can carry request PII.
export function appendLogEntry(label: string, args: unknown[]): void {
  const parts = args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    try { return JSON.stringify(a); } catch { return String(a); }
  });
  appendLog(`[${new Date().toISOString()}] ${label} ${parts.join(' ').replace(/\s+/g, ' ').slice(0, 500)}`);
}

export function readLogs(limit = MAX_LINES): string[] {
  return lines.slice(-limit);
}

// Background subsystems report through console.*, which bypasses the fastify logger entirely.
export function mirrorConsoleToLogBuffer(): void {
  if (consoleMirrored) return;
  consoleMirrored = true;
  for (const [method, label] of [['warn', 'WARN'], ['error', 'ERROR']] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      appendLogEntry(label, args);
      original(...args);
    };
  }
}
