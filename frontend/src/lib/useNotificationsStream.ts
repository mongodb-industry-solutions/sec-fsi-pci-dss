'use client';
import { useEffect, useRef } from 'react';
import { API_BASE_URL } from './constants';

// ADR-031: live signal that the current user's notifications changed (SSE). Carries no data; the
// caller refetches the scoped list. Uses fetch + ReadableStream so the Bearer header is sent (no
// token in the URL — PCI DSS Req 4). Auto-reconnects while mounted; aborts on unmount.
export function useNotificationsStream(token: string, onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!token) return;
    let stopped = false;
    let ctrl: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      ctrl = new AbortController();
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/notifications/stream`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) { schedule(); return; }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            if (frame.includes('data:') && frame.includes('changed')) cb.current();
          }
        }
        schedule();
      } catch {
        if (!stopped) schedule();
      }
    }
    function schedule() { if (!stopped) retry = setTimeout(connect, 3000); }

    connect();
    return () => { stopped = true; if (retry) clearTimeout(retry); ctrl?.abort(); };
  }, [token]);
}
