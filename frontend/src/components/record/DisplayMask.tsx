'use client';
// Screen-sharing mask over a value the caller already holds (own record, or lookup tier). Not an
// access control: its tooltip says so. Sensitive-tier values belonging to another party use
// SensitiveReveal, which fetches from an audited endpoint.
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Tooltip } from '../Tooltip';

export const DISPLAY_MASK = '••••••••';

export const DISPLAY_MASK_NOTE =
  'Hidden for screen sharing only. You are already authorised to see this value, so hiding it is a '
  + 'display convenience, not an access control.';

export function DisplayMask({
  label,
  value,
  info,
  chrome,
  renderValue,
  actions,
}: {
  label: string;
  /** The plaintext the caller already holds. */
  value: string;
  /** What the datum is. The display-mask note is appended, so the affordance is self-describing. */
  info?: string;
  /** Optional badges rendered next to the label (QE mode chip, collection chip). */
  chrome?: React.ReactNode;
  /** Optional custom rendering of the revealed value. */
  renderValue?: (shown: string) => React.ReactNode;
  /** Extra controls shown only once the value is visible (for example copy to clipboard). */
  actions?: (shown: string) => React.ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-gray-500 text-sm">{label}</span>
        <Tooltip text={info ? `${info} ${DISPLAY_MASK_NOTE}` : DISPLAY_MASK_NOTE} />
        {chrome}
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`text-sm font-mono transition-all break-all min-w-0 ${shown ? 'text-gray-900' : 'text-gray-400 select-none'}`}>
          {shown ? (renderValue ? renderValue(value) : value) : DISPLAY_MASK}
        </span>
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          title={shown ? `Hide ${label}` : `Show ${label}`}
          aria-label={shown ? `Hide ${label}` : `Show ${label}`}
          aria-pressed={shown}
          className="text-gray-400 hover:text-[#001E2B] transition-colors shrink-0"
        >
          {shown ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        {shown && actions?.(value)}
      </div>
    </>
  );
}
