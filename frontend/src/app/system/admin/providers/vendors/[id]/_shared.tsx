'use client';
import { useState } from 'react';
import { Plus, Trash2, Info } from 'lucide-react';
import type { MappingRule } from './_context';
import { JsonEditor } from '../../../../../../components/json/JsonEditor';

// ── StatusToggle ──────────────────────────────────────────────────────────────
//
// Instant on/off switch; calls onToggle immediately, does not require Save.
// Use for settings whose effect should be visible right away (active/inactive,
// callback enabled/disabled, etc.).

export interface StatusToggleProps {
  enabled: boolean;
  onToggle: () => void;
  loading?: boolean;
  enabledLabel?: string;
  disabledLabel?: string;
  enabledDescription?: string;
  disabledDescription?: string;
}

export function StatusToggle({
  enabled,
  onToggle,
  loading = false,
  enabledLabel    = 'Active',
  disabledLabel   = 'Inactive',
  enabledDescription,
  disabledDescription,
}: StatusToggleProps) {
  return (
    <div className="flex items-start gap-4">
      {/* Pill switch */}
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        disabled={loading}
        className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent
          transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
          disabled:cursor-not-allowed disabled:opacity-60
          ${enabled ? 'bg-green-500 focus-visible:ring-green-500' : 'bg-gray-300 focus-visible:ring-gray-400'}`}>
        {/* Knob */}
        <span
          className={`inline-block h-6 w-6 rounded-full bg-white shadow-md ring-0
            transition-transform duration-200
            ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
        />
        {/* Spinner overlay when loading */}
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
          </span>
        )}
      </button>

      {/* Label + description */}
      <div className="min-w-0">
        <p className={`text-sm font-semibold leading-snug ${enabled ? 'text-green-700' : 'text-gray-500'}`}>
          {enabled ? enabledLabel : disabledLabel}
        </p>
        {(enabledDescription || disabledDescription) && (
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            {enabled ? enabledDescription : disabledDescription}
          </p>
        )}
      </div>
    </div>
  );
}

// ── FieldMappingMatrix ────────────────────────────────────────────────────────
//
// Table mode: one row per field, columns are location / source / target / required
// JSON mode:  raw JSON array for nested/complex payloads, validated before apply

interface FMMProps {
  rules: MappingRule[];
  setRules?: (r: MappingRule[]) => void;
  sourceLabel: string;
  targetLabel: string;
  readOnly?: boolean;
}

export function FieldMappingMatrix({ rules, setRules, sourceLabel, targetLabel, readOnly }: FMMProps) {
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');

  function openJson() {
    setJsonText(JSON.stringify(rules, null, 2));
    setJsonError('');
    setJsonMode(true);
  }

  function applyJson() {
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) throw new Error('Root value must be a JSON array');
      for (const item of parsed) {
        if (typeof item.sourceField !== 'string') throw new Error('Each item must have a string "sourceField"');
        if (!['body', 'header'].includes(item.location)) throw new Error('"location" must be "body" or "header"');
      }
      setRules?.(parsed as MappingRule[]);
      setJsonError('');
      setJsonMode(false);
    } catch (e) { setJsonError((e as Error).message); }
  }

  const update = (idx: number, patch: Partial<MappingRule>) => {
    const c = [...rules];
    c[idx] = { ...c[idx], ...patch };
    setRules?.(c);
  };

  if (readOnly) {
    if (rules.length === 0) return (
      <p className="text-xs text-gray-400 italic py-2">No mapping rules; fields pass through unchanged.</p>
    );
    return (
      <table className="w-full text-xs border rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-gray-50 border-b text-[11px] text-gray-500 uppercase">
            <th className="text-left px-3 py-2 font-medium w-20">Where</th>
            <th className="text-left px-3 py-2 font-medium">{sourceLabel}</th>
            <th className="text-left px-3 py-2 font-medium">{targetLabel}</th>
            <th className="px-3 py-2 font-medium w-14 text-center">Req.</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="px-3 py-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${r.location === 'header' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                  {r.location}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-gray-800">{r.sourceField || <em className="text-gray-400">—</em>}</td>
              <td className="px-3 py-2 font-mono text-gray-500">{r.targetField || <em className="text-gray-400">same as source</em>}</td>
              <td className="px-3 py-2 text-center text-green-600">{r.required ? '✓' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-lg border text-xs overflow-hidden">
          <button onClick={() => setJsonMode(false)}
            className={`px-3 py-1.5 transition-colors ${!jsonMode ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            Table
          </button>
          <button onClick={openJson}
            className={`px-3 py-1.5 border-l transition-colors ${jsonMode ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            JSON
          </button>
        </div>
        {!jsonMode && (
          <button
            onClick={() => setRules?.([...rules, { location: 'body', sourceField: '', targetField: '', required: false }])}
            className="flex items-center gap-1 text-xs font-medium text-[#001E2B] hover:underline">
            <Plus size={11} />Add row
          </button>
        )}
      </div>

      {jsonMode ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Each object: <code className="bg-gray-100 px-1 rounded">location</code> ("body" or "header"),{' '}
            <code className="bg-gray-100 px-1 rounded">sourceField</code>,{' '}
            <code className="bg-gray-100 px-1 rounded">targetField</code> (blank = same as source),{' '}
            <code className="bg-gray-100 px-1 rounded">required</code> (boolean).
            Use dot notation for nested fields: <code className="bg-gray-100 px-1 rounded">payload.transaction.amount</code>.
          </p>
          <JsonEditor
            value={jsonText}
            onChange={setJsonText}
            error={jsonError || null}
            minHeight={`${Math.max(10, rules.length * 4 + 2) * 1.25}rem`}
            maxHeight="32rem" />
          <div className="flex gap-2">
            <button onClick={applyJson}
              className="text-xs px-3 py-1.5 rounded border border-gray-400 hover:border-gray-700 text-gray-800 font-medium">
              Validate &amp; apply
            </button>
            <button onClick={() => setJsonMode(false)} className="text-xs px-3 py-1.5 rounded border text-gray-500 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <table className="w-full text-xs border rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-gray-50 border-b text-[11px] text-gray-500 uppercase">
              <th className="text-left px-3 py-2 font-medium w-24">Where</th>
              <th className="text-left px-3 py-2 font-medium">{sourceLabel}</th>
              <th className="text-left px-3 py-2 font-medium">
                {targetLabel} <span className="normal-case font-normal text-gray-400">(blank = same)</span>
              </th>
              <th className="px-3 py-2 font-medium w-14 text-center">Req.</th>
              <th className="px-3 py-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-gray-400 italic">
                  No rules yet; add rows to define the expected fields.
                </td>
              </tr>
            )}
            {rules.map((r, idx) => (
              <tr key={idx} className="border-b last:border-0">
                <td className="px-3 py-1.5">
                  <select value={r.location} onChange={e => update(idx, { location: e.target.value as 'body' | 'header' })}
                    className="border border-gray-200 rounded px-1.5 py-1 text-xs w-full">
                    <option value="body">body</option>
                    <option value="header">header</option>
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <input value={r.sourceField} onChange={e => update(idx, { sourceField: e.target.value })}
                    placeholder="field.name"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-gray-400" />
                </td>
                <td className="px-3 py-1.5">
                  <input value={r.targetField} onChange={e => update(idx, { targetField: e.target.value })}
                    placeholder="same as source"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs font-mono text-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400" />
                </td>
                <td className="px-3 py-1.5 text-center">
                  <input type="checkbox" checked={r.required} onChange={e => update(idx, { required: e.target.checked })}
                    className="rounded border-gray-300" />
                </td>
                <td className="px-3 py-1.5">
                  <button onClick={() => setRules?.(rules.filter((_, i) => i !== idx))}
                    className="text-red-400 hover:text-red-600 transition-colors">
                    <Trash2 size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── SaveBtn ───────────────────────────────────────────────────────────────────

export function SaveBtn({
  saving, saved, label = 'Save changes', onClick,
}: { saving: boolean; saved: boolean; label?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={saving}
      className={`text-sm px-4 py-2 rounded-lg font-medium transition-all disabled:opacity-50 ${
        saved ? 'bg-green-600 text-white' : 'bg-[#001E2B] text-[#00ED64] hover:opacity-90'
      }`}>
      {saving ? 'Saving…' : saved ? '✓ Saved' : label}
    </button>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

export function Card({ title, subtitle, children, className }: {
  title: string; subtitle?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-white rounded-xl border p-5 ${className ?? ''}`}>
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// ── FieldLabel ────────────────────────────────────────────────────────────────
//
// Label for a form field with an inline info icon that shows a tooltip on hover.
// Usage: <FieldLabel label="Timeout (ms)" hint="Max wait time before the request is cancelled." />

export function FieldLabel({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1.5 select-none">
      {label}
      <span className="group relative inline-flex items-center cursor-help">
        <Info size={11} className="text-gray-400 group-hover:text-gray-600 transition-colors" />
        {/* Tooltip; appears above the icon */}
        <span
          className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2
            w-60 rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal text-white leading-relaxed
            opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 whitespace-normal shadow-lg">
          {hint}
          {/* Arrow */}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </span>
      </span>
    </span>
  );
}
