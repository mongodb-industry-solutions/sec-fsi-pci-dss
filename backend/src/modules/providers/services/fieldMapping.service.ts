import { FieldMapping, FieldTransform } from '../models/externalProviderArrangement.model';

// Cardholder data. Mappable ONLY for a card issuer / card authorization connector, which legitimately
// receives the PAN/CVV/expiry to authorize (e.g. rename cardNumber -> card_value). Blocked for every
// other integration type so CHD can never be remapped into a fraud/AML/marketing connector.
const CHD_FIELDS = new Set([
  'pan', 'primaryaccountnumber', 'cardnumber', 'cvv', 'cvc', 'cvv2', 'cvc2',
  'expirydate', 'cardexpirydate', 'expiry', 'cardholdername',
]);

// Secrets — never mappable, for any provider.
const SECRET_FIELDS = new Set([
  'externalproviderapikeyhash', 'externalprovidercallbacksecrethash',
]);

function blockedReason(path: string, allowCardData: boolean): string | null {
  const lower = path.toLowerCase().replace(/\./g, '');
  if (SECRET_FIELDS.has(lower)) return 'a protected secret';
  if (!allowCardData && CHD_FIELDS.has(lower)) return 'a PCI DSS-protected cardholder-data field';
  return null;
}

// `allowCardData` = true for card-issuer / card-authorization providers, so the attribute mapping can
// convert the PSP's `cardNumber`/`cvv`/`expiry` to whatever the connector expects (e.g. `card_value`).
export function validateMappingRules(rules: FieldMapping[], opts?: { allowCardData?: boolean }): string[] {
  const allow = opts?.allowCardData ?? false;
  const errors: string[] = [];
  for (const rule of rules) {
    const src = blockedReason(rule.sourcePath, allow);
    if (src) errors.push(`sourcePath "${rule.sourcePath}" is ${src} and cannot be mapped`);
    const tgt = blockedReason(rule.targetPath, allow);
    if (tgt) errors.push(`targetPath "${rule.targetPath}" is ${tgt} and cannot be mapped`);
  }
  return errors;
}

// The provider types whose connectors authorize the card and therefore may map cardholder data.
const CARD_DATA_TYPES = new Set(['card_issuer', 'card_authorization']);
export function mayMapCardData(providerType: string | undefined): boolean {
  return providerType !== undefined && CARD_DATA_TYPES.has(providerType);
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
