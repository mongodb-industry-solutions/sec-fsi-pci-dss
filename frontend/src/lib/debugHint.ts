'use client';
import { useCallback, useEffect, useState } from 'react';

const SEEN_KEY = 'psp_debug_hint_seen';
const AUTO_HIDE_MS = 8000;

/**
 * First-visit hint for the debug toggle on the sign-in screen. Debug mode is what lists the demo
 * accounts and auto-fills their credentials, so a first-time visitor who misses that 14px icon has
 * no obvious way into the demo.
 *
 * Auto-hides so it never lingers. Only engaging with it (opening debug mode, or dismissing) retires
 * it for good: letting it time out leaves it armed, so a visitor who looked away still gets it next
 * time.
 */
export function useDebugHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (read(SEEN_KEY)) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, []);

  const dismissHint = useCallback(() => {
    setVisible(false);
    write(SEEN_KEY, '1');
  }, []);

  return { hintVisible: visible, dismissHint };
}

// Storage is unavailable in some privacy modes; a hint is not worth a crash.
function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
}
