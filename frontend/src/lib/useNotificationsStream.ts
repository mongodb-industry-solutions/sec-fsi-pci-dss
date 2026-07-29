'use client';
import { useEffect, useRef } from 'react';
import { API_BASE_URL } from './constants';

// Same-tab instant sync: when one component marks notifications read (e.g. the full page), other
// mounted components (e.g. the top-bar bell) update their unread count immediately, without waiting
// for the SSE round-trip. SSE still covers new notifications and cross-tab/device changes.
const NOTIF_CHANGED_EVENT = 'notifications:changed';

export function emitNotificationsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTIF_CHANGED_EVENT));
}

export function useNotificationsChanged(onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const handler = () => cb.current();
    window.addEventListener(NOTIF_CHANGED_EVENT, handler);
    return () => window.removeEventListener(NOTIF_CHANGED_EVENT, handler);
  }, []);
}

// ADR-031: live signal that the current user's notifications changed (SSE). Carries no data; each
// subscriber refetches its own scoped data. Uses fetch + ReadableStream so the Bearer header is sent
// (no token in the URL — PCI DSS Req 4).
//
// IMPORTANT: there is ONE shared connection per token, fanned out to every subscriber (the top-bar
// bell, the sidebar badge, the transaction page, the questions panel…). Opening a separate SSE stream
// per component starved the browser's per-host connection limit (HTTP/1.1), so some surfaces updated
// and others didn't. A single multiplexed stream keeps every surface in sync.
//
// A 401/403 is permanent for that token, so it stops the stream instead of retrying: a tab left open
// after a logout elsewhere used to re-request every 3s forever. Only a new token recovers.

type Sub = () => void;
const subscribers = new Set<Sub>();
let sharedToken: string | null = null;
let sharedCtrl: AbortController | null = null;
let sharedStopped = false;
let sharedRetry: ReturnType<typeof setTimeout> | null = null;
const rejectedTokens = new Set<string>();

function fanOut() { for (const s of subscribers) { try { s(); } catch { /* ignore */ } } }

function teardownShared() {
  sharedStopped = true;
  if (sharedRetry) { clearTimeout(sharedRetry); sharedRetry = null; }
  sharedCtrl?.abort();
  sharedCtrl = null;
  sharedToken = null;
}

function startShared(token: string) {
  sharedStopped = false;
  async function connect() {
    sharedCtrl = new AbortController();
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/notifications/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: sharedCtrl.signal,
      });
      // Remembered so a component remount cannot restart the loop.
      if (res.status === 401 || res.status === 403) {
        rejectedTokens.add(token);
        teardownShared();
        return;
      }
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
          if (frame.includes('data:') && frame.includes('changed')) fanOut();
        }
      }
      schedule();
    } catch {
      if (!sharedStopped) schedule();
    }
  }
  function schedule() { if (!sharedStopped) sharedRetry = setTimeout(connect, 3000); }
  connect();
}

function ensureShared(token: string) {
  if (rejectedTokens.has(token)) return; // refused by the server; only a new token can recover
  if (sharedToken === token && sharedCtrl) return; // already connected with this token
  teardownShared();
  sharedToken = token;
  startShared(token);
}

export function useNotificationsStream(token: string, onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!token) return;
    const sub: Sub = () => cb.current();
    subscribers.add(sub);
    ensureShared(token);
    return () => {
      subscribers.delete(sub);
      if (subscribers.size === 0) teardownShared(); // last subscriber gone → close the stream
    };
  }, [token]);
}
