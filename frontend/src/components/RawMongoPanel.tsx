'use client';
import { useState } from 'react';
import { api } from '../lib/api';

/**
 * Static section: data is already available (e.g. API response, localStorage).
 * Renders immediately without any network call.
 */
export interface StaticSection {
  kind: 'static';
  /** Display label shown in the accordion header. */
  label: string;
  /** Tailwind text-color class for the label (e.g. "text-yellow-400"). */
  labelColor?: string;
  /** Short description of the data source. */
  description: string;
  /** The data to display. */
  data: unknown;
  /** Max height of the expanded pre block (Tailwind class, default "max-h-64"). */
  maxHeight?: string;
}

/**
 * Dynamic section: fetches the raw MongoDB document from Atlas via
 * GET /api/v1/system/raw/:collection/:id (lazy on first expand).
 * Shows BSON ciphertext for QE-encrypted fields.
 */
export interface MongoSection {
  kind: 'mongo';
  /** MongoDB collection name. */
  collection: string;
  /** Document UUID to fetch. */
  id: string;
  /** Display label shown in the accordion header. */
  label: string;
  /** Tailwind text-color class for the label (e.g. "text-blue-400"). */
  labelColor?: string;
  /** Short description of what is encrypted in this collection. */
  description: string;
  /** Max height of the expanded pre block (Tailwind class, default "max-h-72"). */
  maxHeight?: string;
}

export type RawPanelSection = StaticSection | MongoSection;

interface Props {
  sections: RawPanelSection[];
  /** JWT token — required only when one or more sections have kind: 'mongo'. */
  token?: string;
  title?: string;
}

// ── Internal section state (used only for mongo sections) ─────────────────────
interface SectionState {
  expanded: boolean;
  doc: unknown;
  loading: boolean;
  error: string | null;
}

const SCROLLBAR_CLASSES = [
  '[scrollbar-width:thin] [scrollbar-color:#00ED64_#001020]',
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5',
  '[&::-webkit-scrollbar-track]:bg-[#001020] [&::-webkit-scrollbar-track]:rounded-full',
  '[&::-webkit-scrollbar-thumb]:bg-[#00ED64]/40 [&::-webkit-scrollbar-thumb]:rounded-full',
  '[&::-webkit-scrollbar-thumb:hover]:bg-[#00ED64]/70',
  '[&::-webkit-scrollbar-corner]:bg-[#001020]',
].join(' ');

function key(s: RawPanelSection): string {
  return s.kind === 'mongo' ? `mongo:${s.collection}` : `static:${s.label}`;
}

function defaultExpanded(s: RawPanelSection): boolean {
  // Static sections start collapsed (data is shown on demand);
  // Mongo sections also start collapsed (loaded lazily).
  return false;
}

export function RawMongoPanel({
  sections,
  token = '',
  title = 'Debug - Raw data',
}: Props) {
  const [state, setState] = useState<Record<string, SectionState>>(() =>
    Object.fromEntries(
      sections.map(s => [
        key(s),
        { expanded: defaultExpanded(s), doc: null, loading: false, error: null },
      ])
    )
  );

  async function toggle(section: RawPanelSection) {
    const k = key(section);
    const current = state[k];

    if (current.expanded) {
      setState(p => ({ ...p, [k]: { ...p[k], expanded: false } }));
      return;
    }

    if (section.kind === 'static') {
      // Static: just expand, data is already available as a prop
      setState(p => ({ ...p, [k]: { ...p[k], expanded: true } }));
      return;
    }

    // Mongo: already fetched
    if (current.doc !== null || current.error) {
      setState(p => ({ ...p, [k]: { ...p[k], expanded: true } }));
      return;
    }

    // Mongo: first expand — fetch from Atlas
    setState(p => ({ ...p, [k]: { ...p[k], loading: true, expanded: true } }));
    try {
      const res = await api.system.rawDocument(section.collection, section.id, token);
      setState(p => ({ ...p, [k]: { ...p[k], loading: false, doc: res.document } }));
    } catch (e) {
      setState(p => ({
        ...p,
        [k]: { ...p[k], loading: false, error: e instanceof Error ? e.message : 'Failed to fetch' },
      }));
    }
  }

  const hasMongoSections = sections.some(s => s.kind === 'mongo');

  return (
    <div className="rounded-xl overflow-hidden border border-[#00ED64]/20">

      {/* Panel header */}
      <div className="bg-[#001E2B] px-4 py-2.5 flex items-center gap-2">
        <span className="text-[#00ED64] text-xs font-semibold">{title}</span>
        {hasMongoSections && (
          <span className="text-gray-500 text-xs hidden sm:inline">
            Fields stored as{' '}
            <span className="font-mono text-amber-400">{'"$binary"'}</span>
            {' '}are QE ciphertext; Atlas never sees the plaintext.
          </span>
        )}
      </div>

      {/* Accordion */}
      {sections.map(section => {
        const k = key(section);
        const s = state[k];
        const maxH = section.maxHeight ?? (section.kind === 'static' ? 'max-h-64' : 'max-h-72');
        const data = section.kind === 'static' ? section.data : s.doc;

        return (
          <div key={k} className="border-t border-[#00ED64]/60">

            <button
              onClick={() => toggle(section)}
              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left bg-[#001E2B] hover:bg-[#001020] transition-colors duration-150"
            >
              <span className="flex items-center gap-2 flex-wrap text-xs font-mono min-w-0">
                {/* Badge: 'static' or 'mongo' to distinguish source */}
                <span className={`text-xs px-1.5 py-0.5 rounded font-sans shrink-0 ${
                  section.kind === 'static'
                    ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-400/20'
                    : 'bg-[#00ED64]/10 text-[#00ED64] border border-[#00ED64]/20'
                }`}>
                  {section.kind === 'static' ? 'API' : 'Atlas'}
                </span>

                <span className={`${section.labelColor ?? (section.kind === 'static' ? 'text-gray-300' : 'text-green-400')} shrink-0`}>
                  {section.label}
                </span>

                <span className="text-gray-600 font-sans hidden md:inline truncate">
                  {section.description}
                </span>
              </span>

              <span className="text-[#00ED64] text-xs shrink-0">
                {s.loading ? '...' : s.expanded ? '▲' : '▼'}
              </span>
            </button>

            {s.expanded && (
              <div className="border-t border-[#00ED64]/20">
                {/* Loading (mongo only) */}
                {s.loading && (
                  <p className="px-4 py-3 text-xs text-gray-500 font-mono animate-pulse bg-[#001E2B]">
                    Fetching document from Atlas...
                  </p>
                )}

                {/* Error (mongo only) */}
                {s.error && (
                  <p className="px-4 py-3 text-xs text-red-400 font-mono bg-[#001E2B]">
                    Error: {s.error}
                  </p>
                )}

                {/* Content */}
                {data != null && !s.loading && (
                  <pre className={[
                    'text-xs text-green-300 whitespace-pre font-mono',
                    `${maxH} overflow-auto bg-[#001E2B] px-4 py-3`,
                    SCROLLBAR_CLASSES,
                  ].join(' ')}>
                    {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
                  </pre>
                )}

                {/* Static with null data */}
                {section.kind === 'static' && data == null && !s.loading && (
                  <p className="px-4 py-3 text-xs text-gray-600 font-mono bg-[#001E2B] italic">
                    null — data not yet loaded
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
