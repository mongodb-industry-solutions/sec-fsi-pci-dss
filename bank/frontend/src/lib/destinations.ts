import {
  BellRing, CreditCard, FileSearch, Landmark, ScrollText, ShieldCheck, Users,
  type LucideIcon,
} from 'lucide-react';
import type { Access, BankPermission } from './access';

/**
 * Every screen this console offers, and the permission that opens it.
 *
 * One catalog for the home page and the header menu. They listed their destinations separately
 * before, the home page listing all of them unconditionally, so an account holder was shown the
 * rules, the audit trail and the third-party register and met a refusal on each: the navigation
 * promised authority the token does not carry.
 *
 * `self` is not a second set of screens. A self-scoped person reaches the same route, narrowed
 * server side to their own records (`bindOwnAccountHolder`), so only the wording changes: "Parties"
 * lists everybody's; served to an account holder it is a list of one, which is their own.
 */

export type DestinationSection = 'data' | 'rules' | 'records';

export interface Destination {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  section: DestinationSection;
  requires: BankPermission;
  /** Shown in the header menu as well as on the home page. */
  inMenu?: boolean;
  /** How this same destination reads for somebody bound to their own records. */
  self?: {
    label: string;
    description: string;
    /**
     * Where the destination itself points to, self-scoped. Only set on a destination that names
     * exactly one record for that person (a holder is one record; an account or a card is not,
     * because a person can hold several, so those stay a list).
     */
    hrefFor?: (accountHolderRef: string) => string;
  };
}

export const DESTINATIONS: Destination[] = [
  {
    href: '/holders',
    label: 'Parties',
    description: 'The customers behind those accounts and cards. Names and contacts arrive masked, because they are encrypted at rest.',
    icon: Users,
    section: 'data',
    requires: 'accountHolders:view',
    inMenu: true,
    self: {
      label: 'My details',
      description: 'The record this bank holds about you: your name, your contact and your country.',
      // Always one record: unlike the accounts and cards lists below, there is only ever one holder
      // to be, so this goes straight to it instead of to a list of one.
      hrefFor: (accountHolderRef) => `/holders/${encodeURIComponent(accountHolderRef)}`,
    },
  },
  {
    href: '/accounts',
    label: 'Accounts',
    description: 'The accounts this bank holds, their balances and the approval step each one passed through.',
    icon: Landmark,
    section: 'data',
    requires: 'accounts:view',
    inMenu: true,
    self: { label: 'My accounts', description: 'Your accounts at this bank, their balances and their movements.' },
  },
  {
    href: '/cards',
    label: 'Card estate',
    description: 'Every card this bank issued, with its lifecycle. Numbers stay encrypted: a list decrypts nothing, and one card discloses on request.',
    icon: CreditCard,
    section: 'data',
    requires: 'issuedCards:view',
    inMenu: true,
    self: { label: 'My cards', description: 'The cards you hold, with their status and their limits. The number stays masked.' },
  },

  {
    href: '/rules/card-issuer',
    label: 'Card Issuer',
    description: 'What this issuer validates a card against: the accepted verification value, its mode, the check digit, the recognised networks.',
    icon: CreditCard,
    section: 'rules',
    requires: 'bankModules:view',
  },
  {
    href: '/rules/card-authorization',
    label: 'Card Authorisation',
    description: 'How the authorisation hold behaves, and the response codes it answers with.',
    icon: ShieldCheck,
    section: 'rules',
    requires: 'bankModules:view',
  },
  {
    href: '/rules/aisp',
    label: 'Account Information',
    description: 'What a third party may read from an account, and the ceiling on how much at once.',
    icon: Users,
    section: 'rules',
    requires: 'bankModules:view',
  },
  {
    href: '/rules/pisp',
    label: 'Payment Initiation',
    description: 'The payment products this bank offers, and the largest instruction it accepts.',
    icon: ScrollText,
    section: 'rules',
    requires: 'bankModules:view',
  },
  {
    href: '/rules/credit-bureau',
    label: 'Credit Bureau',
    description: 'How this bank scores a party it banks: base score, rating bands, and what its own records earn or cost.',
    icon: FileSearch,
    section: 'rules',
    requires: 'bankModules:view',
  },
  {
    href: '/rules/consent',
    label: 'Consent',
    description: 'Whether a new consent lands usable or waits for the account holder, and how long it stays valid.',
    icon: ScrollText,
    section: 'rules',
    requires: 'bankModules:view',
  },

  {
    href: '/records/tpp/registrations',
    label: 'Third-party registrations',
    description: 'Which clients may reach this banking API, and what each was granted.',
    icon: Users,
    section: 'records',
    requires: 'tppRegistrations:view',
    inMenu: true,
  },
  {
    href: '/records/consents',
    label: 'Consents',
    description: 'Account access agreements and their status, including any awaiting authorisation.',
    icon: ScrollText,
    section: 'records',
    requires: 'consents:view',
  },
  {
    href: '/records/tpp/deliveries',
    label: 'Notification deliveries',
    description: 'One row per attempt, so a notification that never arrived is visible rather than silent.',
    icon: BellRing,
    section: 'records',
    requires: 'tppRegistrations:view',
  },
  {
    href: '/records/audit',
    label: 'Audit trail',
    description: 'Every request this bank answered: who asked, of what, under which consent, and the outcome. Searchable and exportable.',
    icon: FileSearch,
    section: 'records',
    requires: 'bankAudit:view',
    inMenu: true,
  },
];

/** A destination as the signed-in person sees it: their wording, their route. */
export interface ResolvedDestination {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  section: DestinationSection;
}

function resolve(destination: Destination, selfScoped: boolean, accountHolderRef?: string): ResolvedDestination {
  const { href, label, description, icon, section, self } = destination;
  if (!selfScoped || !self) return { href, label, description, icon, section };
  const resolvedHref = accountHolderRef && self.hrefFor ? self.hrefFor(accountHolderRef) : href;
  return { href: resolvedHref, label: self.label, description: self.description, icon, section };
}

/** What this person may open, in catalog order. */
export function destinationsFor(
  access: Access,
  options: { menuOnly?: boolean; accountHolderRef?: string } = {},
): ResolvedDestination[] {
  return DESTINATIONS
    .filter((destination) => (options.menuOnly ? destination.inMenu : true))
    .filter((destination) => access.can(destination.requires))
    .map((destination) => resolve(destination, access.selfScoped, options.accountHolderRef));
}
