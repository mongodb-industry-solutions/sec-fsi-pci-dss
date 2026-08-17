// v37 P0.7: every PSP collection is declared as moving to bankcore or staying, exactly once.
// An unlisted collection means undocumented ownership, the defect the Module to Collection matrix
// rule exists to prevent, and it would be discovered only when a demo breaks.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, join } from 'path';

const BACKEND_SRC = resolve(__dirname, '../../../../backend/src');
const EVENTBUS_SRC = resolve(__dirname, '../../../../packages/eventbus/src');

// Collections whose ownership moves to bankcore. Mirrors the plan's "Collection split" table.
const MOVES_TO_BANKCORE = new Set([
  'balanceCreditLog',
  'cardIssuerVault',
  'paymentCardRegistry',
  'cardAuthorizationRecord',
  'customerCreditRatingState',
  'recurringMandateProcedure',
]);

// Collections that stay at the PSP. `domainEvent`, `counters` and `idempotencyKey` appear here
// because the PSP keeps its own instance; bankcore gets separate ones in its own database.
const STAYS_AT_PSP = new Set([
  'paymentExecutionProcedure', 'paymentOrderProcedure', 'cardTransactionLog', 'checkoutSessionLog',
  'paymentLinkRecord',
  // Stays as a linked account record: it loses the stored balance, not its home (see the plan).
  'payoutAccountArrangement', 'counterpartyArrangement',
  'paymentCardManagement', 'cardEtokenProcedure',
  'paymentRequestProcedure', 'paymentRequestEvent', 'qrPaymentRepresentation', 'rtpAliasDirectoryCache',
  'party', 'customerAuthenticationAssessment', 'authenticationDomain', 'role',
  'partyAuthenticationKey', 'partyAuthorizationCode', 'partyIssuedToken',
  'partyBackchannelAuthentication', 'partyEnrolledCredential', 'partyAuthenticationAssessment',
  'consentAgreement', 'partyAuthConsent', 'consentAccessLog',
  'customerAgreementProcedure', 'merchantAgreementProcedure', 'merchantAgreementEvents',
  'fraudDiagnosisCase', 'fraudDiagnosisCaseEvents', 'fraudDiagnosisCustomerQuestion',
  'externalProviderArrangement', 'externalProviderArrangementPortfolio',
  'externalProviderArrangementActionLog', 'capabilityModuleConfiguration',
  'businessProcessEvent', 'complianceProcessEvent', 'domainEvent',
  'merchantWebhookDeliveryLog',
  'notification', 'demoTeamContact', 'counters', 'idempotencyKey',
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

// Every `*_COLLECTION = 'name'` constant declared in the PSP sources and in the shared event bus.
function declaredCollections(): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /\b([A-Z0-9_]*COLLECTION[A-Z0-9_]*)\s*=\s*'([a-zA-Z]+)'/g;
  for (const file of [...sourceFiles(BACKEND_SRC), ...sourceFiles(EVENTBUS_SRC)]) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(pattern)) found.set(match[2], match[1]);
  }
  return found;
}

describe('v37 P0.7: collection split exhaustiveness', () => {
  it('every declared collection appears in exactly one side of the split', () => {
    const unlisted: string[] = [];
    const both: string[] = [];
    for (const name of declaredCollections().keys()) {
      const moves = MOVES_TO_BANKCORE.has(name);
      const stays = STAYS_AT_PSP.has(name);
      if (moves && stays) both.push(name);
      if (!moves && !stays) unlisted.push(name);
    }
    expect(unlisted, 'collections with undocumented ownership').toEqual([]);
    expect(both, 'collections declared on both sides').toEqual([]);
  });

  it('the split declares no collection the sources do not', () => {
    const declared = new Set(declaredCollections().keys());
    const stale = [...MOVES_TO_BANKCORE, ...STAYS_AT_PSP].filter((name) => !declared.has(name));
    expect(stale, 'split entries with no constant in the sources').toEqual([]);
  });

  it('the ledger audit log and the issuer vault are on the bank side', () => {
    for (const name of ['balanceCreditLog', 'cardIssuerVault', 'cardAuthorizationRecord']) {
      expect(MOVES_TO_BANKCORE.has(name), `${name} must move`).toBe(true);
    }
  });

  it('payoutAccountArrangement stays, as a linked account record without a balance', () => {
    // The bank owns a new accountArrangement; the PSP keeps the link every consumer already reads.
    expect(STAYS_AT_PSP.has('payoutAccountArrangement')).toBe(true);
    expect(MOVES_TO_BANKCORE.has('payoutAccountArrangement')).toBe(false);
  });

  it('identity and the acceptance token vault stay at the PSP', () => {
    // The user belongs to the PSP and the acceptance-side vault holds no PAN, so neither moves.
    for (const name of ['party', 'customerAuthenticationAssessment', 'cardEtokenProcedure']) {
      expect(STAYS_AT_PSP.has(name), `${name} must stay`).toBe(true);
    }
  });
});
