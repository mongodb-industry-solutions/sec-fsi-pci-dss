// Provenance chip shown only in debug mode: BIAN service domain / control record
// labels ("SD-53 · BQ:Step · KycCheck · PCI Req 8.1") and collection names.
// Labels are long, so segments split on "·" wrap independently instead of forcing
// the surrounding header to overflow on narrow screens.

const TONES = {
  bian: 'bg-teal-50 text-teal-700 border-teal-200',
  collection: 'bg-[#001E2B]/5 text-amber-600 border-amber-200/60',
  standard: 'bg-slate-50 text-slate-600 border-slate-200',
} as const;

interface Props {
  label: string;
  tone?: keyof typeof TONES;
  className?: string;
}

export function DebugChip({ label, tone = 'bian', className = '' }: Props) {
  const parts = label.split('·').map(p => p.trim()).filter(Boolean);

  return (
    <span
      className={`inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 min-w-0 max-w-full px-1.5 py-0.5 rounded border font-mono leading-snug text-[10px] sm:text-xs [overflow-wrap:anywhere] ${TONES[tone]} ${className}`}
      title={label}
    >
      {parts.map((part, i) => (
        <span key={part} className="inline-flex items-center gap-1">
          {i > 0 && <span aria-hidden="true" className="opacity-50">·</span>}
          {part}
        </span>
      ))}
    </span>
  );
}

export default DebugChip;
