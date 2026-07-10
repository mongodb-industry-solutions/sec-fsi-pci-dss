export const ADMIN_TOKEN_KEY = 'admin_token';

export function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type LogEntry = { type: 'log' | 'error' | 'start' | 'done'; text: string };

/**
 * Normalized test result contract, emitted by /admin/run as a dedicated `summary`
 * SSE event (ADR-026). Produced server-side from each tool's native JSON reporter,
 * so the frontend renders it directly instead of parsing log text.
 */
export interface TestSummary {
  tool: 'vitest' | 'playwright' | 'all';
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures: Array<{ title: string; reason?: string }>;
}

// CLI tools (vitest, npm, tsc) emit ANSI color/control codes that render as noise
// in an HTML log viewer. Strip them so streamed output is human-readable.
// The leading character class matches the ESC and CSI escape introducers
// using unicode escapes, keeping the source free of literal control bytes.
const ANSI_RE = new RegExp(
  '[\\u001B\\u009B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]',
  'g',
);

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

export async function readSSE(
  res: Response,
  onEntry: (type: string, text: string) => void,
  onSummary?: (summary: TestSummary) => void,
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const eventLine = part.split('\n').find((l) => l.startsWith('event:'));
      const dataLine  = part.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const type = eventLine?.slice(6).trim() ?? 'log';
      const dataStr = dataLine.slice(5).trim();
      try {
        // The `summary` frame carries the structured object directly; all other
        // frames carry { text } and feed the log console.
        if (type === 'summary') {
          onSummary?.(JSON.parse(dataStr) as TestSummary);
        } else {
          const { text } = JSON.parse(dataStr) as { text: string };
          onEntry(type, stripAnsi(text));
        }
      } catch { /* skip malformed frame */ }
    }
  }
}
