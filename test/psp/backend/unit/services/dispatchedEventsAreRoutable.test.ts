/**
 * Every event the code dispatches must have somewhere to go.
 *
 * This exists because removing one field broke three integrations at once and nothing noticed. The
 * arrangements used to carry a single fallback url (`externalProviderApiEndpoint`), which for the bank
 * capabilities held a LOOPBACK path back into the provider itself. Three of the event names the code
 * dispatches did not match the names declared on the arrangements, so the resolver never found a per-event
 * config and quietly used that fallback. Deleting the loopback, correctly, left those three with no url at all.
 *
 * A missing url is not a crash. The dispatch records a failure, the caller treats it as "provider unreachable",
 * and a payment flow keeps working in the degraded shape nobody asked for. So the check is mechanical: read the
 * event names out of the SOURCE, read the declared events out of the SEED, and require every dispatched name
 * for an externally-served capability to be declared with a url.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import arrangements from '../../../../../psp/backend/data/externalProviderArrangement.json';

interface Arrangement {
  externalProviderArrangementType: string;
  externalProviderIsInternal?: boolean;
  externalProviderApiEndpoint?: string;
  externalProviderBaseUrl?: string;
  externalProviderEvents?: { event: string; outbound?: { url?: string } }[];
}

const SOURCE_ROOT = join(__dirname, '../../../../../psp/backend/src');

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (entry.endsWith('.ts')) found.push(path);
  }
  return found;
}

/** Every `dispatchProvider(db, '<capability>', '<event>'` in the codebase, as a pair. */
function dispatchedPairs(): { capability: string; event: string; file: string }[] {
  const pattern = /dispatchProvider\(\s*[A-Za-z.]+\s*,\s*'([a-z_]+)'\s*,\s*'([^']+)'/g;
  const pairs: { capability: string; event: string; file: string }[] = [];
  for (const file of sourceFiles(SOURCE_ROOT)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(pattern)) {
      pairs.push({ capability: match[1], event: match[2], file: file.replace(SOURCE_ROOT, 'src') });
    }
  }
  return pairs;
}

const records = arrangements as unknown as Arrangement[];

/** Served by another institution over the wire, so it needs a declared per-event path. */
function externallyServed(capability: string): Arrangement | undefined {
  return records.find((record) => record.externalProviderArrangementType === capability
    && record.externalProviderIsInternal === false);
}

describe('every dispatched event is routable', () => {
  it('finds the dispatches at all, so a silent zero cannot pass this test', () => {
    // A regex that matches nothing would make every assertion below vacuously true.
    const pairs = dispatchedPairs();
    expect(pairs.length, 'no dispatchProvider call was found: the pattern is wrong, not the code').toBeGreaterThan(3);
  });

  it.each(dispatchedPairs())('$capability / $event has a declared endpoint', ({ capability, event, file }) => {
    const provider = externallyServed(capability);
    // An internally-served capability still answers on its own loopback path, which is legitimate: the engine
    // is the provider's own. Only the ones served by an institution are checked here.
    if (!provider) return;

    const declared = provider.externalProviderEvents?.find((entry) => entry.event === event);
    expect(
      declared,
      `${file} dispatches '${event}' to ${capability}, which is served by an institution, but the seed `
      + `declares no such event. Declared: ${(provider.externalProviderEvents ?? []).map((e) => e.event).join(', ')}`,
    ).toBeDefined();
    expect(
      declared?.outbound?.url,
      `'${event}' is declared for ${capability} but carries no url, so the dispatch has nowhere to go`,
    ).toBeTruthy();
  });

  it('no externally served capability relies on a loopback path back into the provider', () => {
    // The shape that hid the mismatch. A url pointing at the provider's own API means the provider is
    // answering a question it is supposed to be asking.
    for (const record of records) {
      if (record.externalProviderIsInternal !== false) continue;
      const urls = [
        record.externalProviderApiEndpoint,
        ...(record.externalProviderEvents ?? []).map((entry) => entry.outbound?.url),
      ].filter(Boolean) as string[];
      for (const url of urls) {
        expect(
          url.startsWith('/api/v1/modules/'),
          `${record.externalProviderArrangementType} points at ${url}, which is the provider's own API`,
        ).toBe(false);
      }
    }
  });
});
