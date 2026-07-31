'use client';
import { useEffect, useRef } from 'react';
import { API_BASE_URL } from './constants';

export interface CaseStreamEvent {
  caseId: string;
  kind: 'question.created' | 'question.answered' | 'case.updated' | string;
  questionId?: string;
  transactionId?: string;
  at?: string;
}

// ADR-031: subscribe to a case's live event stream (SSE) so the investigation view updates without a
// manual refresh (e.g. when a customer answers a question). Uses fetch + ReadableStream rather than
// EventSource so the normal Bearer header is sent (no token in the URL; PCI DSS Req 4). Auto-reconnects
// with backoff while mounted; aborts on unmount.
export function useCaseStream(caseId: string | undefined, token: string, onEvent: (e: CaseStreamEvent) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!caseId || !token) return;
    let stopped = false;
    let ctrl: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      ctrl = new AbortController();
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/fraud/${caseId}/stream`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        // Permanent for this token/case (logged out elsewhere, or no access): stop instead of
        // retrying every 3s for as long as the view stays open.
        if (res.status === 401 || res.status === 403) { stopped = true; return; }
        if (!res.ok || !res.body) { scheduleRetry(); return; }
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
            const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) continue;
            const payload = dataLine.slice(5).trim();
            if (!payload || payload === '{}') continue;
            try { cb.current(JSON.parse(payload) as CaseStreamEvent); } catch { /* ignore */ }
          }
        }
        scheduleRetry();
      } catch {
        if (!stopped) scheduleRetry();
      }
    }

    function scheduleRetry() {
      if (stopped) return;
      retry = setTimeout(connect, 3000);
    }

    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      ctrl?.abort();
    };
  }, [caseId, token]);
}
