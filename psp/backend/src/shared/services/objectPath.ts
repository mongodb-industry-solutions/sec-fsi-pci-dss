// Dotted-path access on plain documents. Paths can come from configuration (provider field-mapping
// rules), so prototype-walking and empty segments fail closed: a read returns undefined, a write is
// a no-op. Such a rule is also rejected up front by validateMappingRules.

const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export function isSafeObjectPath(path: string): boolean {
  const parts = path.split('.');
  return parts.length > 0 && parts.every((p) => p !== '' && !UNSAFE_SEGMENTS.has(p));
}

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  if (!isSafeObjectPath(path)) return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  if (!isSafeObjectPath(path)) return;
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] == null || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}
