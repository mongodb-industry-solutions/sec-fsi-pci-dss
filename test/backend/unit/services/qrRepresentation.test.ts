/**
 * Unit tests (dev.v35, CH-5): shared QR representation capability.
 * Source: backend/src/modules/gateway/services/qrRepresentation.service.ts
 *
 * Covers the v35 corrections:
 *   CH-1  the EPC069-12 payload is never persisted, only derived on read from the QE-protected
 *         parent records, so no cleartext IBAN or payee name reaches this collection
 *   CH-2  an unsupported payloadFormat is rejected, never silently downgraded to `url`
 * plus the pre-existing lifecycle behaviour that had no coverage: idempotency per subject, expiry,
 * and single-use consumption.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  issueQr, getQr, resolveQr, buildEpcPayload, QrPayloadError,
} from '../../../../backend/src/modules/gateway/services/qrRepresentation.service';
import type { QrPaymentRepresentation } from '../../../../backend/src/modules/gateway/models/qrRepresentation.model';

const IBAN = 'ES9121000418450200051332';

// Mock db routed per collection: the QR record plus the two parents the EPC form is derived from.
function mockDb(opts: {
  existing?: Partial<QrPaymentRepresentation> | null;
  request?: Record<string, unknown> | null;
  account?: Record<string, unknown> | null;
} = {}) {
  const insertOne = vi.fn().mockResolvedValue({ insertedId: 'x' });
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const qrFindOne = vi.fn().mockResolvedValue(opts.existing ?? null);

  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'paymentRequestProcedure') return { findOne: vi.fn().mockResolvedValue(opts.request ?? null) };
      if (name === 'payoutAccountArrangement') return { findOne: vi.fn().mockResolvedValue(opts.account ?? null) };
      return { findOne: qrFindOne, insertOne, updateOne };
    }),
  } as never;
  return { db, insertOne, updateOne, qrFindOne };
}

// A seeded RTP request plus its payout account, enough for the EPC derivation to succeed.
const EPC_PARENTS = {
  request: {
    paymentRequestInstanceReference: 'req-1',
    payeeReceivingAccountReference: 'acct-1',
    payeeName: 'N'.repeat(80),
    amount: 12.5,
    currency: 'EUR',
    purpose: 'R'.repeat(160),
  },
  account: { payoutAccountIban: IBAN },
};

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

describe('issueQr: idempotency per subject', () => {
  it('returns the existing live QR without inserting a second record', async () => {
    const { db, insertOne } = mockDb({
      existing: {
        qrRepresentationInstanceReference: 'qr-1', subjectType: 'rtp_request',
        subjectReference: 'req-1', payloadFormat: 'url', encodedPayload: 'https://app/x',
        expiresAt: future(),
      } as Partial<QrPaymentRepresentation>,
    });

    const out = await issueQr(db, { subjectType: 'rtp_request', subjectReference: 'req-1' });

    expect(out.qrRepresentationInstanceReference).toBe('qr-1');
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('issues a fresh QR when the existing one has expired', async () => {
    const { db, insertOne } = mockDb({
      existing: {
        qrRepresentationInstanceReference: 'qr-old', subjectType: 'rtp_request',
        subjectReference: 'req-1', payloadFormat: 'url', expiresAt: past(),
      } as Partial<QrPaymentRepresentation>,
    });

    const out = await issueQr(db, { subjectType: 'rtp_request', subjectReference: 'req-1' });

    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(out.qrRepresentationInstanceReference).not.toBe('qr-old');
  });

  it('scopes the reuse lookup to the subject and to unconsumed records', async () => {
    const { db, qrFindOne } = mockDb();
    await issueQr(db, { subjectType: 'payment_link', subjectReference: 'link-9' });
    expect(qrFindOne).toHaveBeenCalledWith({
      subjectType: 'payment_link', subjectReference: 'link-9', consumedAt: { $exists: false },
    });
  });
});

describe('issueQr: payload format (CH-2)', () => {
  it('defaults to a signed deep link, which is the only durable payload', async () => {
    const { db, insertOne } = mockDb();
    const out = await issueQr(db, { subjectType: 'payment_link', subjectReference: 'link-1' });

    expect(out.payloadFormat).toBe('url');
    expect(out.encodedPayload).toContain('/gateway/pay/link-1');
    expect(insertOne.mock.calls[0][0].encodedPayload).toBe(out.encodedPayload);
  });

  it('rejects an unsupported format instead of silently returning a url', async () => {
    const { db, insertOne } = mockDb();
    await expect(issueQr(db, {
      subjectType: 'rtp_request', subjectReference: 'req-1', payloadFormat: 'emvco' as never,
    })).rejects.toBeInstanceOf(QrPayloadError);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('rejects sepa_epc for a subject with no derivable creditor account', async () => {
    const { db, insertOne } = mockDb();
    await expect(issueQr(db, {
      subjectType: 'payment_link', subjectReference: 'link-1', payloadFormat: 'sepa_epc',
    })).rejects.toBeInstanceOf(QrPayloadError);
    expect(insertOne).not.toHaveBeenCalled();
  });
});

describe('issueQr: the EPC payload is derived, never persisted (CH-1)', () => {
  it('stores no encodedPayload for sepa_epc but returns the derived one', async () => {
    const { db, insertOne } = mockDb(EPC_PARENTS);

    const out = await issueQr(db, {
      subjectType: 'rtp_request', subjectReference: 'req-1', payloadFormat: 'sepa_epc',
    });

    const stored = insertOne.mock.calls[0][0];
    expect(stored.encodedPayload).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain(IBAN);
    expect(out.encodedPayload).toContain(IBAN);
  });

  it('fails with 409 when the creditor account cannot be resolved', async () => {
    const { db } = mockDb({ request: EPC_PARENTS.request, account: null });
    await expect(issueQr(db, {
      subjectType: 'rtp_request', subjectReference: 'req-1', payloadFormat: 'sepa_epc',
    })).rejects.toMatchObject({ code: 'epc_source_unavailable', httpStatus: 409 });
  });

  it('derives the payload on read, from the QE-protected parents', async () => {
    const { db } = mockDb({
      ...EPC_PARENTS,
      existing: {
        qrRepresentationInstanceReference: 'qr-1', subjectType: 'rtp_request',
        subjectReference: 'req-1', payloadFormat: 'sepa_epc', expiresAt: future(),
      } as Partial<QrPaymentRepresentation>,
    });

    const out = await getQr(db, 'qr-1');
    expect(out!.encodedPayload).toContain(IBAN);
  });
});

describe('buildEpcPayload: EPC069-12 SCT structure', () => {
  it('builds the payload to spec and truncates the bounded fields', () => {
    const lines = buildEpcPayload({
      iban: IBAN, payeeName: 'N'.repeat(80), remittance: 'R'.repeat(160),
      amount: 12.5, currency: 'EUR',
    }).split('\n');

    expect(lines[0]).toBe('BCD');      // service tag
    expect(lines[1]).toBe('002');      // version
    expect(lines[2]).toBe('1');        // character set (UTF-8)
    expect(lines[3]).toBe('SCT');      // identification
    expect(lines[5]).toHaveLength(70);              // payee name capped
    expect(lines[6]).toBe(IBAN);
    expect(lines[7]).toBe('EUR12.50');              // amount with 2 decimals
    expect(lines[10]).toHaveLength(140);            // remittance capped
  });

  it('omits the amount when none is given', () => {
    expect(buildEpcPayload({ iban: IBAN }).split('\n')[7]).toBe('');
  });
});

describe('resolveQr', () => {
  it('returns null when the reference does not exist', async () => {
    const { db } = mockDb();
    expect(await resolveQr(db, 'missing')).toBeNull();
  });

  it('returns null for an already consumed QR', async () => {
    const { db } = mockDb({ existing: { qrRepresentationInstanceReference: 'qr-1', consumedAt: past() } as Partial<QrPaymentRepresentation> });
    expect(await resolveQr(db, 'qr-1')).toBeNull();
  });

  it('returns null for an expired QR', async () => {
    const { db } = mockDb({ existing: { qrRepresentationInstanceReference: 'qr-1', expiresAt: past() } as Partial<QrPaymentRepresentation> });
    expect(await resolveQr(db, 'qr-1')).toBeNull();
  });

  it('marks a single-use QR consumed exactly once', async () => {
    const { db, updateOne } = mockDb({
      existing: {
        qrRepresentationInstanceReference: 'qr-1', payloadFormat: 'url',
        singleUse: true, expiresAt: future(),
      } as Partial<QrPaymentRepresentation>,
    });

    const out = await resolveQr(db, 'qr-1');

    expect(out).not.toBeNull();
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toEqual({ qrRepresentationInstanceReference: 'qr-1' });
    expect(update.$set.consumedAt).toBeInstanceOf(Date);
  });

  it('does not consume a reusable QR', async () => {
    const { db, updateOne } = mockDb({
      existing: {
        qrRepresentationInstanceReference: 'qr-1', payloadFormat: 'url',
        singleUse: false, expiresAt: future(),
      } as Partial<QrPaymentRepresentation>,
    });

    expect(await resolveQr(db, 'qr-1')).not.toBeNull();
    expect(updateOne).not.toHaveBeenCalled();
  });
});
