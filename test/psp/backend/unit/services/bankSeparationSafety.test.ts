/**
 * The two ways separating the bank from the provider could have gone silently wrong.
 *
 * Both are about the same thing: the provider used to BE the issuer, so an issuer verdict was a function call
 * that either returned or threw. It is now another institution across a network, and the failure modes that
 * come with that are ordinary rather than exceptional. Two of them were live after the separation:
 *
 *  1. The bank answers a card validation with `valid`. The payment flow reads `actionConfirmed` and treats an
 *     ABSENT verdict as approval, so an unmapped response approved a card the issuer had REJECTED. Verified
 *     against the real bank: a wrong verification value answers `{"valid":false,"responseCode":"82"}`.
 *  2. The flow approved whenever the issuer could not be reached at all.
 *
 * Neither is caught by a typecheck, because both are shapes crossing a network boundary, and neither shows up
 * in a happy-path test, because the happy path approves either way. Hence these.
 */
import { describe, it, expect } from 'vitest';
import { applyMappings } from '../../../../../psp/backend/src/modules/provider/services/fieldMapping.service';
import { resolveEventInbound } from '../../../../../psp/backend/src/modules/provider/services/providerEventConfig.service';
import type { ExternalProviderArrangement } from '../../../../../psp/backend/src/modules/provider/models/externalProviderArrangement.model';
import { RESPONSE_CODE_ISSUER_UNAVAILABLE } from '../../../../../psp/backend/src/shared/models/responseCodes';
import arrangements from '../../../../../psp/backend/data/externalProviderArrangement.json';

const VALIDATION_EVENT = 'card.issuer.validation.requested';

function cardIssuerArrangement(): ExternalProviderArrangement {
  const found = (arrangements as unknown as ExternalProviderArrangement[])
    .find((record) => record.externalProviderArrangementType === 'card_issuer');
  if (!found) throw new Error('the seed declares no card_issuer arrangement');
  return found;
}

/** What the bank actually answers, taken from a live call rather than imagined. */
const BANK_REJECTS = { valid: false, responseCode: '82', network: 'VISA', cvvValidationResult: 'mismatch', reasons: ['cvv_mismatch'] };
const BANK_ACCEPTS = { valid: true, responseCode: '00', network: 'VISA', cvvValidationResult: 'match', reasons: [] };

/** The flow's own reading of a verdict, as `onIssuer` computes it. */
function approvedByTheFlow(mapped: Record<string, unknown>): boolean {
  return (mapped as { actionConfirmed?: unknown }).actionConfirmed === true;
}

describe("the issuer's verdict survives the translation", () => {
  it('declares an inbound mapping for the validation event at all', () => {
    // Without this the response reaches the flow in the bank's vocabulary and no field it reads is present.
    const rules = resolveEventInbound(cardIssuerArrangement(), VALIDATION_EVENT).mapping;
    expect(rules.length, 'the card validation event must declare an inbound mapping').toBeGreaterThan(0);
    expect(rules.map((rule) => rule.sourcePath)).toContain('valid');
    expect(rules.find((rule) => rule.sourcePath === 'valid')?.targetPath).toBe('actionConfirmed');
  });

  it('turns a REJECTION into a decline, which is the bug this exists for', () => {
    const rules = resolveEventInbound(cardIssuerArrangement(), VALIDATION_EVENT).mapping;
    const mapped = applyMappings(BANK_REJECTS, rules);

    expect(mapped.actionConfirmed, 'the bank said the card is not valid').toBe(false);
    expect(approvedByTheFlow(mapped), 'a card the issuer rejected must not be approved').toBe(false);
    // And the reason travels with it, so the decline says why rather than only that it declined.
    expect(mapped.decisionReason).toBe('cvv_mismatch');
  });

  it('turns an ACCEPTANCE into an approval', () => {
    const rules = resolveEventInbound(cardIssuerArrangement(), VALIDATION_EVENT).mapping;
    const mapped = applyMappings(BANK_ACCEPTS, rules);
    expect(mapped.actionConfirmed).toBe(true);
    expect(approvedByTheFlow(mapped)).toBe(true);
    expect(mapped.responseCode, "the rail's own approval code passes through untouched").toBe('00');
  });

  it('would have approved the rejection WITHOUT the mapping, which is why the mapping is not optional', () => {
    // The pre-fix behaviour, pinned so nobody restores it by removing the mapping and finding tests still green.
    const unmapped = BANK_REJECTS as unknown as Record<string, unknown>;
    expect(unmapped.actionConfirmed).toBeUndefined();
    // The old reading: `decision?.actionConfirmed !== false`.
    expect(undefined !== false, 'an absent verdict read as approval is the defect').toBe(true);
    // The new reading refuses it.
    expect(approvedByTheFlow(unmapped)).toBe(false);
  });
});

describe('a bank-served capability is reachable over the wire', () => {
  // The dispatcher decides between an HTTP call and an in-process stub. That decision used to test
  // `externalProviderApiEndpoint` alone, in three separate places, and for these capabilities that field held
  // a LOOPBACK path back into the provider. Removing the loopback was right and it silently turned all three
  // into the stub branch: the dispatch reported `sent`, nothing was called, and the card validation never
  // reached the bank. It failed closed rather than dangerously, but it failed, and only a live probe showed it.
  const BANK_CAPABILITIES = ['card_issuer', 'card_authorization', 'account_information', 'payment_initiation'];

  it.each(BANK_CAPABILITIES)('%s will have something to call', (capability) => {
    const record = (arrangements as unknown as {
      externalProviderArrangementType: string;
      externalProviderIsInternal?: boolean;
      externalProviderApiEndpoint?: string;
      authConfig?: { scheme?: string };
    }[]).find((entry) => entry.externalProviderArrangementType === capability);

    expect(record, `${capability} must be declared in the seed`).toBeDefined();
    expect(record?.externalProviderIsInternal, `${capability} is served by an institution`).toBe(false);

    // The base url is NOT in the fixture, and should not be: the seeder resolves the environment's bank host
    // onto the record so one fixture is correct in local, staging and production. What the fixture can be held
    // to is the condition the seeder keys on, which is an `oauth2_cc` credential. Without it the seeder writes
    // no base url, no institution declaration and no token, and the dispatch has nowhere to go.
    expect(
      record?.authConfig?.scheme,
      `${capability} needs an oauth2_cc credential, or the seeder writes it no bank host and no institution`,
    ).toBe('oauth2_cc');

    // And no loopback back into the provider, which is what made the stub branch look correct for so long.
    expect(record?.externalProviderApiEndpoint ?? '').not.toContain('/api/v1/modules/');
  });
});

describe('an issuer that cannot be reached does not approve', () => {
  it('has a response code of its own, distinct from an ordinary decline', () => {
    // "Could not ask" and "asked and was declined" are different facts. Sharing one code would bury an
    // integration failure inside a wall of normal declines.
    expect(RESPONSE_CODE_ISSUER_UNAVAILABLE).toBe('91');
  });

  it('reads a missing verdict as no verdict, never as consent', () => {
    for (const answer of [
      {},                                  // an empty body
      { responseCode: '00' },              // a code but no verdict
      { valid: 'yes' },                    // the right field, the wrong type
      { actionConfirmed: 'true' },         // a string, not a boolean
    ] as Record<string, unknown>[]) {
      expect(
        typeof (answer as { actionConfirmed?: unknown }).actionConfirmed === 'boolean',
        `${JSON.stringify(answer)} states no boolean verdict, so it must not approve`,
      ).toBe(false);
      expect(approvedByTheFlow(answer)).toBe(false);
    }
  });
});
