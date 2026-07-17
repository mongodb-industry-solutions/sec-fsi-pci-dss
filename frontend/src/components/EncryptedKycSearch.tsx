'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search, ShieldCheck, Lock, RefreshCw } from 'lucide-react';
import {
  api,
  KycSearchFieldDef,
  KycSearchMode,
  KycSearchResult,
} from '../lib/api';
import { Pagination } from './Pagination';
import { LoadingIndicator } from './LoadingIndicator';
import { useDebugMode } from '../lib/debugMode';

// v27 Phase 5: ONE shared encrypted-KYC search surface, mounted in both the production
// investigation view and the demo simulator. It fetches the field registry from the API
// and renders one optimal control per query mode. Client validation is UX sugar only; the
// server validates every field, mode, length and bound, encrypts the value locally and
// matches over ciphertext (it never sees plaintext).

interface Props {
  /** Real JWT for the acting role (application mode: from login; simulator: per-role sim token). */
  token: string;
  /** Acting role: level1_analyst | level2_investigator | security_auditor. Drives result columns. */
  role: string;
  /** Per-case L2 capability token. When present, L2 may receive sensitive QE:none result fields. */
  escalationToken?: string;
  /** Optional row link builder. When provided, each result row links to this href (e.g. the
   *  customer detail). When omitted (e.g. simulator narrative), rows are static. */
  resultHref?: (row: KycSearchResult) => string;
}

// This discovery search returns LISTS of customers, so it is an investigator/auditor capability
// (least-privilege, PCI DSS Req 7). Level 1 analysts use the blind single-record lookup only.
// The server enforces this too (403); the client gate is UX. Keep in sync with the backend
// KYC_SEARCH_ROLES set.
const KYC_SEARCH_ROLES = new Set(['level2_investigator', 'security_auditor']);
const RESULTS_PAGE_SIZE = 10;

const MODE_BADGE: Record<KycSearchMode, string> = {
  substring: 'contains',
  prefix:    'starts with',
  suffix:    'ends with',
  range:     'range',
  equality:  'exact',
};

const MODE_BADGE_COLOR: Record<KycSearchMode, string> = {
  substring: 'bg-blue-50 text-blue-700 border-blue-200',
  prefix:    'bg-indigo-50 text-indigo-700 border-indigo-200',
  suffix:    'bg-violet-50 text-violet-700 border-violet-200',
  range:     'bg-amber-50 text-amber-700 border-amber-200',
  equality:  'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const DEBOUNCE_MS = 450;

function enumOptionLabel(field: KycSearchFieldDef, v: string | boolean): string {
  if (field.bsonType === 'bool') return v === true || v === 'true' ? 'Yes' : 'No';
  return String(v);
}

function enumOptionValue(v: string | boolean): string {
  return typeof v === 'boolean' ? String(v) : v;
}

// Render a decrypted sensitive/plaintext value that the role is permitted to see. Objects
// (e.g. residential address, government ID reference) are formatted; scalars shown as-is.
// This only ever runs on values the SERVER chose to return; it never renders raw ciphertext.
function renderValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const parts = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val != null && val !== '')
      .map(([, val]) => (typeof val === 'object' ? JSON.stringify(val) : String(val)));
    return parts.join(', ');
  }
  return String(v);
}

function Restricted() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-400 italic">
      <Lock size={11} /> restricted (encrypted)
    </span>
  );
}

export function EncryptedKycSearch({ token, role, escalationToken, resultHref }: Props) {
  const [fields, setFields] = useState<KycSearchFieldDef[]>([]);
  const [textSearchEnabled, setTextSearchEnabled] = useState(true);
  const [registryError, setRegistryError] = useState<string | null>(null);

  const [selectedKey, setSelectedKey] = useState<string>('');
  const [value, setValue] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [results, setResults] = useState<KycSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [page, setPage] = useState(1);

  const { debugMode } = useDebugMode();
  const authorized = KYC_SEARCH_ROLES.has(role);
  const canSeeSensitive = role === 'security_auditor' || (role === 'level2_investigator' && !!escalationToken);
  const canSeeContactPii = role === 'security_auditor' || role === 'level2_investigator';

  // Load the field registry on mount (and whenever the acting token changes).
  useEffect(() => {
    if (!token || !authorized) return;
    let cancelled = false;
    setRegistryError(null);
    api.customer.searchFields(token)
      .then((res) => {
        if (cancelled) return;
        // Defensive: tolerate a malformed/absent registry (never throw during render).
        const list = Array.isArray(res?.fields) ? res.fields : [];
        setTextSearchEnabled(res?.textSearchEnabled ?? true);
        setFields(list);
        setSelectedKey((prev) => prev || list[0]?.key || '');
      })
      .catch((e) => { if (!cancelled) setRegistryError((e as Error).message || 'Failed to load search fields'); });
    return () => { cancelled = true; };
  }, [token, authorized]);

  const field = useMemo(() => fields.find((f) => f.key === selectedKey), [fields, selectedKey]);

  // Reset the inputs when the field changes.
  useEffect(() => { setValue(''); setFrom(''); setTo(''); setResults(null); setHasSearched(false); setSearchError(null); }, [selectedKey]);

  // Inline (UX-only) validation for text modes: block queries shorter than minQueryLength.
  const textTooShort = useMemo(() => {
    if (!field) return false;
    if (!['substring', 'prefix', 'suffix'].includes(field.mode)) return false;
    const min = field.minQueryLength ?? 1;
    return value.trim().length > 0 && value.trim().length < min;
  }, [field, value]);

  // Build the request body for the active field/mode, or null when there is nothing to run.
  const body = useMemo(() => {
    if (!field) return null;
    if (field.mode === 'range') {
      if (!from && !to) return null;
      return { field: field.key, from: from || undefined, to: to || undefined };
    }
    const v = value.trim();
    if (!v) return null;
    if (['substring', 'prefix', 'suffix'].includes(field.mode)) {
      const min = field.minQueryLength ?? 1;
      if (v.length < min) return null;
    }
    return { field: field.key, value: v };
  }, [field, value, from, to]);

  const bodyKey = body ? JSON.stringify(body) : '';

  // Run the current query against the server. Shared by the debounced auto-search and the
  // manual "Reload" button (which re-fetches even when the query is unchanged, e.g. to pick up
  // provider verdicts written after the last search). Client validation gates the request; the
  // server re-validates.
  const runSearch = useCallback(async () => {
    if (!token || !body) return;
    setLoading(true);
    setSearchError(null);
    try {
      const res = await api.customer.search({ ...body, limit: 100 }, token, escalationToken);
      setResults(res.results);
      setPage(1);
      setHasSearched(true);
    } catch (e) {
      setResults([]);
      setHasSearched(true);
      setSearchError((e as Error).message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [token, bodyKey, escalationToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced auto-search whenever the query changes.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!token || !body) { return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void runSearch(); }, DEBOUNCE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [runSearch, token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!authorized) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
        <Lock size={15} className="mt-0.5 shrink-0" />
        <span>
          Encrypted attribute search is a Level 2 investigator / auditor capability. Level 1 analysts
          look a customer up by a concrete value (email, phone or account reference) provided by a case
          or the customer, and cannot browse the customer base by attribute (least-privilege, PCI DSS Req 7).
        </span>
      </div>
    );
  }
  if (registryError) {
    return <div className="text-sm text-red-600">Could not load searchable fields: {registryError}</div>;
  }
  if (!fields.length) {
    return <LoadingIndicator inline label="Loading searchable fields…" />;
  }

  const totalResults = results?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalResults / RESULTS_PAGE_SIZE));
  const pageRows = results ? results.slice((page - 1) * RESULTS_PAGE_SIZE, page * RESULTS_PAGE_SIZE) : [];

  const dateBound = (b?: number | string) => (typeof b === 'string' ? b.slice(0, 10) : undefined);

  return (
    <div className="space-y-4">
      {/* Encryption contract banner (debug mode only: explains the QE mechanics for the demo). */}
      {debugMode && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <ShieldCheck size={15} className="mt-0.5 shrink-0" />
          <span>
            This search runs over <strong>encrypted</strong> data. Your query value is encrypted before it
            leaves the server and matched ciphertext-to-ciphertext in MongoDB Atlas, which never sees the
            plaintext.{' '}
            {!textSearchEnabled && (
              <em>Text modes (contains / starts-with / ends-with) fall back to exact match on this cluster (pre-8.2).</em>
            )}
          </span>
        </div>
      )}

      {/* Field selector + mode-specific control */}
      <div className="rounded-xl border bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Search field</label>
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm bg-white"
            >
              {fields.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </div>

          {field && (
            <span
              className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium ${MODE_BADGE_COLOR[field.mode]}`}
              title={`Query mode: ${MODE_BADGE[field.mode]}`}
            >
              <Lock size={11} /> {MODE_BADGE[field.mode]} · over encrypted data
            </span>
          )}

          {/* Manual reload: re-run the current query against the server (e.g. to refresh after
              provider verdicts change). Disabled when there is no active query or one is running. */}
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={!body || loading}
            title="Reload results from the server"
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[#001E2B] px-3 py-2 text-sm font-medium text-[#001E2B] transition-colors hover:bg-[#001E2B] hover:text-[#00ED64] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Reload
          </button>
        </div>

        {/* Control */}
        {field && field.mode === 'range' ? (
          <div className="flex flex-wrap items-end gap-3">
            {field.bsonType === 'date' ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                  <input
                    type="date"
                    value={from}
                    min={dateBound(field.rangeMin)}
                    max={dateBound(field.rangeMax)}
                    onChange={(e) => setFrom(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                  <input
                    type="date"
                    value={to}
                    min={dateBound(field.rangeMin)}
                    max={dateBound(field.rangeMax)}
                    onChange={(e) => setTo(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Min</label>
                  <input
                    type="number"
                    value={from}
                    min={typeof field.rangeMin === 'number' ? field.rangeMin : undefined}
                    max={typeof field.rangeMax === 'number' ? field.rangeMax : undefined}
                    onChange={(e) => setFrom(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm w-28"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Max</label>
                  <input
                    type="number"
                    value={to}
                    min={typeof field.rangeMin === 'number' ? field.rangeMin : undefined}
                    max={typeof field.rangeMax === 'number' ? field.rangeMax : undefined}
                    onChange={(e) => setTo(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm w-28"
                  />
                </div>
              </>
            )}
            {(field.rangeMin != null || field.rangeMax != null) && (
              <span className="text-xs text-gray-400 pb-2">
                allowed {String(field.rangeMin ?? '·')} – {String(field.rangeMax ?? '·')}
              </span>
            )}
          </div>
        ) : field && field.mode === 'equality' && field.enumValues && field.enumValues.length ? (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Value</label>
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">Select…</option>
              {field.enumValues.map((v) => (
                <option key={String(v)} value={enumOptionValue(v)}>{enumOptionLabel(field, v)}</option>
              ))}
            </select>
          </div>
        ) : field ? (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {field.mode === 'substring' ? 'Contains' : field.mode === 'prefix' ? 'Starts with' : field.mode === 'suffix' ? 'Ends with' : 'Value'}
            </label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={value}
                maxLength={field.maxQueryLength}
                onChange={(e) => setValue(e.target.value)}
                placeholder={`Search ${field.label.toLowerCase()}…`}
                className="w-full max-w-md border rounded-lg pl-9 pr-3 py-2 text-sm"
              />
            </div>
            {textTooShort && (
              <p className="mt-1 text-xs text-amber-600">
                Enter at least {field.minQueryLength} characters to search.
              </p>
            )}
          </div>
        ) : null}
      </div>

      {/* Results */}
      {loading ? (
        <LoadingIndicator label="Searching over encrypted data…" />
      ) : searchError ? (
        <div className="text-sm text-red-600">{searchError}</div>
      ) : results == null && !hasSearched ? (
        <div className="rounded-lg border border-dashed bg-gray-50 py-8 text-center text-sm text-gray-400">
          Choose a field and enter a value to search encrypted KYC records.
        </div>
      ) : results && results.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-gray-50 py-8 text-center text-sm text-gray-500">
          No matches. Encrypted search ran successfully but returned no records.
        </div>
      ) : results ? (
        <div className="space-y-3">
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Agreement</th>
                <th className="px-3 py-2 font-medium">Segment</th>
                <th className="px-3 py-2 font-medium">Status</th>
                {canSeeContactPii && <th className="px-3 py-2 font-medium">Email</th>}
                {canSeeContactPii && <th className="px-3 py-2 font-medium">Phone</th>}
                <th className="px-3 py-2 font-medium">Address</th>
                <th className="px-3 py-2 font-medium">Gov. ID</th>
                <th className="px-3 py-2 font-medium">Risk notes</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pageRows.map((r) => (
                <tr key={r.customerAgreementInstanceReference} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {resultHref && r.customerAgreementInstanceReference ? (
                      <Link href={resultHref(r)} className="text-[#00684A] hover:underline">
                        {r.customerName || <Restricted />}
                      </Link>
                    ) : (
                      r.customerName || <Restricted />
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.customerAgreementReference}</td>
                  <td className="px-3 py-2 text-gray-700">{r.customerSegment ?? '—'}</td>
                  <td className="px-3 py-2 capitalize text-gray-700">{(r.customerAgreementStatus ?? '—').replace(/_/g, ' ')}</td>
                  {canSeeContactPii && (
                    <td className="px-3 py-2 text-gray-700">{r.customerEmailAddress ?? <Restricted />}</td>
                  )}
                  {canSeeContactPii && (
                    <td className="px-3 py-2 text-gray-700">{r.customerMobilePhoneNumber ?? <Restricted />}</td>
                  )}
                  <td className="px-3 py-2 text-gray-700">
                    {r.sensitive?.customerAgreementResidentialAddress != null
                      ? renderValue(r.sensitive.customerAgreementResidentialAddress)
                      : <Restricted />}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {r.sensitive?.governmentIdentificationReference != null
                      ? renderValue(r.sensitive.governmentIdentificationReference)
                      : <Restricted />}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {r.sensitive?.customerAgreementRiskNotes != null
                      ? renderValue(r.sensitive.customerAgreementRiskNotes)
                      : <Restricted />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!canSeeSensitive && (
            <p className="border-t bg-gray-50 px-3 py-2 text-xs text-gray-500">
              Sensitive fields (address, government ID, risk notes) are shown as <em>restricted (encrypted)</em>.
              {role === 'level2_investigator'
                ? ' Approve a case escalation to unlock them for Level 2.'
                : ' They require a Level 2 escalation or the security auditor role.'}
            </p>
          )}
        </div>
        {totalResults > RESULTS_PAGE_SIZE && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={totalResults}
            limit={RESULTS_PAGE_SIZE}
            onPageChange={setPage}
            noun="customers"
          />
        )}
        </div>
      ) : null}
    </div>
  );
}
