'use client';
import { useState } from 'react';
import { api } from '../lib/api';

export interface RawMongoSection {
  /** MongoDB collection name (used for the API call). */
  collection: string;
  /** Document UUID to fetch. */
  id: string;
  /** Display name shown in the accordion header. */
  label: string;
  /** Tailwind text-color class for the label (e.g. "text-blue-400"). */
  labelColor?: string;
  /** Short description of what is encrypted in this collection. */
  description: string;
  /** Max height of the expanded pre block (Tailwind class, default "max-h-72"). */
  maxHeight?: string;
}

interface Props {
  sections: RawMongoSection[];
  token: string;
  title?: string;
}

const SCROLLBAR_CLASSES = [
  '[scrollbar-width:thin] [scrollbar-color:#00ED64_#001020]',
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5',
  '[&::-webkit-scrollbar-track]:bg-[#001020] [&::-webkit-scrollbar-track]:rounded-full',
  '[&::-webkit-scrollbar-thumb]:bg-[#00ED64]/40 [&::-webkit-scrollbar-thumb]:rounded-full',
  '[&::-webkit-scrollbar-thumb:hover]:bg-[#00ED64]/70',
  '[&::-webkit-scrollbar-corner]:bg-[#001020]',
].join(' ');

export function RawMongoPanel({ sections, token, title = 'Debug - Raw MongoDB documents' }: Props) {
  const [state, setState] = useState<Record<string, {
    expanded: boolean;
    doc: unknown;
    loading: boolean;
    error: string | null;
  }>>(() =>
    Object.fromEntries(sections.map(s => [s.collection, { expanded: false, doc: null, loading: false, error: null }]))
  );

  async function toggle(section: RawMongoSection) {
    const key = section.collection;
    const current = state[key];

    if (current.expanded) {
      setState(p => ({ ...p, [key]: { ...p[key], expanded: false } }));
      return;
    }

    // Already fetched — just expand
    if (current.doc !== null || current.error) {
      setState(p => ({ ...p, [key]: { ...p[key], expanded: true } }));
      return;
    }

    // First expand — fetch from Atlas
    setState(p => ({ ...p, [key]: { ...p[key], loading: true, expanded: true } }));
    try {
      const res = await api.system.rawDocument(section.collection, section.id, token);
      setState(p => ({ ...p, [key]: { ...p[key], loading: false, doc: res.document } }));
    } catch (e) {
      setState(p => ({
        ...p,
        [key]: { ...p[key], loading: false, error: e instanceof Error ? e.message : 'Failed to fetch' },
      }));
    }
  }

  return (
    <div className="rounded-xl overflow-hidden border border-[#00ED64]/20">

      {/* Panel header — full dark background, same as DebugRawJson */}
      <div className="bg-[#001E2B] px-4 py-2.5 flex items-center gap-2">
        <span className="text-[#00ED64] text-xs font-semibold">{title}</span>
        <span className="text-gray-500 text-xs hidden sm:inline">
          Fields stored as{' '}
          <span className="font-mono text-amber-400">{'"$binary"'}</span>
          {' '}are QE ciphertext; Atlas never sees the plaintext.
        </span>
      </div>

      {/* Accordion sections */}
      {sections.map(section => {
        const s = state[section.collection];
        const maxH = section.maxHeight ?? 'max-h-72';

        return (
          <div key={section.collection} className="border-t border-[#00ED64]/60">

            {/* Row header: same bg as header; hover adds a subtle green tint */}
            <button
              onClick={() => toggle(section)}
              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left bg-[#001E2B] hover:bg-[#00ED64]/5 transition-colors duration-150"
            >
              <span className="flex items-center gap-2 flex-wrap text-xs font-mono min-w-0">
                <span className="text-gray-500 shrink-0">Collection:</span>
                <span className={`${section.labelColor ?? 'text-green-400'} shrink-0`}>
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

            {/* Section body */}
            {s.expanded && (
              <div className="border-t border-[#00ED64]/20">
                {s.loading && (
                  <p className="px-4 py-3 text-xs text-gray-500 font-mono animate-pulse bg-[#001E2B]">
                    Fetching document from Atlas...
                  </p>
                )}
                {s.error && (
                  <p className="px-4 py-3 text-xs text-red-400 font-mono bg-[#001E2B]">
                    Error: {s.error}
                  </p>
                )}
                {s.doc != null && !s.loading && (
                  <pre className={[
                    'text-xs text-green-300 whitespace-pre font-mono',
                    `${maxH} overflow-auto bg-[#001E2B] px-4 py-3`,
                    SCROLLBAR_CLASSES,
                  ].join(' ')}>
                    {JSON.stringify(s.doc, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
