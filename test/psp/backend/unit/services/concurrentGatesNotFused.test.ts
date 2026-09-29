// v37 N4: the concurrent risk gate must NOT be fused into one composite call.
//
// P6 changes how the issuer provider is RESOLVED and turns the funds gate from a local ledger write into a
// remote call to the bank. Both are expected. What must not happen is someone noticing that it is now "one
// hop to the bank" and collapsing the issuer check, the fraud score, the sanctions screen and the funds gate
// into a single request. Each keeps its own dispatch, its own result envelope and its own trace entry.
//
// Why it matters beyond tidiness: a fused call has one verdict, so a decline stops saying WHICH control
// declined. The compliance narrative is built from the separate verdicts, and an investigator reading a case
// needs to know whether it was sanctions or funds. It is also the difference between three providers being
// individually replaceable and one bespoke endpoint nobody else can serve.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../../../..');
const SAGA = 'psp/backend/src/modules/transaction/services/paymentAuthorization.saga.ts';
const REACTORS = 'psp/backend/src/providers/groups/providerGroups.ts';

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function code(path: string): string {
  // Line comments first: one containing `/*` would otherwise open a fake block comment and swallow real
  // code, which in a negative assertion makes a gate pass by deleting what it should be checking.
  return source(path)
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('v37 N4: the card authorisation gates stay separate', () => {
  it('the saga still expects four independent verdicts', () => {
    const saga = code(SAGA);
    const gates = /const DEFAULT_GATES = \[([^\]]+)\]/.exec(saga)?.[1] ?? '';
    for (const gate of ['card.issuer', 'fds', 'hrp', 'funds']) {
      expect(gates, `${gate} must remain its own gate`).toContain(gate);
    }
  });

  it('each gate arrives as its own event, not as one composite result', () => {
    const saga = code(SAGA);
    // One subscription per gate event. A single `gates.completed` carrying every verdict would be the fusion
    // this test exists to prevent, and it would read as a simplification in review.
    const gateEvents = saga.match(/'[a-z.]+\.completed'/g) ?? [];
    expect(new Set(gateEvents).size).toBeGreaterThanOrEqual(3);
    expect(saga).not.toMatch(/gates\.completed|riskGate\.completed|combined\w*\.completed/);
  });

  it('a decline records WHICH gate declined, which a fused call could not', () => {
    const saga = code(SAGA);
    // The verdicts are keyed by gate, so the decision can name its cause.
    expect(saga).toContain('st.verdicts.set(gate');
    expect(saga).toMatch(/verdicts\.entries\(\)/);
  });

  it('the funds gate publishes its own verdict even now that it calls the bank', () => {
    const reactors = code(REACTORS);
    // P4.5 moved the hold to the bank. The gate still answers for itself: approved, or declined with the
    // issuer's own response code, in its own event.
    expect(reactors).toContain('holdFundsAtBank(');
    expect(reactors).toMatch(/publish\(\{\s*outcome: 'approved'/);
    expect(reactors).toMatch(/publish\(\{[\s\S]{0,200}outcome: 'declined'/);
  });

  it('no single call fetches several gate verdicts at once', () => {
    const reactors = code(REACTORS);
    // A `Promise.all` over several dispatchProvider calls would be exactly the composite: concurrency is
    // fine, but each gate must still be its own dispatch with its own audit entry, which is what publishing
    // per gate gives us.
    const composite = /Promise\.all\(\s*\[[^\]]*dispatchProvider[^\]]*dispatchProvider/s.test(reactors);
    expect(composite, 'gates must not be dispatched as one batched call').toBe(false);
  });
});

describe('v37 N4: the resolver change did not merge the dispatch of different capabilities', () => {
  it('the funds gate still dispatches account_information for its own audit read', () => {
    const reactors = code(REACTORS);
    // The provider-indifferent read exists for observability and external substitution. Folding it into the
    // card authorisation call would lose the record that a funds check happened at all.
    expect(reactors).toContain("'account_information'");
    expect(reactors).toContain("'funds.check.requested'");
  });

  it('the issuer capability is resolved per card, not per journey', () => {
    const resolver = source('psp/backend/src/modules/provider/services/resolverStrategy.ts');
    // Resolution is by the card's issuer. A journey-level resolution would pick one provider for every gate,
    // which is the same fusion by another route.
    expect(resolver).toContain('resolveByCardIssuer');
    expect(resolver).toContain('card_issuer');
  });
});
