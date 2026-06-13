// One-off generator for paymentCards.json seed data (BIAN SD-88).
// Produces 3-4 cards per REAL customer agreement so the card-on-file list, the payment
// card picker and the detail view all have realistic data. PCI DSS: only masked PAN +
// surrogate token + expiry (no PAN, no CVV). Run: node bin/generateCards.mjs
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');

const agreements = JSON.parse(readFileSync(join(dataDir, 'customerAgreements.json'), 'utf-8'));

const NETWORKS = ['VISA', 'MASTERCARD', 'AMEX', 'ELO'];
const ALIASES = [
  'Personal', 'Work', 'Travel', 'Backup', 'Online shopping', 'Groceries',
  'Subscriptions', 'Family', 'Emergency', 'Business', 'Everyday', 'Savings-linked',
];
const NOTES = [
  'Main card for recurring bills.',
  'Use only for online purchases.',
  'Travel card — low FX fees.',
  'Backup card, rarely used.',
  'Shared household expenses.',
  null, null, null, // many cards have no note
];

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[rnd(16)]).join('');
const last4 = () => String(rnd(10000)).padStart(4, '0');

// A date in the past, between `minDaysAgo` and `maxDaysAgo` from 2026-06-13.
const NOW = new Date('2026-06-13T12:00:00.000Z').getTime();
const DAY = 86400000;
const pastDate = (minDaysAgo, maxDaysAgo) =>
  new Date(NOW - (minDaysAgo + rnd(maxDaysAgo - minDaysAgo)) * DAY).toISOString();

// Valid MM/YY expiry in the future (2027-2031).
const expiry = () => `${String(1 + rnd(12)).padStart(2, '0')}/${27 + rnd(5)}`;

const cards = [];

for (const ag of agreements) {
  const agId = ag.customerAgreementInstanceReference;
  const count = 3 + rnd(2); // 3 or 4 cards per customer
  const usedAliases = new Set();
  const usedNetworks = [];

  for (let i = 0; i < count; i++) {
    // unique alias per customer
    let alias;
    do { alias = pick(ALIASES); } while (usedAliases.has(alias));
    usedAliases.add(alias);

    const network = pick(NETWORKS);
    usedNetworks.push(network);

    const created = pastDate(20, 700);
    // Keep cards mostly active (usable in the payment flow). The last card of a
    // customer with 4 cards may be expired/blocked for list-filter realism, but every
    // customer keeps at least 2 active cards.
    let status = 'active';
    if (count === 4 && i === 3) status = pick(['expired', 'blocked', 'active']);

    const note = pick(NOTES);

    const card = {
      paymentCardInstanceReference: randomUUID(),
      customerAgreementInstanceReference: agId,
      paymentCardReference: `tok_${hex(16)}`,
      paymentCardExpirationDate: expiry(),
      paymentCardMaskedPanDisplay: `****-****-****-${last4()}`,
      paymentCardNetwork: network,
      paymentCardStatus: status,
      paymentCardIssuanceDateTime: created,
      paymentCardIsPreferred: false, // set below
      paymentCardAlias: alias,
      bianServiceDomain: 'Payment Card',
      bianControlRecordType: 'PaymentCardManagement',
      recordCreatedDateTime: created,
      schemaVersion: 1,
    };
    if (note) card.paymentCardCustomerNote = note;
    cards.push(card);
  }

  // Mark the first ACTIVE card of this customer as preferred (default for recurring).
  const mine = cards.slice(cards.length - count);
  const firstActive = mine.find((c) => c.paymentCardStatus === 'active') ?? mine[0];
  firstActive.paymentCardIsPreferred = true;
}

writeFileSync(join(dataDir, 'paymentCards.json'), JSON.stringify(cards, null, 2) + '\n');
console.log(`Generated ${cards.length} cards across ${agreements.length} customer agreements`);
