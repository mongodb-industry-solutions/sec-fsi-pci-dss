// Shared in-memory ring buffer for server log streaming to the admin panel.
// Populated by Fastify hooks in server.ts; read by the admin logs SSE endpoint.
const MAX = 500;
export const logBuffer: string[] = [];
export let writeCount = 0;

export function appendLog(line: string) {
  logBuffer.push(line);
  writeCount++;
  if (logBuffer.length > MAX) logBuffer.shift();
}
