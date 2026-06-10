import { FieldMapping, FieldTransform } from '../models/externalProviderArrangement.model';

// PCI DSS blocklist — these field names must never be remapped or injected
const PCI_BLOCKED_FIELDS = new Set([
  'pan', 'primaryaccountnumber', 'cardnumber', 'cvv', 'cvc', 'cvv2', 'cvc2',
  'expirydate', 'cardexpirydate', 'cardholdername', 'cardholderName',
  'externalproviderApiKeyHash', 'externalproviderApiKeyHash',
  'externalProviderApiKeyHash', 'externalProviderCallbackSecretHash',
]);

function isBlockedField(path: string): boolean {
  const lower = path.toLowerCase().replace(/\./g, '');
  return PCI_BLOCKED_FIELDS.has(lower) || PCI_BLOCKED_FIELDS.has(path);
}

export function validateMappingRules(rules: FieldMapping[]): string[] {
  const errors: string[] = [];
  for (const rule of rules) {
    if (isBlockedField(rule.sourcePath))
      errors.push(`sourcePath "${rule.sourcePath}" is a PCI DSS-protected field and cannot be mapped`);
    if (isBlockedField(rule.targetPath))
      errors.push(`targetPath "${rule.targetPath}" is a PCI DSS-protected field and cannot be mapped`);
  }
  return errors;
}

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
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

function deleteNestedValue(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] == null || typeof current[part] !== 'object') return;
    current = current[part] as Record<string, unknown>;
  }
  delete current[parts[parts.length - 1]];
}

export function applyTransform(value: unknown, transform: FieldTransform): unknown {
  switch (transform.type) {
    case 'rename':
      // rename is handled at the mapping level (move key) — no value change
      return value;

    case 'value_map': {
      const map = transform.valueMap ?? {};
      const str = String(value);
      return map[str] !== undefined ? map[str] : value;
    }

    case 'scale': {
      const factor = transform.scaleFactor ?? 1;
      if (typeof value !== 'number') return value;
      return value * factor;
    }

    case 'nested_extract':
      // value is already the extracted value from sourcePath — no further transform
      return value;

    case 'nested_wrap':
      // wrapping is handled at the mapping level via targetPath — no value change
      return value;

    default:
      return value;
  }
}

export function applyMappings(
  payload: Record<string, unknown>,
  rules: FieldMapping[]
): Record<string, unknown> {
  if (!rules || rules.length === 0) return payload;

  // Deep clone to avoid mutating the original
  const result: Record<string, unknown> = JSON.parse(JSON.stringify(payload));

  for (const rule of rules) {
    const rawValue = getNestedValue(result, rule.sourcePath);

    // Use defaultValue if source field is missing
    const value = rawValue !== undefined ? rawValue : rule.defaultValue;
    if (value === undefined) continue;

    const transformed = rule.transform ? applyTransform(value, rule.transform) : value;

    // Remove the original key if source != target (rename / move)
    if (rule.sourcePath !== rule.targetPath) {
      deleteNestedValue(result, rule.sourcePath);
    }

    setNestedValue(result, rule.targetPath, transformed);
  }

  return result;
}
