'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

/**
 * The session ended while somebody was using the console.
 *
 * It used to end in silence. The gate asked once, on mount, so a person already on a page saw
 * nothing happen: the screen stayed up, every action came back with the bank's refusal text in
 * whatever error slot the component had, and nothing said that the answer was "sign in again".
 *
 * So it says what happened and then acts on it. The countdown is visible and can be taken now,
 * because a screen that navigates away on its own with no warning is its own small fault.
 */

const COUNTDOWN_SECONDS = 10;
const SIGN_IN_PATH = '/api/auth/login';

export function SessionExpired() {
  const [left, setLeft] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    if (left <= 0) {
      window.location.href = SIGN_IN_PATH;
      return;
    }
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-md rounded-xl border border-line bg-white p-6 text-center shadow-sm"
      >
        <Clock size={22} className="mx-auto mb-3 text-accent" aria-hidden />
        <h2 className="text-lg font-semibold text-gray-900">Your session expired</h2>
        <p className="mt-2 text-sm text-gray-600">
          You need to sign in again to continue. Taking you to sign in in {left}{' '}
          second{left === 1 ? '' : 's'}.
        </p>
        <a
          href={SIGN_IN_PATH}
          className="mt-4 inline-flex items-center justify-center rounded-lg bg-bank px-4 py-2 text-sm font-medium text-bank-ink transition hover:opacity-90"
        >
          Sign in again now
        </a>
      </div>
    </div>
  );
}
