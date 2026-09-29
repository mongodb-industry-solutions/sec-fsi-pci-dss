import { Banknote, CreditCard, ScrollText, Settings2, User, type LucideIcon } from 'lucide-react';

// The role guide, written for a person rather than derived from claims.
//
// The authority is the source of truth for what a role may do; this file is the source of truth for what a
// role is FOR. The two are kept deliberately close: every `can` entry below corresponds to a permission the
// authority actually grants, and every `cannot` entry to one it deliberately withholds, so a reader who is
// told "you may not" also learns why nobody thought that was a gap.

export interface RoleAbility {
  what: string;
  why: string;
}

export interface BankRoleGuide {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The accent used for this role's avatar in the header, kept in step so the guide reads as the same person. */
  avatar: string;
  headline: string;
  /** Who in the bank actually holds it, in plain terms. */
  who: string;
  /** 'all' sees the whole bank; 'self' is bound to one subject's own records. */
  scope: 'all' | 'self';
  purpose: string;
  can: RoleAbility[];
  cannot: RoleAbility[];
  /** Why this shape of role exists at all, in duty-separation terms. */
  separation: string;
}

export const BANK_ROLE_GUIDE: BankRoleGuide[] = [
  {
    id: 'bank_operations',
    label: 'Operations',
    icon: Banknote,
    avatar: 'bg-teal-600',
    headline: 'Runs the bank day to day: the people, their accounts and the cards drawn on them.',
    who: 'Branch and back-office staff who service customers.',
    scope: 'all',
    purpose:
      'The role that gets work done on a customer record. It opens and approves accounts, maintains the party behind them, issues and blocks cards, and reads the movements that explain a balance.',
    can: [
      { what: 'Read and administer account holders', why: 'Servicing a customer means correcting their record, not only looking at it.' },
      { what: 'Read and administer accounts, including approving a new one', why: 'The approval step is an operations decision and is recorded as one.' },
      { what: 'Reveal a full account number', why: 'Tracing where a transfer landed needs the account number itself. It is personal data, protected under the privacy rules, and every reveal is one audited act.' },
      { what: 'Reveal an account holder name and contact details', why: 'Those are encrypted at rest and arrive masked, so contacting a customer is an explicit, logged request rather than a side effect of opening a page.' },
      { what: 'Read ledger movements', why: 'A balance nobody can explain is a balance nobody can defend to a customer.' },
      { what: 'Issue, block and replace cards', why: 'A lost card has to be stoppable by the person the customer is already talking to.' },
      { what: 'Read credit assessments', why: 'The assessment informs the servicing decision; running one is a separate authority.' },
    ],
    cannot: [
      { what: 'Reveal a card number', why: 'Authority to administer a card is deliberately not authority to read it. That one permission sits with the Card Officer and nowhere else, which is what makes every disclosure attributable to a named person in a named role.' },
      { what: 'Correct a ledger record', why: 'Changing the bank’s own books is not a servicing task. It belongs to a role whose actions are reviewed rather than to the role that faces the customer.' },
      { what: 'Configure the bank, or register a third party', why: 'Whoever grants access should not also be the heaviest user of it.' },
      { what: 'Read the request trail', why: 'The trail records this role’s own work, so reading it belongs to oversight.' },
    ],
    separation:
      'This is the busiest role, so it is the one whose limits matter most. It can touch almost every customer record and cannot read a single card number, cannot rewrite the ledger, and cannot see the log of what it did.',
  },
  {
    id: 'bank_card_officer',
    label: 'Card Officer',
    icon: CreditCard,
    avatar: 'bg-orange-600',
    headline: 'The one role that may disclose a card number from the issuer vault.',
    who: 'The card operations desk, handling disputes and reissues.',
    scope: 'all',
    purpose:
      'Card administration, plus the single most sensitive read in the bank. A card number is protected under the card security rules, which is why it is a resource of its own rather than a field on the card record.',
    can: [
      { what: 'Disclose a full card number', why: 'A dispute or a reissue sometimes cannot be resolved without it. The disclosure is a request that produces one audit row, not a page that happens to contain the number.' },
      { what: 'Issue, block and replace cards', why: 'The lifecycle belongs with the desk that answers for the card.' },
      { what: 'Read account holders and accounts', why: 'Enough context to know whose card it is. Read only, and masked.' },
    ],
    cannot: [
      { what: 'Reveal an account number or a holder’s contact details', why: 'Holding the one authority that reads a card number is reason to hold no other disclosure. Concentrating reveals in one role would make the audit trail say less, not more.' },
      { what: 'Administer accounts or account holders', why: 'Reading a customer for card context is not permission to change them.' },
      { what: 'Read the request trail', why: 'This role produces the most sensitive entries in it, so it does not get to read it.' },
    ],
    separation:
      'The exclusivity is the control. Because no other role holds it, a card disclosure in the trail names a person in this role, which is what turns a logged reveal into a reviewable one.',
  },
  {
    id: 'bank_compliance',
    label: 'Compliance',
    icon: ScrollText,
    avatar: 'bg-purple-600',
    headline: 'Read-only oversight across the whole bank, including the request trail.',
    who: 'The team that answers to the regulator and to internal audit.',
    scope: 'all',
    purpose:
      'Sees everything and changes nothing. The breadth is the point: an investigation that has to ask another team for half its evidence is an investigation that leaves a record of its own.',
    can: [
      { what: 'Read account holders, accounts, movements and cards', why: 'The whole picture, because a pattern is only visible across records.' },
      { what: 'Reveal an account number and a holder’s contact details', why: 'An investigation that cannot resolve which account a movement landed in is not an investigation. Both reveals are reads, so they do not break the read-only shape of the role.' },
      { what: 'Read account-access consents and registered third parties', why: 'Who was allowed to reach this bank’s data, and under what agreement.' },
      { what: 'Read the request trail', why: 'Every request the bank answered, including who revealed what.' },
      { what: 'Read the identity authority’s records', why: 'Access decisions are evidence too: which roles exist, who holds them, which sessions were opened.' },
    ],
    cannot: [
      { what: 'Change anything at all', why: 'Someone who can change what they oversee cannot attest to it. Not one permission in this role grants a mutation, and adding one would end the role’s independence.' },
      { what: 'Reveal a card number', why: 'Oversight reviews that a disclosure happened and who made it, which the trail already carries. Being able to disclose would make the reviewer indistinguishable from the reviewed.' },
      { what: 'Revoke a consent', why: 'Revocation has a live effect on a third party’s access, so it is an operational act on the very arrangement this role audits.' },
    ],
    separation:
      'The widest read in the bank paired with no write at all. That combination is what lets one role be trusted with everything.',
  },
  {
    id: 'bank_admin',
    label: 'Administrator',
    icon: Settings2,
    avatar: 'bg-slate-600',
    headline: 'Configures the bank without reading what flows through it.',
    who: 'Platform and integration owners.',
    scope: 'all',
    purpose:
      'Registers the third parties that may reach the banking API, maintains which institutions are reachable, sets engine policy, and administers identities at the authority.',
    can: [
      { what: 'Register and suspend third parties', why: 'Who may call this bank’s API, and in which capacity.' },
      { what: 'Administer reachable institutions', why: 'Where a transfer can be sent, and by which scheme.' },
      { what: 'Administer engine configuration', why: 'The rules screens: issuer checks, authorisation behaviour, consent lifetime, scoring bands.' },
      { what: 'Revoke an account-access consent', why: 'When a third party has to be cut off, someone has to be able to do it.' },
      { what: 'Read the request trail', why: 'Operating the platform includes seeing what it answered.' },
      { what: 'Administer the identity authority', why: 'Realms, clients, identities, roles and assignments, which is where access itself is granted.' },
    ],
    cannot: [
      { what: 'Read any account, account holder or movement', why: 'A configuration role has no need for customer data. Granting it would collapse the separation this role exists to maintain, because the person who grants access would also be the person the access reaches.' },
      { what: 'Reveal a card number', why: 'Administering the bank does not include disclosing what it protects.' },
      { what: 'Issue or block a card', why: 'Card lifecycle is an operational act on a customer’s instrument.' },
    ],
    separation:
      'The most powerful role in the system and the one with the least data. It can grant itself another role, which is exactly why that act is written to the trail that Compliance reads.',
  },
  {
    id: 'bank_customer',
    label: 'Account Holder',
    icon: User,
    avatar: 'bg-blue-600',
    headline: 'A customer of this bank, seeing their own records and nobody else’s.',
    who: 'The person the accounts belong to.',
    scope: 'self',
    purpose:
      'Direct access to their own accounts, balances, movements and cards. No consent is involved, because there is no third party in the arrangement: this is their own data at their own institution.',
    can: [
      { what: 'Read their own accounts and balances', why: 'Their data, at their bank, without an intermediary.' },
      { what: 'Read their own movements', why: 'The statement, live.' },
      { what: 'Read the cards they hold', why: 'Status and limits, masked.' },
    ],
    cannot: [
      { what: 'Reach anybody else’s records', why: 'The role is bound to the holder reference on the signed-in identity, not merely filtered in the interface. A request for another holder is refused at the bank, not hidden by the page.' },
      { what: 'Reveal their own card number', why: 'They see the card they hold, not its stored number. The number is disclosed through the Card Officer’s audited path.' },
      { what: 'Reveal their own account number', why: 'It reaches them through their statement, which is a banking product. The staff disclosure route exists so an audit row means an employee revealed somebody’s data, and a customer reading their own would make that signal meaningless.' },
      { what: 'Change anything', why: 'Self-service changes are a product surface, not an administration one.' },
    ],
    separation:
      'The only role bound by subject rather than by breadth. Two account holders hold identical permissions and can reach entirely disjoint data, which no permission list alone could express.',
  },
];

export function findRoleGuide(id: string): BankRoleGuide | undefined {
  return BANK_ROLE_GUIDE.find((role) => role.id === id);
}
