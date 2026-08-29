// ── The enforcement points this bank declares ────────────────────────────────
//
// v39 P7.4. This bank had no permission model at all: its access was machine to machine, so it could
// not express that viewing a card, revealing the number on it and changing a ledger record are three
// different authorities. The catalog ships here, in the code that enforces it, and is registered with
// the identity authority at boot. The authority grants these to roles; the bank stores no assignment.

export const BANK_RESOURCES = [
  'accountHolders',
  'accounts',
  'movements',
  'issuedCards',
  /**
   * Deliberately SEPARATE from `issuedCards`.
   *
   * Authority to operate a card must not imply authority to read its number. Keeping the card and
   * the number apart is what lets an operations role administer cards without ever being able to
   * disclose one, and it is the same reasoning that keeps card-data scopes out of the card
   * authorisation surface.
   */
  'cardData',
  'consents',
  'tppRegistrations',
  'creditAssessments',
  'counterpartyBanks',
  'bankModules',
  'bankAudit',
  /** Not a resource an operator administers: the capacities a third party is registered for. */
  'psd2Role',
] as const;
export type BankResource = (typeof BANK_RESOURCES)[number];

export const BANK_ACTIONS = ['view', 'viewSensitive', 'manage', 'AISP', 'PISP', 'CBPII'] as const;
export type BankAction = (typeof BANK_ACTIONS)[number];

export interface BankPermissionDeclaration {
  resource: BankResource;
  action: BankAction;
  description: string;
}

export const BANK_PERMISSION_CATALOG_VERSION = '1';

export const BANK_PERMISSION_CATALOG: BankPermissionDeclaration[] = [
  { resource: 'accountHolders', action: 'view', description: 'Read the people and businesses this bank holds accounts for' },
  { resource: 'accountHolders', action: 'manage', description: 'Administer account holder records' },
  { resource: 'accounts', action: 'view', description: 'Read accounts and balances' },
  { resource: 'accounts', action: 'viewSensitive', description: 'Reveal a full account number' },
  { resource: 'accounts', action: 'manage', description: 'Administer accounts' },
  { resource: 'movements', action: 'view', description: 'Read ledger movements' },
  { resource: 'movements', action: 'manage', description: 'Correct a ledger record' },
  { resource: 'issuedCards', action: 'view', description: 'Read the cards this bank issued' },
  { resource: 'issuedCards', action: 'manage', description: 'Issue, block and replace cards' },
  { resource: 'cardData', action: 'viewSensitive', description: 'Disclose a full card number from the issuer vault' },
  { resource: 'consents', action: 'view', description: 'Read account-access consents' },
  { resource: 'consents', action: 'manage', description: 'Revoke an account-access consent' },
  { resource: 'tppRegistrations', action: 'view', description: 'Read registered third parties' },
  { resource: 'tppRegistrations', action: 'manage', description: 'Register and suspend third parties' },
  { resource: 'creditAssessments', action: 'view', description: 'Read credit assessments' },
  { resource: 'creditAssessments', action: 'manage', description: 'Run and record a credit assessment' },
  { resource: 'counterpartyBanks', action: 'view', description: 'Read reachable institutions' },
  { resource: 'counterpartyBanks', action: 'manage', description: 'Administer reachability' },
  { resource: 'bankModules', action: 'view', description: 'Read engine configuration' },
  { resource: 'bankModules', action: 'manage', description: 'Administer engine configuration' },
  { resource: 'bankAudit', action: 'view', description: 'Read the bank request trail' },

  // The PSD2 capacities, carried as permissions so a machine principal resolves through the same
  // decision point as a person rather than through a parallel mechanism.
  { resource: 'psd2Role', action: 'AISP', description: 'Act as an account information service provider' },
  { resource: 'psd2Role', action: 'PISP', description: 'Act as a payment initiation service provider' },
  { resource: 'psd2Role', action: 'CBPII', description: 'Act as a card-based payment instrument issuer' },
];

/** A pure claim check. Default deny: an absent claim is not an unrestricted one. */
export function hasBankPermission(
  permissions: ReadonlyArray<{ resource: string; action: string }> | undefined,
  resource: BankResource,
  action: BankAction,
): boolean {
  if (!permissions) return false;
  return permissions.some((permission) => permission.resource === resource && permission.action === action);
}
