'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { admin } from '../../lib/adminClient';
import {
  FormShell, ListField, NumberField, SelectField, TextField, ToggleField,
} from '../form/Fields';
import { JsonView } from '../JsonView';
import { Panel } from '../Reveal';
import { CAPABILITY_SCHEMAS, describedKeys, type RuleField } from './schema';

// A capability's rules as a FORM.
//
// The two properties that make this safe to hand an operator:
//
//  - EVERY KEY THE SCHEMA DOES NOT DESCRIBE IS PRESERVED. The engines merge a partial document over their own
//    defaults, so a save that dropped an unrecognised key would silently change behaviour, and the change would
//    look in the audit trail like a deliberate edit. What is stored is the document that was read with the
//    described fields written over it.
//  - THE SAVE IS DISABLED UNTIL SOMETHING CHANGED. Writing back exactly what was read is indistinguishable in
//    the trail from a real change, so the form refuses to do it.
//
// The raw document is still visible, at the bottom, read-only. An operator who wants to see exactly what is
// stored should be able to, and that is different from asking them to edit it there.

type Config = Record<string, unknown>;

export function RulesForm({
  capability, initial, consumed, onSaved,
}: {
  capability: string;
  initial: Config;
  consumed: boolean;
  onSaved?: () => void;
}) {
  const schema = CAPABILITY_SCHEMAS[capability];
  const [draft, setDraft] = useState<Config>(initial);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);

  // Anything the schema does not know about, so it can be shown rather than silently carried.
  const undescribed = useMemo(() => {
    if (!schema) return Object.keys(initial);
    const known = new Set(describedKeys(schema));
    return Object.keys(initial).filter((key) => !known.has(key));
  }, [schema, initial]);

  function set(key: string, value: unknown) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  if (!schema) {
    // A capability with no schema is not given a broken form: it is said plainly, and the record is shown.
    return (
      <Panel
        title="No form for this capability yet"
        description="Its rules are not described here, so editing them would mean guessing at the field names. The stored record is below."
      >
        <JsonView data={initial} title={`${capability} rules`} collapsed={1} />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {!consumed && (
        // Worth saying plainly: a record nothing reads is a setting that looks live and is not.
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
          This record exists but no engine in this bank reads it yet, so editing it changes nothing until one
          does. It is kept so the rules have a home before the engine moves here.
        </div>
      )}

      <FormShell
        dirty={dirty}
        submitLabel="Save the rules"
        onReset={() => setDraft(initial)}
        note="The engines read this record on every call, so a saved change applies to the next request without a restart."
        onSubmit={async () => {
          // `configuration` is the name the bank's own contract uses. The first version of this screen sent
          // `bankModuleConfiguration`, the name the stored record uses, and every save was refused by schema
          // validation before it reached the handler.
          await admin.put(`module/config/${capability}`, { configuration: draft, updatedBy: 'bank-admin-app' });
          onSaved?.();
        }}
      >
        {schema.sections.map((section) => (
          <section key={section.title} className="py-4 first:pt-0">
            <h3 className="text-sm font-semibold">{section.title}</h3>
            {section.description && (
              <p className="mt-1 max-w-3xl text-pretty text-xs leading-relaxed text-ink-soft">{section.description}</p>
            )}
            <div className="mt-2 divide-y divide-line">
              {section.fields.map((field) => (
                <Control
                  key={field.key}
                  field={field}
                  value={draft[field.key]}
                  onChange={(value) => set(field.key, value)}
                />
              ))}
            </div>
          </section>
        ))}
      </FormShell>

      {undescribed.length > 0 && (
        <Panel
          title="Also stored, and left untouched"
          description="These keys are in the record but not on the form above. A save preserves them exactly as they are rather than dropping them."
        >
          <JsonView
            data={Object.fromEntries(undescribed.map((key) => [key, initial[key]]))}
            title="Undescribed keys"
            collapsed={1}
          />
        </Panel>
      )}
    </div>
  );
}

function Control({
  field, value, onChange,
}: {
  field: RuleField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (field.kind) {
    case 'text':
      return (
        <TextField
          label={field.label}
          hint={field.hint}
          mono={field.mono}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
        />
      );
    case 'number':
      return (
        <NumberField
          label={field.label}
          hint={field.hint}
          min={field.min}
          max={field.max}
          step={field.step}
          suffix={field.suffix}
          value={typeof value === 'number' ? value : ''}
          onChange={onChange}
        />
      );
    case 'boolean':
      return (
        <ToggleField label={field.label} hint={field.hint} value={value === true} onChange={onChange} />
      );
    case 'select':
      return (
        <SelectField
          label={field.label}
          hint={field.hint}
          options={field.options}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          placeholder="Not set"
        />
      );
    case 'stringList':
      return (
        <ListField
          label={field.label}
          hint={field.hint}
          placeholder={field.placeholder}
          uppercase={field.uppercase}
          value={Array.isArray(value) ? value.map(String) : []}
          onChange={onChange}
        />
      );
    case 'group':
      return (
        <RepeatingGroup
          field={field}
          rows={Array.isArray(value) ? (value as Config[]) : []}
          onChange={onChange}
        />
      );
    default:
      return null;
  }
}

/**
 * A collection of like things: the accepted networks, the rating bands.
 *
 * Collapsed by default and titled by one field, because six networks each with five settings is eighty controls
 * on one screen otherwise, and on a phone that is a page nobody reaches the bottom of.
 */
function RepeatingGroup({
  field, rows, onChange,
}: {
  field: Extract<RuleField, { kind: 'group' }>;
  rows: Config[];
  onChange: (rows: Config[]) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);

  function update(index: number, key: string, value: unknown) {
    onChange(rows.map((row, position) => (position === index ? { ...row, [key]: value } : row)));
  }

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm">{field.label}</p>
          {field.hint && <p className="mt-0.5 text-pretty text-[11px] leading-relaxed text-ink-soft">{field.hint}</p>}
        </div>
        <button
          type="button"
          onClick={() => { onChange([...rows, {}]); setOpen(rows.length); }}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 text-xs text-ink-soft transition hover:border-accent hover:text-ink"
        >
          <Plus size={13} aria-hidden /> Add a {field.itemNoun}
        </button>
      </div>

      <ul className="mt-2 space-y-2">
        {rows.map((row, index) => {
          const title = row[field.titleKey];
          const expanded = open === index;
          const disabled = row.enabled === false;
          return (
            <li key={index} className="overflow-hidden rounded-xl border border-line bg-surface-alt">
              <div className="flex items-center gap-2 px-2 py-2">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : index)}
                  aria-expanded={expanded}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                  <span className={`truncate font-mono text-xs ${disabled ? 'text-ink-soft line-through' : ''}`}>
                    {title === undefined || title === '' ? `a new ${field.itemNoun}` : String(title)}
                  </span>
                  {disabled && <span className="shrink-0 text-[11px] text-ink-soft">not accepted</span>}
                </button>
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((_, position) => position !== index))}
                  aria-label={`Remove this ${field.itemNoun}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-red-500/10 hover:text-red-600"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
              {expanded && (
                <div className="divide-y divide-line border-t border-line px-3">
                  {field.fields.map((child) => (
                    <Control
                      key={child.key}
                      field={child}
                      value={row[child.key]}
                      onChange={(value) => update(index, child.key, value)}
                    />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {rows.length === 0 && (
        <p className="mt-2 text-xs text-ink-soft">None configured. The engine falls back to its own defaults.</p>
      )}
    </div>
  );
}
