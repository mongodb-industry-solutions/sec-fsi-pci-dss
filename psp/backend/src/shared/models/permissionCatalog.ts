// ── The enforcement points this application declares ─────────────────────────
//
// The catalog ships HERE, in the code that enforces it, and is registered with the identity
// authority at boot. That direction is the whole arrangement: only the code containing the guard can
// say a permission exists, and only the authority can say who holds it. Neither side can invent the
// other's half.
//
// What this file is NOT any more: it holds no roles, no role-to-permission map and no assignment.
// Those are the authority's, and a copy here would be a second source of truth for an access
// decision, which is the thing the extraction exists to remove.

/** The protected areas of this application. Each maps to a real guard. */
export const RESOURCES = [
  'transactions',
  'customers',
  'cards',
  'fraudCases',
  'merchants',
  'providers',
  'modules',
  'auditEvents',
  'consents',
  'accounts',
  'beneficiaries',
  'paymentRequests',
] as const;
export type Resource = (typeof RESOURCES)[number];

/**
 * Access levels.
 *
 * `viewSensitive` gates cardholder and personal data and is the one bound to a time-bound
 * elevation; `investigate` authorises cross-party search, which is deliberately not the same thing
 * as reading one known record.
 */
export const ACTIONS = ['view', 'viewSensitive', 'manage', 'investigate'] as const;
export type Action = (typeof ACTIONS)[number];

export interface PermissionDeclaration {
  resource: Resource;
  action: Action;
  description: string;
}

/**
 * Bumped whenever this list changes.
 *
 * The authority stores what was last registered, so a mismatch is visible as drift rather than
 * discovered when a permission silently fails to resolve.
 */
export const PERMISSION_CATALOG_VERSION = '1';

/** What this application enforces, as a flat list. */
export const PERMISSION_CATALOG: PermissionDeclaration[] = [
  { resource: 'transactions', action: 'view', description: 'Read card transactions' },
  { resource: 'transactions', action: 'viewSensitive', description: 'Reveal sensitive transaction detail' },
  { resource: 'customers', action: 'view', description: 'Read customer records' },
  { resource: 'customers', action: 'viewSensitive', description: 'Reveal sensitive customer identity fields' },
  { resource: 'customers', action: 'manage', description: 'Correct customer identity records' },
  { resource: 'cards', action: 'view', description: 'Read card metadata' },
  { resource: 'cards', action: 'viewSensitive', description: 'Reveal a full card number' },
  { resource: 'cards', action: 'manage', description: 'Administer cards on file' },
  { resource: 'fraudCases', action: 'view', description: 'Read fraud cases' },
  { resource: 'fraudCases', action: 'viewSensitive', description: 'Reveal sensitive case detail' },
  { resource: 'fraudCases', action: 'investigate', description: 'Work and resolve a fraud case' },
  { resource: 'merchants', action: 'view', description: 'Read business records' },
  { resource: 'merchants', action: 'manage', description: 'Decide on or correct a business record' },
  { resource: 'providers', action: 'view', description: 'Read external provider arrangements' },
  { resource: 'providers', action: 'manage', description: 'Administer providers and routing' },
  { resource: 'modules', action: 'view', description: 'Read capability module configuration' },
  { resource: 'modules', action: 'manage', description: 'Administer capability module configuration' },
  { resource: 'auditEvents', action: 'view', description: 'Read the platform event trail' },
  { resource: 'consents', action: 'view', description: 'Read account-access consents' },
  { resource: 'accounts', action: 'view', description: 'Read payout accounts' },
  { resource: 'accounts', action: 'viewSensitive', description: 'Reveal a full account number' },
  { resource: 'accounts', action: 'manage', description: 'Administer payout accounts' },
  { resource: 'beneficiaries', action: 'view', description: 'Read a known owner\'s beneficiaries' },
  { resource: 'beneficiaries', action: 'investigate', description: 'Search beneficiaries across owners' },
  { resource: 'beneficiaries', action: 'manage', description: 'Add, edit and remove beneficiaries' },
  { resource: 'paymentRequests', action: 'view', description: 'Read payment requests' },
  { resource: 'paymentRequests', action: 'manage', description: 'Create and act on payment requests' },
];

/**
 * A pure claim check.
 *
 * The token carries the permissions the authority resolved at issuance, so this reads a claim and
 * decides. It performs no lookup, holds no cache and consults no collection, because any of those
 * would put an access decision back on this side of the boundary.
 */
export function hasPermission(
  permissions: ReadonlyArray<string> | Set<string> | undefined,
  resource: Resource,
  action: Action,
): boolean {
  // Default deny: an absent claim is not an unrestricted one.
  if (!permissions) return false;
  /**
   * A permission is the string `resource:action` since v40.
   *
   * One spelling on a role, on a policy and in a token, so there is nothing to convert between the
   * three places it appears and no way for two of them to disagree about the same authority.
   */
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return held.has(`${resource}:${action}`);
}
