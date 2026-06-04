export const ADMIN_TOKEN_KEY = 'admin_token';

export type LogEntry = { type: 'log' | 'error' | 'start' | 'done'; text: string };

export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

export async function readSSE(
  res: Response,
  onEntry: (type: string, text: string) => void,
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
      if (dataLine) {
        try {
          const type = eventLine?.slice(6).trim() ?? 'log';
          const { text } = JSON.parse(dataLine.slice(5).trim()) as { text: string };
          onEntry(type, text);
        } catch { /* skip malformed frame */ }
      }
    }
  }
}
