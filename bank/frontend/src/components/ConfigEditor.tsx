'use client';
import { useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';

// Edits a capability's configuration as the document it is.
//
// A form with one field per setting would have to be rewritten every time the bank adds one, and would
// silently hide the new setting until someone did. The document IS the contract: each engine owns the shape of
// its own record and merges it over its defaults, so a partial document is always valid and an unknown key is
// dropped by the bank rather than accepted.

interface Props {
  capability: string;
  initial: Record<string, unknown>;
}

export function ConfigEditor({ capability, initial }: Props) {
  const original = JSON.stringify(initial, null, 2);
  const [text, setText] = useState(original);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  const dirty = text !== original && state !== 'saved';

  async function save() {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      // Caught here rather than sent: a malformed document would come back refused with a message about the
      // request body, which is a longer way round to the same fact.
      setError(`That is not valid JSON: ${(err as Error).message}`);
      return;
    }

    setState('saving');
    try {
      const response = await fetch(`/api/admin/module/config/${encodeURIComponent(capability)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankModuleConfiguration: parsed }),
      });
      const body = await response.json().catch(() => null) as
        { error?: string; tppMessages?: { text?: string }[] } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? body?.tppMessages?.[0]?.text ?? `the bank answered ${response.status}`);
      }
      setState('saved');
    } catch (err) {
      setState('idle');
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-line bg-surface focus-within:border-accent">
        <textarea
          value={text}
          onChange={(event) => { setText(event.target.value); setState('idle'); }}
          spellCheck={false}
          aria-label={`${capability} configuration document`}
          // Shorter on a phone so the save control stays reachable without scrolling past the whole document.
          className="h-[55vh] w-full resize-y bg-transparent p-3 font-mono text-[11px] leading-relaxed outline-none sm:h-[60vh] sm:p-4 sm:text-xs"
        />
      </div>

      {error && (
        <p className="flex items-start gap-2 text-xs text-red-700 dark:text-red-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span className="break-words">{error}</span>
        </p>
      )}

      {/* Sticky at the bottom on a phone: on a long document the control would otherwise be off-screen at the
          moment it is wanted. */}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
        <button
          type="button"
          onClick={save}
          disabled={state === 'saving' || !dirty}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {state === 'saved' && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <Check size={14} aria-hidden />
            Saved. The engines read this record per call, so it is already in effect.
          </span>
        )}
        {dirty && state === 'idle' && <span className="text-xs text-ink-soft">Unsaved changes.</span>}
      </div>
    </div>
  );
}
