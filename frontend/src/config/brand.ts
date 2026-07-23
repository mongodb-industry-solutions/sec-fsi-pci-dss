// Product / system name (single source of truth).
//
// The brand name is COMPOUND and the two words are styled separately in the UI (e.g. the second
// word is highlighted), so it is managed as two variables. Override either word via the environment
// (NEXT_PUBLIC_PSP_NAME_PRIMARY / NEXT_PUBLIC_PSP_NAME_SECONDARY); when unset, the current default
// name is used. Changing the name is a one-line env change, no code edits.
const primary = (process.env.NEXT_PUBLIC_PSP_NAME_PRIMARY || 'Sec4').trim();
const secondary = (process.env.NEXT_PUBLIC_PSP_NAME_SECONDARY || 'Pay').trim();

export const BRAND = {
  /** First word (e.g. "Sec4"). */
  primary,
  /** Second word, usually the highlighted one (e.g. "Pay"). */
  secondary,
  /** Full display name ("Sec4 Pay"). Use in prose, titles, alt text. */
  full: `${primary} ${secondary}`.trim(),
} as const;
