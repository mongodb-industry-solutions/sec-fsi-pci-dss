/**
 * What each bank role may do, mirrored from the role definitions the authority publishes
 * (`bankRoles.json`) and enforced by `bank/backend/src/shared/models/permissionCatalog.ts`.
 *
 * A frontend cannot enforce anything: the bank already refuses every one of these on its own. What
 * this is for is the other half of least privilege, that an operator should not be OFFERED a screen
 * their token cannot open. Offering it anyway turns navigation into a guessing game where half the
 * destinations answer "access denied", which reads as a broken product rather than as a boundary.
 *
 * Kept as one table, shared by the home page and the header menu, so a role change moves every
 * surface at once and the two cannot drift apart.
 */

export type BankPermission =
  | 'accountHolders:view' | 'accountHolders:viewSensitive' | 'accountHolders:manage'
  | 'accounts:view' | 'accounts:viewSensitive' | 'accounts:manage'
  | 'movements:view' | 'movements:manage'
  | 'issuedCards:view' | 'issuedCards:manage'
  | 'cardData:viewSensitive'
  | 'consents:view' | 'consents:manage'
  | 'tppRegistrations:view' | 'tppRegistrations:manage'
  | 'creditAssessments:view' | 'creditAssessments:manage'
  | 'counterpartyBanks:view' | 'counterpartyBanks:manage'
  | 'bankModules:view' | 'bankModules:manage'
  | 'bankAudit:view';

const ROLE_PERMISSIONS: Record<string, BankPermission[]> = {
  bank_operations: [
    'accountHolders:view', 'accountHolders:viewSensitive', 'accountHolders:manage',
    'accounts:view', 'accounts:viewSensitive', 'accounts:manage',
    'movements:view',
    'issuedCards:view', 'issuedCards:manage',
    'creditAssessments:view',
  ],
  bank_card_officer: [
    'accountHolders:view',
    'accounts:view',
    'issuedCards:view', 'issuedCards:manage',
    'cardData:viewSensitive',
  ],
  bank_compliance: [
    'accountHolders:view', 'accountHolders:viewSensitive',
    'accounts:view', 'accounts:viewSensitive',
    'movements:view',
    'issuedCards:view',
    'consents:view',
    'tppRegistrations:view',
    'creditAssessments:view',
    'counterpartyBanks:view',
    'bankAudit:view',
  ],
  bank_admin: [
    'tppRegistrations:view', 'tppRegistrations:manage',
    'counterpartyBanks:view', 'counterpartyBanks:manage',
    'bankModules:view', 'bankModules:manage',
    'consents:view', 'consents:manage',
    'bankAudit:view',
  ],
  bank_customer: [
    'accountHolders:view',
    'accounts:view',
    'movements:view',
    'issuedCards:view',
  ],
};

/**
 * The roles bound to the holder's OWN records, the same list the bank enforces.
 *
 * Holding one narrows every read to one subject, so it changes what a screen is CALLED rather than
 * which screens exist: "Parties" is not what a person calls themselves.
 */
const SELF_SCOPED_ROLES = ['bank_customer'];

/** The union of what the roles held grant, the same way the token's expanded set is built. */
export function permissionsFor(roles: readonly string[] | undefined): Set<BankPermission> {
  const held = new Set<BankPermission>();
  for (const role of roles ?? []) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) held.add(permission);
  }
  return held;
}

export function isSelfScoped(roles: readonly string[] | undefined): boolean {
  return Boolean(roles?.some((role) => SELF_SCOPED_ROLES.includes(role)));
}

/** Everything a screen needs to decide what to offer, resolved once from the roles held. */
export interface Access {
  roles: string[];
  permissions: Set<BankPermission>;
  /** Bound to one subject's own records, staff roles alongside it notwithstanding. */
  selfScoped: boolean;
  can: (permission: BankPermission) => boolean;
}

export function accessFor(roles: readonly string[] | undefined): Access {
  const permissions = permissionsFor(roles);
  return {
    roles: [...(roles ?? [])],
    permissions,
    selfScoped: isSelfScoped(roles),
    can: (permission) => permissions.has(permission),
  };
}
