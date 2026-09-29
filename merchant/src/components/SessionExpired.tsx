'use client';
import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

/**
 * The session ended while somebody was using the application.
 *
 * It used to render as "Not available: A valid session or OAuth token is required", the PSP's own
 * words for a refused token, in the same red box as an unreachable service. That reads as a fault
 * in the system rather than as the ordinary thing it is, and it left the person on a page where
 * nothing would work and nothing said what to do about it.
 *
 * So it says what happened and then acts on it. The countdown is visible and can be taken now,
 * because a screen that navigates away on its own with no warning is its own small fault.
 *
 * It goes to `/api/auth/expired` and not to `/api/auth/logout`. The stale cookie has to go, because
 * a login started on top of a session this application still believes in is a flow over a session
 * nobody can use. But the full sign-out is for somebody who ASKED to leave: it walks the browser
 * through the authority's own sign-out, which ends on a sign-in page belonging to nobody here and
 * offering no way back. See that route for the rest.
 */

const COUNTDOWN_SECONDS = 10;
const RESUME_PATH = '/api/auth/expired';

export function SessionExpired() {
  const [left, setLeft] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    if (left <= 0) {
      window.location.href = RESUME_PATH;
      return;
    }
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-[var(--warn-bg)] p-6"
    >
      <Clock className="mt-0.5 h-5 w-5 shrink-0 text-[var(--warn)]" aria-hidden />
      <div>
        <h2 className="font-semibold text-[var(--warn)]">Your session expired</h2>
        <p className="mt-1 text-sm text-ink/80">
          You need to sign in again to continue. Taking you to sign in in {left}{' '}
          second{left === 1 ? '' : 's'}.
        </p>
        <a href={RESUME_PATH} className="btn-primary mt-3 inline-flex text-sm">
          Sign in again now
        </a>
      </div>
    </div>
  );
}
