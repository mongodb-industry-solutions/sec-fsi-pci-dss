/**
 * Unit tests: backend/src/shared/services/objectPath.ts. Paths come from configuration (provider
 * field-mapping rules), so prototype-walking segments must never reach Object.prototype.
 */
import { describe, it, expect } from 'vitest';
import { getNestedValue, setNestedValue, isSafeObjectPath } from '../../../../backend/src/shared/services/objectPath';

const UNSAFE = ['__proto__', 'constructor', 'prototype', '__proto__.polluted', 'a.constructor.x', 'a..b', ''];

describe('isSafeObjectPath', () => {
  it('accepts ordinary dotted paths', () => {
    for (const p of ['a', 'a.b', 'customerAgreementGovernmentID.number']) expect(isSafeObjectPath(p)).toBe(true);
  });

  it('rejects prototype-walking and empty segments', () => {
    for (const p of UNSAFE) expect(isSafeObjectPath(p)).toBe(false);
  });
});

describe('getNestedValue / setNestedValue', () => {
  it('reads and writes nested leaves, creating intermediate objects', () => {
    const doc: Record<string, unknown> = { a: { b: 1 } };
    expect(getNestedValue(doc, 'a.b')).toBe(1);
    setNestedValue(doc, 'a.c.d', 2);
    expect(getNestedValue(doc, 'a.c.d')).toBe(2);
  });

  it('returns undefined for a missing or non-object path', () => {
    expect(getNestedValue({ a: 1 }, 'a.b')).toBeUndefined();
    expect(getNestedValue({}, 'nope')).toBeUndefined();
  });

  it('never pollutes the prototype and never reads through it', () => {
    for (const p of UNSAFE) {
      setNestedValue({}, p, 'polluted');
      expect(getNestedValue({}, p)).toBeUndefined();
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });
});
