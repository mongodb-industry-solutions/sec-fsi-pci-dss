/**
 * Unit tests: v32 C7 the beneficiary lookup value is unrecoverable by design (test 28)
 * Source: backend/src/modules/identity/models/counterpartyArrangement.model.ts
 *         backend/src/modules/identity/services/counterpartyArrangement.service.ts
 *
 * The plan required this to be a STATED decision rather than an omission: the raw phone/email of a
 * counterparty is masked before it is written and the plaintext is never persisted, so no role can
 * recover it, including security_auditor. That is minimisation at the source (GDPR Art. 5(1)(c),
 * Art. 25(2)), stronger than masking in a projection because there is no plaintext to leak.
 * These tests fail if someone later adds a reveal path or stores the raw value.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { maskLookupValue } from '../../../../../psp/backend/src/modules/identity/models/counterpartyArrangement.model';

describe('maskLookupValue', () => {
  it('masks an email to a single leading character plus the domain', () => {
    expect(maskLookupValue('email', 'john@example.com')).toBe('j***@example.com');
  });

  it('masks a phone to its country/area prefix plus the last three digits', () => {
    const masked = maskLookupValue('phone', '+34612345678');
    expect(masked).toContain('***');
    expect(masked).toContain('678');
    expect(masked).not.toContain('612345');
  });

  it('never returns the full input', () => {
    for (const [type, raw] of [['email', 'alice@bank.example'], ['phone', '+441234567890']] as const) {
      expect(maskLookupValue(type, raw)).not.toBe(raw);
    }
  });

  it('degrades safely on malformed input instead of echoing it', () => {
    expect(maskLookupValue('email', 'not-an-email')).toBe('***');
  });
});

describe('no reveal path exists for the counterparty lookup value', () => {
  const SRC = join(process.cwd(), 'psp', 'backend', 'src');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  it('declares no route that reveals a beneficiary identifier', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, 'utf-8');
      // A reveal route for a counterparty/beneficiary identifier would match one of these.
      if (/counterparty[A-Za-z]*\/reveal|beneficiar(y|ies)[^\n]*\/reveal|reveal[A-Za-z]*(Counterparty|Beneficiary)/i.test(src)) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('writes the masked hint, never a raw lookup field, on the arrangement record', () => {
    const service = readFileSync(
      join(SRC, 'modules', 'identity', 'services', 'counterpartyArrangement.service.ts'), 'utf-8',
    );
    // Every persisted hint comes from the masker.
    const hintWrites = service.match(/counterpartyLookupHint:\s*([A-Za-z0-9_.]+)/g) ?? [];
    expect(hintWrites.length).toBeGreaterThan(0);
    for (const w of hintWrites) {
      expect(w).toMatch(/counterpartyLookupHint:\s*(maskedHint|opts|input)/);
    }
    // And no field stores the plaintext.
    expect(service).not.toMatch(/counterpartyLookupRaw|counterpartyLookupValue\s*:/);
  });
});
