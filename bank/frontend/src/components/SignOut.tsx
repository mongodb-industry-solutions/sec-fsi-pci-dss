'use client';

import { useEffect, useState } from 'react';

// Only rendered once somebody is signed in, so the header does not offer to end a session that does
// not exist.
export function SignOut() {
  const [who, setWho] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((s) => setWho(s.signedIn ? (s.userName ?? 'signed in') : null))
      .catch(() => setWho(null));
  }, []);

  if (!who) return null;

  return (
    <span className="flex items-center gap-2 text-xs text-bank-ink/70">
      <span className="hidden sm:inline">{who}</span>
      <button
        type="button"
        onClick={async () => {
          await fetch('/api/auth/logout', { method: 'POST' });
          window.location.reload();
        }}
        className="rounded-md border border-bank-ink/20 px-2 py-0.5 hover:bg-bank-ink/5"
      >
        Sign out
      </button>
    </span>
  );
}
