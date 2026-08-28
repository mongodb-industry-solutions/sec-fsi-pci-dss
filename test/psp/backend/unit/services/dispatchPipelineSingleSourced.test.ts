// v37 P6.1: the resolvers are pluggable, the dispatch PIPELINE is not.
//
// The plan's reasoning: five capability-specific controllers would fork the audit trail that carries the
// compliance narrative. So the resolver is injected behind the one dispatch path, and everything after it,
// the logging, the events, the field mapping, stays single sourced. This gate is about that shape, because it
// is the kind of thing that erodes one convenient copy at a time.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../../../..');
const DISPATCH = 'psp/backend/src/modules/provider/services/integrationDispatch.service.ts';

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function code(path: string): string {
  // Line comments FIRST. A line comment containing `/*` (a URL like `/api/v1/internal/*`, for instance)
  // otherwise opens a fake block comment that swallows real code up to the next `*/`. In a `not.toContain`
  // assertion that makes the gate pass because the code disappeared, which is the worst kind of green.
  return source(path)
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('v37 P6.1: one dispatch path, with the resolver injected into it', () => {
  it('has exactly one dispatch PIPELINE, however many doors lead to it', () => {
    const body = code(DISPATCH);
    const exported = (body.match(/export async function (dispatch\w*)/g) ?? [])
      .map((match) => match.replace('export async function ', ''));

    // There is more than one exported entry point on purpose (v37 P13): an entity-bound capability and a
    // strategy-bound one impose different contracts on the caller, and expressing that as two typed doors is
    // what makes the required routing key impossible to omit. Counting the names was a proxy for the property
    // that actually matters, which is that only ONE of them contains the pipeline.
    //
    // The pipeline is identified by what only it does: consult the resolver, fall back to the strategy
    // registry, and hand off to the external dispatcher. A door that did any of those would be a second
    // pipeline, whatever it was called.
    const HALLMARKS = ['resolveProvider(', 'getActiveProviderForType(', 'dispatchExternal('];
    const bodies = new Map<string, string>();
    for (const name of exported) {
      const start = body.indexOf(`export async function ${name}`);
      const next = exported
        .map((other) => body.indexOf(`export async function ${other}`))
        .filter((index) => index > start)
        .sort((a, b) => a - b)[0] ?? body.length;
      bodies.set(name, body.slice(start, next));
    }

    const pipelines = [...bodies.entries()]
      .filter(([, text]) => HALLMARKS.every((hallmark) => text.includes(hallmark)))
      .map(([name]) => name);
    expect(pipelines, 'exactly one exported function may contain the dispatch pipeline').toEqual(['dispatchProvider']);

    // And every other door must be a thin delegation to it, not a copy that drifts.
    for (const [name, text] of bodies) {
      if (name === 'dispatchProvider') continue;
      expect(text, `${name} must delegate to the single pipeline`).toContain('dispatchProvider(');
      for (const hallmark of HALLMARKS.filter((h) => h !== 'dispatchExternal(')) {
        expect(text, `${name} must not resolve providers itself`).not.toContain(hallmark);
      }
    }
  });

  it('resolves entity-bound capabilities before any strategy is considered', () => {
    const body = code(DISPATCH);
    const resolverCall = body.indexOf('resolveProvider(db, type, resolution)');
    const strategyCall = body.indexOf('getActiveProviderForType(db, type)');
    expect(resolverCall).toBeGreaterThan(-1);
    expect(strategyCall).toBeGreaterThan(-1);
    // If the strategy ran first, an entity-bound capability could be answered by the wrong institution
    // before anyone asked which one holds the account.
    expect(resolverCall).toBeLessThan(strategyCall);
  });

  it('shares the same logging and event path for a resolved provider', () => {
    const body = code(DISPATCH);
    // The resolved branch ends in the SAME two helpers every other branch uses. A capability-specific
    // dispatcher that logged its own way is what would split the compliance narrative in two. Asserted by
    // naming both calls rather than by counting occurrences, which a refactor changes for no real reason.
    expect(body).toContain('dispatchExternal(db, resolved.provider');
    expect(body).toContain('logAndReturn(db, resolved.provider');
    // And the strategy branch still uses them too, so neither path is a special case.
    expect(body).toContain('dispatchExternal(db, provider');
  });

  it('REFUSES an unroutable entity-bound capability rather than falling through', () => {
    const body = code(DISPATCH);
    const guard = body.indexOf("could not be routed");
    expect(guard).toBeGreaterThan(-1);
    // The refusal must return, not fall into the strategy path below it: for an entity-bound capability a
    // fallback is the wrong bank, not a degraded answer.
    const afterGuard = body.slice(guard, guard + 400);
    expect(afterGuard).toContain('return');
  });

  it('no other module resolves a provider for itself', () => {
    // The resolver is reachable from the dispatch service and from its own tests. A business service calling
    // it directly would be choosing an institution outside the audited path.
    const callers = [
      'psp/backend/src/modules/gateway/services/p2pTransfer.service.ts',
      'psp/backend/src/modules/gateway/services/bankTransfer.service.ts',
      'psp/backend/src/providers/groups/providerGroups.ts',
    ];
    for (const path of callers) {
      expect(code(path), `${path} must not resolve providers itself`).not.toContain('resolverStrategy');
    }
  });
});

describe('v37 P6.3: the routing key per capability is declared, not inferred at each call site', () => {
  it('the entity-bound set is one table, in one place', () => {
    const resolver = source('psp/backend/src/modules/provider/services/resolverStrategy.ts');
    // One table means adding a capability is one edit, and a reader can see the whole rule at once.
    expect(resolver).toContain('const ENTITY_BOUND');
    for (const type of ['aspsp', 'account_information', 'payment_initiation', 'card_issuer', 'card_authorization']) {
      expect(resolver, `${type} must be in the table`).toContain(type);
    }
  });

  it('states why the creditor is never the key, where the resolver is written', () => {
    const resolver = source('psp/backend/src/modules/provider/services/resolverStrategy.ts');
    // This is the expensive mistake, so the reasoning lives next to the code that avoids it.
    expect(resolver).toContain('never the creditor');
    expect(resolver).toContain('not a clearing participant');
  });
});
