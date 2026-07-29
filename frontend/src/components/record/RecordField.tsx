'use client';
// The labelled-field row used by every record view. The QE tier decides the presentation:
// lookup-tier values render directly, sensitive-tier values go through SensitiveReveal.
// Stacks below sm.
import { Tooltip } from '../Tooltip';
import { EncryptionBadge } from '../EncryptionBadge';
import { SensitiveReveal } from '../SensitiveReveal';

/** QE tier of the underlying field, which is what decides how the row behaves. */
export type RecordFieldTier =
  | 'plaintext'   // business metadata, not encrypted
  | 'lookup'      // QE equality/range/prefix/suffix: searchable, rendered directly
  | 'sensitive';  // QE:none: masked, revealed only through an audited endpoint

export interface RecordFieldProps {
  label: string;
  /** Rendered value for plaintext/lookup tiers. Ignored for the sensitive tier. */
  value?: string;
  /** Per-field help: what the datum is, its BIAN origin, its QE mode. */
  info?: string;
  tier?: RecordFieldTier;
  /** Sensitive tier: resolves the ephemeral plaintext from a reveal endpoint. */
  fetchValue?: () => Promise<string>;
  /** Sensitive tier: the caller cannot reveal (shows the mask, disables the eye). */
  revealDisabled?: boolean;
  /** Reason shown when the value is out of reach at this access level. */
  unavailableReason?: string;
  /** Show the QE mode chip (debug mode only, to keep cards uncluttered). */
  qeLabel?: string;
  mono?: boolean;
}

export function RecordField({
  label, value, info, tier = 'plaintext', fetchValue, revealDisabled,
  unavailableReason, qeLabel, mono,
}: RecordFieldProps) {
  if (tier === 'sensitive') {
    // No fetcher means the caller has no reveal path: state that, do not render a fake mask.
    if (!fetchValue) {
      return (
        <Row label={label} info={info}>
          <span className="text-xs text-gray-400 italic">
            {unavailableReason ?? 'Not available at this access level'}
          </span>
        </Row>
      );
    }
    return (
      <SensitiveReveal
        label={label}
        info={info}
        masked="•••• (masked)"
        fetchValue={fetchValue}
        disabled={revealDisabled}
      />
    );
  }

  return (
    <Row label={label} info={info}>
      {qeLabel && <EncryptionBadge label={qeLabel} type="qe-equality" />}
      <span className={`text-gray-800 sm:text-right break-words ${mono ? 'font-mono text-xs' : ''}`}>
        {value || <span className="text-gray-400">n/a</span>}
      </span>
    </Row>
  );
}

// Shared row chrome. Stacks below sm so a long value never overflows a narrow viewport (P8).
function Row({ label, info, children }: { label: string; info?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2.5 border-b border-gray-50 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <span className="flex items-center gap-1.5 text-gray-500 shrink-0">{label}{info && <Tooltip text={info} />}</span>
      <span className="flex items-center gap-2 min-w-0 sm:justify-end">{children}</span>
    </div>
  );
}
