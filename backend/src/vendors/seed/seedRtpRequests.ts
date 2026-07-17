import { Db } from 'mongodb';
import { createHash } from 'crypto';
import {
  PAYMENT_REQUEST_COLLECTION,
  PaymentRequestProcedure,
} from '../../modules/gateway/models/paymentRequest.model';

// v28 Request to Pay demo data (deterministic IDs, idempotent upsert). A few requests across
// lifecycle statuses so the transfers inbox/outbox and back-office search have content on --reset.
//
// Demo parties/accounts (verified against data/payoutAccounts.json):
//   party b0000002 (account pau00002) is the PAYEE (requester, receives funds)
//   party b0000001 (account pau00001) is the PAYER (approves, funds)
// RTP is account/alias-based → outside PCI scope. Aliases stored hashed + QE:none plaintext.

const PAYEE_PARTY = 'b0000002-0000-4000-8000-000000000002';
const PAYEE_ACCOUNT = 'pau00002-0000-4000-8000-000000000002';
const PAYER_PARTY = 'b0000001-0000-4000-8000-000000000001';
const PAYER_ACCOUNT = 'pau00001-0000-4000-8000-000000000001';

const sha256 = (v: string) => createHash('sha256').update(v.trim().toLowerCase()).digest('hex');

function baseRequest(
  ref: string,
  status: PaymentRequestProcedure['status'],
  amount: number,
  purpose: string,
  daysToExpiry: number,
): PaymentRequestProcedure {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + daysToExpiry * 24 * 3600 * 1000);
  const payeeAlias = 'payee2@leafybank.example';
  return {
    paymentRequestInstanceReference: ref,
    requestVersion: 1,
    requesterPartyReference: PAYEE_PARTY,
    payeeName: 'Leafy Demo Payee',
    payeeAlias,
    payeeAliasHash: sha256(payeeAlias),
    payeeReceivingAccountReference: PAYEE_ACCOUNT,
    payerPartyReference: PAYER_PARTY,
    payerFundingAccountReference: status === 'created' ? undefined : PAYER_ACCOUNT,
    amount,
    currency: 'EUR',
    purpose,
    dueAt: expiresAt,
    expiresAt,
    allowPartialPayment: false,
    allowMultiplePayments: false,
    supportedRails: ['sepa'],
    preferredRail: 'sepa',
    structuredRemittance: { referenceType: 'SCOR', reference: `RF-${ref.slice(0, 6)}` },
    riskFlags: [],
    policyDecisions: [],
    status,
    presentationChannel: 'in_app',
    deliveryChannel: 'in_app',
    bianServiceDomain: 'Payment Order',
    bianControlRecordType: 'PaymentRequestProcedure',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };
}

const DEMO_REQUESTS: PaymentRequestProcedure[] = [
  baseRequest('rtp00001-0000-4000-8000-000000000001', 'created', 42.5, 'Dinner split', 14),
  baseRequest('rtp00002-0000-4000-8000-000000000002', 'presented', 120, 'Shared rent (June)', 10),
  { ...baseRequest('rtp00003-0000-4000-8000-000000000003', 'accepted', 75, 'Concert tickets', 7),
    authorizationContext: {
      authMethod: 'session_jwt', subject: PAYER_PARTY, channel: 'in_app',
      authenticatedAt: new Date(), authResult: 'approved',
    } },
  baseRequest('rtp00004-0000-4000-8000-000000000004', 'expired', 15, 'Coffee round', -2),
];

export async function seedRtpRequests(db: Db): Promise<void> {
  const coll = db.collection<PaymentRequestProcedure>(PAYMENT_REQUEST_COLLECTION);
  for (const req of DEMO_REQUESTS) {
    const exists = await coll.findOne({ paymentRequestInstanceReference: req.paymentRequestInstanceReference });
    if (exists) continue;
    await coll.insertOne(req);
  }
  console.log(`  seeded: ${DEMO_REQUESTS.length} RTP requests (${PAYMENT_REQUEST_COLLECTION})`);
}
