'use client';
import { useEffect, useState } from 'react';

/**
 * What each bank role may do, mirrored from `bank/backend/src/shared/models/permissionCatalog.ts`
 * and the role definitions the authority publishes (`bankRoles.json`).
 *
 * A frontend cannot enforce anything: the backend already refuses every one of these on its own.
 * What this is for is the other half of least privilege, that an operator should not be OFFERED an
 * action their token cannot use. Kept as one small table rather than scattered role checks, so a
 * role change updates every screen from one place.
 */
export interface Session {
  signedIn: boolean;
  userName?: string;
  roles?: string[];
}

const CAN_MANAGE_ACCOUNTS = ['bank_operations'];
const CAN_MANAGE_CARDS = ['bank_operations', 'bank_card_officer'];
const CAN_REVEAL_CARD_NUMBER = ['bank_card_officer'];
const CAN_REVEAL_ACCOUNT_NUMBER = ['bank_operations', 'bank_compliance'];
const CAN_REVEAL_HOLDER_CONTACT = ['bank_operations', 'bank_compliance'];
const CAN_VIEW_MOVEMENTS = ['bank_operations', 'bank_compliance', 'bank_customer'];
// Not a permission the staff catalog grants: bank_customer holds no *:viewSensitive by design (see
// bankRoles.json's denialRationale), because that authority means disclosing SOMEONE ELSE's value.
// Reading your own IBAN or card number back is a different act, gated on ownership rather than on
// that permission, and served by its own `self-disclosure` route. This just decides which button a
// self-scoped screen offers.
const SELF_SCOPED_ROLES = ['bank_customer'];

function holds(roles: string[], allowed: string[]): boolean {
  return roles.some((role) => allowed.includes(role));
}

export interface Capabilities {
  canManageAccounts: boolean;
  canManageCards: boolean;
  canRevealCardNumber: boolean;
  canRevealAccountNumber: boolean;
  canRevealHolderContact: boolean;
  canViewMovements: boolean;
  /** Can reveal their OWN account's IBAN or OWN card's number, through the self-disclosure route. */
  canSelfDisclose: boolean;
}

export function capabilitiesFor(roles: string[] | undefined): Capabilities {
  const held = roles ?? [];
  return {
    canManageAccounts: holds(held, CAN_MANAGE_ACCOUNTS),
    canManageCards: holds(held, CAN_MANAGE_CARDS),
    canRevealCardNumber: holds(held, CAN_REVEAL_CARD_NUMBER),
    canRevealAccountNumber: holds(held, CAN_REVEAL_ACCOUNT_NUMBER),
    canRevealHolderContact: holds(held, CAN_REVEAL_HOLDER_CONTACT),
    canViewMovements: holds(held, CAN_VIEW_MOVEMENTS),
    canSelfDisclose: holds(held, SELF_SCOPED_ROLES),
  };
}

/**
 * The signed-in session, fetched once per mount. Every screen that needs to know what it may offer
 * reads this rather than repeating the same `fetch('/api/auth/session')`.
 */
export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    fetch('/api/auth/session')
      .then((response) => response.json())
      .then(setSession)
      .catch(() => setSession({ signedIn: false }));
  }, []);
  return session;
}

/** The current session's capabilities, undefined while the session is still loading. */
export function useCapabilities(): Capabilities | undefined {
  const session = useSession();
  if (!session) return undefined;
  return capabilitiesFor(session.roles);
}
