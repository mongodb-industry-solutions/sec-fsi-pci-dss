// What each capability's rules ARE, described well enough to render a form.
//
// This exists because the first version of these screens was a textarea holding the raw configuration document.
// That is not an editor: it asks an operator to remember the field names and the legal values, it turns a
// missing brace into a parse error, and it gives no clue that `cvvMode` has exactly three meanings. Worse, it
// invites the one edit nobody should be able to make by accident, which is deleting a key the engine needs.
//
// Every field here carries a sentence saying what it DOES, because these are not preferences. `validCvv` is the
// value this issuer will accept for any card, and an operator changing it should be able to see that from the
// form rather than having to read the engine.
//
// A key the schema does not describe is PRESERVED, never dropped: the engines merge a partial document over
// their own defaults, so a document that lost a key on save would silently change behaviour.

export type RuleField =
  | { kind: 'text'; key: string; label: string; hint?: string; placeholder?: string; maxLength?: number; mono?: boolean }
  | { kind: 'number'; key: string; label: string; hint?: string; min?: number; max?: number; step?: number; suffix?: string }
  | { kind: 'boolean'; key: string; label: string; hint?: string }
  | { kind: 'select'; key: string; label: string; hint?: string; options: { value: string; label: string }[] }
  | { kind: 'stringList'; key: string; label: string; hint?: string; placeholder?: string; uppercase?: boolean }
  | {
    kind: 'group';
    key: string;
    label: string;
    hint?: string;
    /** Names one entry in the collection, e.g. "network". Used on the add and remove controls. */
    itemNoun: string;
    /** Which field titles a collapsed entry, so a list of six is readable without opening each one. */
    titleKey: string;
    fields: RuleField[];
  };

export interface CapabilitySchema {
  title: string;
  description: string;
  sections: { title: string; description?: string; fields: RuleField[] }[];
}

const NETWORK_FIELDS: RuleField[] = [
  { kind: 'text', key: 'name', label: 'Name', mono: true, hint: 'The network as an authorisation names it.' },
  {
    kind: 'stringList',
    key: 'prefixes',
    label: 'Number starts with',
    uppercase: false,
    placeholder: '4 or 51-55',
    hint: 'A single prefix or a range. This is what decides which network a card number belongs to.',
  },
  {
    kind: 'stringList',
    key: 'lengths',
    label: 'Accepted lengths',
    placeholder: '16',
    hint: 'How many digits a valid number of this network has.',
  },
  {
    kind: 'number',
    key: 'cvvLength',
    label: 'Verification value length',
    min: 3,
    max: 4,
    hint: 'Three digits for most networks, four for American Express.',
  },
  { kind: 'boolean', key: 'enabled', label: 'Accepted', hint: 'Turn off to refuse this network without deleting its rules.' },
];

export const CAPABILITY_SCHEMAS: Record<string, CapabilitySchema> = {
  'card-issuer': {
    title: 'Card Issuer',
    description:
      'What this issuer accepts when it validates a card. Every value is read PER CALL, so a change here takes '
      + 'effect on the next authorisation with nothing restarting.',
    sections: [
      {
        title: 'Verification',
        description:
          'How the card verification value is judged. The per-card value is derived from the card data and the '
          + 'issuer key, the way an issuer host derives it inside a hardware module. The global value is a '
          + 'demonstration escape hatch, and the mode decides which of the two is honoured.',
        fields: [
          {
            kind: 'select',
            key: 'cvvMode',
            label: 'Accepted verification value',
            options: [
              { value: 'derived', label: 'Only the value derived for that card' },
              { value: 'global', label: 'Only the global value below' },
              { value: 'both', label: 'Either the derived value or the global one' },
            ],
            hint: 'Set this to the derived value alone to make the issuer behave as a real one does.',
          },
          {
            kind: 'text',
            key: 'validCvv',
            label: 'Global value',
            mono: true,
            maxLength: 4,
            hint: 'Accepted for ANY card while the mode above allows it. It is not a secret and it is not stored against a card.',
          },
          {
            kind: 'boolean',
            key: 'enforceLuhn',
            label: 'Require a valid check digit',
            hint: 'Rejects a number whose check digit does not compute. Turn it off only to test what a malformed number does.',
          },
          {
            kind: 'boolean',
            key: 'verifyCardholderName',
            label: 'Verify the cardholder name',
            hint: 'Most card schemes do not carry the name in an authorisation, so this is normally off.',
          },
        ],
      },
      {
        title: 'Networks',
        description:
          'The card networks this issuer recognises, and the format rules for each. A number matching no '
          + 'enabled network is refused as unrecognised rather than declined.',
        fields: [
          {
            kind: 'group',
            key: 'networks',
            label: 'Accepted networks',
            itemNoun: 'network',
            titleKey: 'name',
            fields: NETWORK_FIELDS,
          },
        ],
      },
    ],
  },

  'card-authorization': {
    title: 'Card Authorisation',
    description:
      'How this bank answers an authorisation request. The response codes it replies with are the card rail\'s '
      + 'own, so an approval and each kind of decline are distinguishable by a caller that speaks the rail.',
    sections: [
      {
        title: 'Behaviour',
        fields: [
          {
            kind: 'select',
            key: 'simulatorMode',
            label: 'Decision mode',
            options: [
              { value: 'scenario_driven', label: 'Follow the scenario the request describes' },
              { value: 'always_approve', label: 'Approve everything' },
              { value: 'always_decline', label: 'Decline everything' },
            ],
            hint: 'Scenario-driven is the honest one: the decision follows the card, the limits and the balance.',
          },
          {
            kind: 'boolean',
            key: 'enableThreeDS',
            label: 'Require cardholder authentication',
            hint: 'Adds the step-up a card-not-present payment asks for.',
          },
        ],
      },
    ],
  },

  aisp: {
    title: 'Account Information',
    description:
      'What a third party may read under a consent, and how much of it at once. These are ceilings on the '
      + 'standard\'s own account and transaction endpoints, not a separate permission model.',
    sections: [
      {
        title: 'Transaction pages',
        fields: [
          {
            kind: 'number',
            key: 'defaultTransactionLimit',
            label: 'Default page size',
            min: 1,
            max: 500,
            suffix: 'transactions',
            hint: 'What a caller gets when it asks for no size.',
          },
          {
            kind: 'number',
            key: 'maxTransactionLimit',
            label: 'Largest page',
            min: 1,
            max: 2000,
            suffix: 'transactions',
            hint: 'The ceiling. A caller asking for more is given this, not an error.',
          },
        ],
      },
    ],
  },

  pisp: {
    title: 'Payment Initiation',
    description:
      'The payment products this bank offers a third party, and the largest instruction it will accept. A '
      + 'product that is not listed is refused as unsupported rather than failing later.',
    sections: [
      {
        title: 'Limits',
        fields: [
          {
            kind: 'number',
            key: 'maxInstructedAmount',
            label: 'Largest instruction',
            min: 0,
            step: 100,
            hint: 'Anything above this is refused at initiation, before a consent is even asked for.',
          },
        ],
      },
      {
        title: 'Products',
        fields: [
          {
            kind: 'stringList',
            key: 'enabledPaymentProducts',
            label: 'Offered products',
            placeholder: 'sepa-credit-transfers',
            hint: 'The product names the standard defines. A caller naming one that is not here is told it is unsupported.',
          },
        ],
      },
    ],
  },

  consent: {
    title: 'Consent',
    description:
      'Whether an access agreement lands usable or waits for the account holder, and how long it stays valid. '
      + 'This is the setting that decides whether the consent step in a flow is real.',
    sections: [
      {
        title: 'Authorisation',
        fields: [
          {
            kind: 'select',
            key: 'consentMode',
            label: 'How a new consent is authorised',
            options: [
              { value: 'automatic', label: 'Authorised on creation, for a demonstration that should not stop' },
              { value: 'manual', label: 'Waits for the account holder to authorise it' },
            ],
            hint: 'Manual is what a real bank does: a consent that is created is not yet a consent that is usable.',
          },
          {
            kind: 'number',
            key: 'defaultValidityDays',
            label: 'Validity',
            min: 1,
            max: 365,
            suffix: 'days',
            hint: 'How long an access agreement lasts before it has to be renewed.',
          },
          {
            kind: 'number',
            key: 'defaultFrequencyPerDay',
            label: 'Reads per day',
            min: 1,
            max: 100,
            hint: 'How often a third party may read the accounts without the holder present.',
          },
        ],
      },
    ],
  },

  'credit-bureau': {
    title: 'Credit Bureau',
    description:
      'How this bank assesses a party it banks. The score is built from a base plus what the relationship and '
      + 'the balances earn, minus what returned payments cost, and the bands turn that number into a rating.',
    sections: [
      {
        title: 'The score',
        fields: [
          { kind: 'number', key: 'baseScore', label: 'Starting score', min: 0, max: 1000, hint: 'Where a party with no history begins.' },
          { kind: 'number', key: 'minimumScore', label: 'Floor', min: 0, max: 1000 },
          { kind: 'number', key: 'maximumScore', label: 'Ceiling', min: 0, max: 1000 },
          { kind: 'number', key: 'historyDays', label: 'History considered', min: 1, suffix: 'days', hint: 'How far back the assessment looks.' },
        ],
      },
      {
        title: 'What the relationship earns',
        fields: [
          { kind: 'number', key: 'pointsPerRelationshipYear', label: 'Points per year banked', min: 0 },
          { kind: 'number', key: 'maximumRelationshipPoints', label: 'Most a relationship can earn', min: 0 },
          { kind: 'number', key: 'pointsPerReturnedPayment', label: 'Points a returned payment costs', min: 0 },
        ],
      },
      {
        title: 'Rating bands',
        description: 'The rating a score maps to. Read from the top down, so the first band a score reaches wins.',
        fields: [
          {
            kind: 'group',
            key: 'ratingBands',
            label: 'Bands',
            itemNoun: 'band',
            titleKey: 'rating',
            fields: [
              { kind: 'text', key: 'rating', label: 'Rating', mono: true, maxLength: 3 },
              { kind: 'number', key: 'minimumScore', label: 'From score', min: 0, max: 1000 },
            ],
          },
        ],
      },
      {
        title: 'Balance bands',
        description: 'What a held balance earns. Read from the top down, so the highest band a balance reaches wins.',
        fields: [
          {
            kind: 'group',
            key: 'balanceBands',
            label: 'Bands',
            itemNoun: 'band',
            titleKey: 'minimumBalance',
            fields: [
              { kind: 'number', key: 'minimumBalance', label: 'Balance of at least', min: 0 },
              { kind: 'number', key: 'points', label: 'Points earned', min: 0 },
            ],
          },
        ],
      },
    ],
  },
};

/** Every key the schema describes, so a save can tell a described key from one it must preserve untouched. */
export function describedKeys(schema: CapabilitySchema): string[] {
  return schema.sections.flatMap((section) => section.fields.map((field) => field.key));
}
