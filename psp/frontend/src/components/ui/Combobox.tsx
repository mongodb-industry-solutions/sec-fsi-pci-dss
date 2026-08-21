'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

// One dropdown control for the whole app, in two flavours:
//   editable (default): suggestions plus any typed value, replacing <datalist>
//   editable={false}:   a select, replacing <select>
// Both draw their own panel, because the native <select> popup and the <datalist> popup are
// painted by the browser (grey control, dark list on Chrome) and cannot follow the palette.

export interface ComboOption {
  value: string;
  label?: string;
  group?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: Array<string | ComboOption>;
  /** False renders a select: the value is picked from the list, not typed. */
  editable?: boolean;
  /** Shown when nothing is selected; in select mode it is also the empty-value row. */
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  id?: string;
}

const CONTROL =
  'w-full rounded-lg border border-gray-300 bg-white pl-3 pr-8 py-1.5 text-sm text-[#001E2B] transition-colors hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]';

function normalize(options: Array<string | ComboOption>): ComboOption[] {
  return options.map((o) => (typeof o === 'string' ? { value: o } : o));
}

function labelOf(o: ComboOption): string {
  return o.label ?? o.value;
}

export function Combobox({
  value,
  onChange,
  options,
  editable = true,
  placeholder,
  className = '',
  inputClassName = '',
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => normalize(options), [options]);

  const matches = useMemo(() => {
    if (!editable) return all;
    const q = value.trim().toLowerCase();
    const list = q ? all.filter((o) => labelOf(o).toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : all;
    return list.slice(0, 50);
  }, [all, value, editable]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    setActive(Math.max(0, matches.findIndex((o) => o.value === value)));
  }, [value, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (option: ComboOption) => {
    onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return (next + matches.length) % Math.max(1, matches.length);
      });
      return;
    }
    if ((e.key === 'Enter' || (!editable && e.key === ' ')) && matches[active]) {
      e.preventDefault();
      if (open) commit(matches[active]); else setOpen(true);
      return;
    }
    if (e.key === 'Escape') setOpen(false);
  };

  const selected = all.find((o) => o.value === value);
  const shown = editable ? value : (selected ? labelOf(selected) : '');

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete={editable ? 'list' : 'none'}
        readOnly={!editable}
        value={shown}
        placeholder={placeholder}
        onChange={(e) => { if (editable) { onChange(e.target.value); setOpen(true); } }}
        onFocus={() => setOpen(true)}
        onClick={() => { if (!editable) setOpen((o) => !o); }}
        onKeyDown={onKeyDown}
        className={`${CONTROL} ${editable ? '' : 'cursor-pointer select-none'} ${inputClassName}`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? 'Hide options' : 'Show options'}
        onClick={() => setOpen((o) => !o)}
        className="absolute right-0 top-0 h-full px-2 text-gray-400 hover:text-gray-600"
      >
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && matches.length > 0 && (
        <ul role="listbox" className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {matches.map((o, i) => {
            const groupStart = !!o.group && o.group !== matches[i - 1]?.group;
            return (
              <li key={`${o.group ?? ''}:${o.value}`}>
                {groupStart && (
                  <span className="block px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    {o.group}
                  </span>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(o)}
                  className={`block w-full px-3 py-1.5 text-left text-sm transition-colors ${
                    i === active ? 'bg-[#00ED64]/15 text-[#001E2B]' : 'text-gray-700 hover:bg-gray-50'
                  } ${o.value === value ? 'font-medium' : ''}`}
                >
                  {labelOf(o) || placeholder}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default Combobox;
