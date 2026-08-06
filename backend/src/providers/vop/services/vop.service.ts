// Internal VoP (Verification of Payee) engine: the built-in name-vs-account matcher used when no
// external VoP vendor is active (internal-first, ADR-010/029). ADDITIONAL to FDS/AML/HRP, not a
// replacement: it answers "does the declared payee name match the destination account holder name?"
// (match / close_match / no_match / not_supported). DATA-DRIVEN and market-gated: thresholds,
// matching strategy, decision policy and enabled markets live in the Module config so an operator
// edits them from the admin UI without code. Pure function; swappable for the real EPC VoP inter-PSP
// API / UK CoP / an AI-agent name-matcher without changing the wire contract (ADR-v28-01).
import { config as appConfig } from '../../../config';

export type VopMatchResult = 'match' | 'close_match' | 'no_match' | 'not_supported';
export type VopDecision = 'block' | 'warn' | 'pass';

export interface VopModuleConfig {
  thresholds?: { match?: number; closeMatch?: number };   // score cut-offs (0–100)
  strategy?: {
    exact?: boolean;
    normalized?: boolean;            // case + diacritics insensitive
    tokenOrderInsensitive?: boolean; // "John Smith" == "Smith John"
    fuzzy?: boolean;                 // Levenshtein
    maxEditDistance?: number;
    aliasMatch?: boolean;            // allow trade-name/alias to satisfy the match
  };
  policy?: {
    closeMatch?: VopDecision;        // what a close_match implies
    noMatch?: VopDecision;           // what a no_match implies
    mandatoryAboveAmount?: number;   // VoP mandatory (blocking) at/above this amount
  };
  markets?: string[];                // ISO 3166-1 alpha-2 country codes where VoP is supported
}

export interface VopInput {
  declaredName?: string;             // the name the requester/payer declared
  accountHolderName?: string;        // the destination account holder legal name (VoP source of truth)
  aliasName?: string;                // optional trade-name / alias to also try
  countryCode?: string;              // destination market (gates support)
  amount?: number;
}

export interface VopResult {
  matchResult: VopMatchResult;
  matchScore: number;                // 0–100
  verifiedName?: string;
  decision: VopDecision;             // block | warn | pass (derived from policy + result)
  recommendation: string;            // human-readable
}

// Mirrored default config, shown when none is stored yet (same pattern as FDS_DEFAULTS).
export const VOP_DEFAULTS: Required<Pick<VopModuleConfig, 'thresholds' | 'strategy' | 'policy'>> = {
  thresholds: { match: 95, closeMatch: 80 },
  strategy: { exact: true, normalized: true, tokenOrderInsensitive: true, fuzzy: true, maxEditDistance: 2, aliasMatch: false },
  policy: { closeMatch: 'warn', noMatch: 'warn', mandatoryAboveAmount: 0 },
};

export function resolveVopConfig(cfg?: VopModuleConfig): Required<VopModuleConfig> {
  return {
    thresholds: { ...VOP_DEFAULTS.thresholds, ...(cfg?.thresholds ?? {}) },
    strategy: { ...VOP_DEFAULTS.strategy, ...(cfg?.strategy ?? {}) },
    policy: { ...VOP_DEFAULTS.policy, ...(cfg?.policy ?? {}) },
    markets: cfg?.markets ?? appConfig.rtp.vopMarkets,
  };
}

function normalize(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

// Best score (0–100) across the enabled matching strategies.
function scoreNames(declared: string, holder: string, strat: Required<VopModuleConfig>['strategy']): number {
  if (!declared || !holder) return 0;
  let best = 0;
  if (strat.exact && declared === holder) best = Math.max(best, 100);
  const nd = normalize(declared), nh = normalize(holder);
  if (strat.normalized && nd === nh) best = Math.max(best, 99);
  if (strat.tokenOrderInsensitive) {
    const td = nd.split(' ').sort().join(' ');
    const th = nh.split(' ').sort().join(' ');
    if (td === th) best = Math.max(best, 97);
  }
  if (strat.fuzzy) {
    const dist = levenshtein(nd, nh);
    const maxLen = Math.max(nd.length, nh.length) || 1;
    const sim = Math.round((1 - dist / maxLen) * 100);
    if (dist <= (strat.maxEditDistance ?? 2)) best = Math.max(best, Math.max(sim, 90));
    else best = Math.max(best, sim);
  }
  return best;
}

export function verifyPayee(input: VopInput, cfg?: VopModuleConfig): VopResult {
  const c = resolveVopConfig(cfg);

  // Market gating: outside supported markets VoP is not_supported (non-blocking advisory).
  const country = (input.countryCode ?? '').toUpperCase();
  const marketSupported = !country || c.markets.map((m) => m.toUpperCase()).includes(country);
  if (!appConfig.rtp.vop || !marketSupported) {
    return { matchResult: 'not_supported', matchScore: 0, decision: 'pass', recommendation: 'VoP not supported in this market (advisory only).' };
  }

  const holder = input.accountHolderName ?? '';
  let score = scoreNames(input.declaredName ?? '', holder, c.strategy);
  if (c.strategy.aliasMatch && input.aliasName) {
    score = Math.max(score, scoreNames(input.aliasName, holder, c.strategy));
  }

  let matchResult: VopMatchResult;
  if (score >= (c.thresholds.match ?? 95)) matchResult = 'match';
  else if (score >= (c.thresholds.closeMatch ?? 80)) matchResult = 'close_match';
  else matchResult = 'no_match';

  // Decision from policy; VoP is mandatory (blocking on non-match) at/above mandatoryAboveAmount.
  let decision: VopDecision = 'pass';
  if (matchResult === 'close_match') decision = c.policy.closeMatch ?? 'warn';
  else if (matchResult === 'no_match') decision = c.policy.noMatch ?? 'warn';
  const mandatory = (c.policy.mandatoryAboveAmount ?? 0) > 0 && (input.amount ?? 0) >= (c.policy.mandatoryAboveAmount ?? 0);
  if (mandatory && matchResult !== 'match') decision = 'block';

  const recommendation =
    matchResult === 'match' ? 'Payee name matches the account holder.'
      : matchResult === 'close_match' ? 'Payee name is a close match; possible impersonation, review before paying.'
        : 'Payee name does not match the account holder; high impersonation risk.';

  return { matchResult, matchScore: score, verifiedName: holder || undefined, decision, recommendation };
}
