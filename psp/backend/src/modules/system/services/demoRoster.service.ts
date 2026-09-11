import { Db } from 'mongodb';
import { config } from '../../../config';

/**
 * The demo roster, read from the identity authority.
 *
 * This used to query a local user table. That table is gone, and with it the ability to answer this
 * from here at all: the principals live at the authority now, and the roster is the authority's own
 * public sign-in affordance rather than something this application maintains a second copy of.
 *
 * Read on every call and never cached. A roster is small, it is only used by demonstration screens,
 * and a cache would keep showing a persona after it was removed, which is the failure that matters
 * more than the round trip it saves.
 */

export interface DemoUser {
  sub: string;
  name: string;
  email?: string;
  role?: string;
}

interface RosterEntry {
  subjectId: string;
  userName: string;
  email?: string;
  role?: string;
}

export async function getDemoUsers(
  _db: Db,
  filters: { featured?: boolean; role?: string[]; q?: string; isMerchant?: boolean } = {},
): Promise<DemoUser[]> {
  const issuer = config.giam.issuerUrl.replace(/\/+$/, '');
  const realm = issuer.split('/realms/')[1] ?? 'leafypay';
  const base = issuer.split('/realms/')[0];

  let roster: RosterEntry[] = [];
  try {
    const response = await fetch(`${base}/realms/${realm}/login-context`, {
      signal: AbortSignal.timeout(5000),
    });
    // An empty roster rather than an error. A demonstration screen with no personas is a screen that
    // says so; a 500 is a screen that looks broken for a reason nobody can see.
    if (!response.ok) return [];
    roster = (await response.json()).roster ?? [];
  } catch {
    return [];
  }

  // The roster the authority publishes is already only the featured personas, so `featured` needs no
  // filtering here. The rest narrow what is shown.
  let users = roster.map((entry) => ({
    sub: entry.subjectId,
    name: entry.userName,
    ...(entry.email ? { email: entry.email } : {}),
    ...(entry.role ? { role: entry.role } : {}),
  }));

  if (filters.role?.length) {
    const wanted = new Set(filters.role);
    users = users.filter((user) => user.role && wanted.has(user.role));
  }

  if (filters.q) {
    const needle = filters.q.toLowerCase();
    users = users.filter((user) =>
      user.name.toLowerCase().includes(needle) || (user.email ?? '').toLowerCase().includes(needle));
  }

  return users;
}
