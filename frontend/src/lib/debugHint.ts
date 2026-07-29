'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const SEEN_KEY = 'psp_debug_hint_seen';
// 3 flickers of 0.2s in debug-hint-blink, plus a beat before the class is removed.
const BURST_MS = 750;
const REST_MS = 9000;

/**
 * First-visit hint for the debug toggle on the sign-in screen. Flickers for BURST_MS, sleeps for
 * REST_MS, and repeats until `dismissHint` retires it permanently.
 */
export function useDebugHint() {
  const [pulsing, setPulsing] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stopped = useRef(false);

  useEffect(() => {
    if (read(SEEN_KEY)) return;
    let on = false;
    const tick = () => {
      if (stopped.current) return;
      on = !on;
      setPulsing(on);
      timers.current.push(setTimeout(tick, on ? BURST_MS : REST_MS));
    };
    tick();
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  }, []);

  const dismissHint = useCallback(() => {
    stopped.current = true;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPulsing(false);
    write(SEEN_KEY, '1');
  }, []);

  return { pulsing, dismissHint };
}

// Storage throws in some privacy modes.
function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
}
