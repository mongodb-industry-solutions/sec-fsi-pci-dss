// Centralized PSP product name. The brand is compound (two words) because some
// UIs style each word separately. Reads the environment with sensible defaults so
// the name is easy to change in one place.
const primary = (process.env.NEXT_PUBLIC_PSP_NAME_PRIMARY || 'Sec4').trim();
const secondary = (process.env.NEXT_PUBLIC_PSP_NAME_SECONDARY || 'Pay').trim();

export const BRAND = { primary, secondary, full: `${primary} ${secondary}`.trim() } as const;
