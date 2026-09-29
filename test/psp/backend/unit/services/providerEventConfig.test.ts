/**
 * Unit tests (dev.v8 P11a, §2.4/§7.7): the per-event config resolver. Per-event outbound/inbound
 * config overrides vendor-global; vendor-global is the migration fallback; sensible defaults apply
 * when neither is set. Pure, no DB.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveEventOutbound,
  resolveEventInbound,
  listVendorEvents,
  deriveEventConfigs,
} from '../../../../../psp/backend/src/modules/provider/services/providerEventConfig.service';
import type { ExternalProviderArrangement } from '../../../../../psp/backend/src/modules/provider/models/externalProviderArrangement.model';

const base = {
  externalProviderArrangementInstanceReference: 'v1',
  externalProviderArrangementName: 'Vendor',
  externalProviderArrangementType: 'card_issuer',
  externalProviderArrangementStatus: 'active',
  externalProviderIsInternal: false,
  externalProviderCallbackEnabled: true,
  externalProviderTriggerEvents: ['card.issuer.validation.requested'],
  externalProviderMode: 'async',
  externalProviderTimeoutMs: 3000,
  externalProviderRetryPolicy: { maxAttempts: 2, backoffMs: 100 },
  bianServiceDomain: '', bianControlRecordType: '', pciDssRequirements: [],
  recordCreatedDateTime: new Date(), recordUpdatedDateTime: new Date(), schemaVersion: 3,
} as unknown as ExternalProviderArrangement;

describe('per-event config resolver (§2.4/§7.7)', () => {
  it('prefers per-event outbound config over vendor-global', () => {
    const vendor = { ...base,
      externalProviderApiEndpoint: 'https://vendor/global',
      externalProviderEvents: [{
        event: 'card.issuer.validation.requested',
        outbound: { url: 'https://vendor/issuer-validate', httpMethod: 'PUT' as const, timeoutMs: 1500, mapping: [{ sourcePath: 'cvv', targetPath: 'cvvData' }] },
        inbound: { callbackUrl: 'https://vendor/cb/issuer', referenceLocation: 'header' as const, referenceField: 'X-Client-Reference' },
      }],
    } as ExternalProviderArrangement;

    const out = resolveEventOutbound(vendor, 'card.issuer.validation.requested');
    expect(out.perEvent).toBe(true);
    expect(out.url).toBe('https://vendor/issuer-validate');
    expect(out.httpMethod).toBe('PUT');
    expect(out.timeoutMs).toBe(1500);
    expect(out.mapping).toHaveLength(1);

    const inb = resolveEventInbound(vendor, 'card.issuer.validation.requested');
    expect(inb.perEvent).toBe(true);
    expect(inb.callbackUrl).toBe('https://vendor/cb/issuer');
    expect(inb.referenceLocation).toBe('header');
    expect(inb.referenceField).toBe('X-Client-Reference');
  });

  it('falls back to vendor-global config when no per-event entry exists', () => {
    const vendor = { ...base,
      externalProviderApiEndpoint: 'https://vendor/global',
      externalProviderCallbackPath: '/api/v1/providers/callback/card/issuer/v1',
      authConfig: { scheme: 'api_key' as const },
      fieldMappingConfig: { outbound: [{ sourcePath: 'a', targetPath: 'b' }], inbound: [], schemaVersion: 1 },
    } as ExternalProviderArrangement;

    const out = resolveEventOutbound(vendor, 'card.issuer.validation.requested');
    expect(out.perEvent).toBe(false);
    expect(out.url).toBe('https://vendor/global');
    expect(out.httpMethod).toBe('POST');           // default
    expect(out.timeoutMs).toBe(3000);              // vendor-global
    expect(out.retryPolicy).toEqual({ maxAttempts: 2, backoffMs: 100 });
    expect(out.mapping).toHaveLength(1);
    expect(out.auth?.scheme).toBe('api_key');

    const inb = resolveEventInbound(vendor, 'card.issuer.validation.requested');
    expect(inb.callbackUrl).toBe('/api/v1/providers/callback/card/issuer/v1');
    expect(inb.referenceLocation).toBe('body');    // default
    expect(inb.referenceField).toBe('clientReference');
  });

  it('applies safe defaults when neither per-event nor vendor-global is set', () => {
    const vendor = { ...base, externalProviderTimeoutMs: undefined, externalProviderRetryPolicy: undefined } as unknown as ExternalProviderArrangement;
    const out = resolveEventOutbound(vendor, 'unknown.event');
    expect(out.httpMethod).toBe('POST');
    expect(out.timeoutMs).toBe(5000);
    expect(out.retryPolicy).toEqual({ maxAttempts: 1, backoffMs: 0 });
    expect(out.mapping).toEqual([]);
  });

  it('listVendorEvents prefers per-event events, falls back to the trigger list', () => {
    expect(listVendorEvents(base)).toEqual(['card.issuer.validation.requested']);
    const withEvents = { ...base, externalProviderEvents: [
      { event: 'e1', outbound: {}, inbound: {} }, { event: 'e2', outbound: {}, inbound: {} },
    ] } as ExternalProviderArrangement;
    expect(listVendorEvents(withEvents)).toEqual(['e1', 'e2']);
  });
});

describe('deriveEventConfigs (P11d seed migration)', () => {
  it('builds one per-event config per trigger event from the vendor-global template', () => {
    const vendor = { ...base,
      externalProviderTriggerEvents: ['a.requested', 'b.requested'],
      externalProviderApiEndpoint: 'http://localhost:8081/api/v1/modules/x/score',
      externalProviderTimeoutMs: 1500,
      externalProviderRetryPolicy: { maxAttempts: 1, backoffMs: 0 },
      fieldMappingConfig: { outbound: [{ sourcePath: 'a', targetPath: 'b' }], inbound: [], schemaVersion: 1 },
    } as ExternalProviderArrangement;
    const events = deriveEventConfigs(vendor);
    expect(events.map((e) => e.event)).toEqual(['a.requested', 'b.requested']);
    expect(events[0].outbound.url).toBe('http://localhost:8081/api/v1/modules/x/score');
    expect(events[0].outbound.timeoutMs).toBe(1500);
    expect(events[0].outbound.mapping).toHaveLength(1);
    // a resolver over the derived doc returns the per-event values
    const resolved = resolveEventOutbound({ ...vendor, externalProviderEvents: events } as ExternalProviderArrangement, 'a.requested');
    expect(resolved.perEvent).toBe(true);
    expect(resolved.url).toBe('http://localhost:8081/api/v1/modules/x/score');
  });

  it('is idempotent: returns existing per-event config unchanged', () => {
    const existing = [{ event: 'x', outbound: { url: 'u' }, inbound: {} }];
    const vendor = { ...base, externalProviderEvents: existing } as ExternalProviderArrangement;
    expect(deriveEventConfigs(vendor)).toBe(existing);
  });
});
