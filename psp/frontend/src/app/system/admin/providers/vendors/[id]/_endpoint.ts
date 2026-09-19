// Shared endpoint classification for the inbound/outbound URL fields.
//
// It answers one question for the operator: given what is stored here, where does the request go?
// A relative path is not an answer, and it is not evidence of anything either: the same
// `/v1/cards/validations` is the PSP's own API on a built-in engine and another institution's API on
// a provider that carries a base URL.

export interface EndpointInfo {
  valid: boolean;
  /** Handled by the PSP's own API, in this process. */
  isInternal: boolean;
  note?: string;
  /** The full target, once the base URL and the environment's link binding are applied. */
  resolved?: string;
}

const INTERNAL_CALLBACK = /^\/api\/v1\/providers\/callback\/.+$/i;
const LINK_PLACEHOLDER = /\{\{[A-Za-z]+\}\}/;

/**
 * @param url      the stored value, relative or absolute, possibly naming a link
 * @param baseUrl  the provider's own base URL as the server resolved it for this environment;
 *                 absent for a provider that has none (the built-in engines)
 *
 * THE DEFECT THIS FIXES. Every relative path was classified internal and rendered as
 * `${PSP_BASE_URL}/v1/cards/validations` under a note reading "this points to the PSP internal API;
 * the request will be handled in-process". For the four capabilities v37 moved to the bank that was
 * the opposite of the truth on both counts: the path is the bank's, the base URL is the bank's, and
 * the request leaves this process for another institution. An operator asking where cardholder data
 * is sent was being shown the wrong system.
 */
export function classifyEndpoint(url: string, baseUrl?: string): EndpointInfo {
  const u = (url ?? '').trim();
  if (!u) return { valid: true, isInternal: false };

  const isAbsolute = /^https?:\/\//i.test(u);
  const isRelative = u.startsWith('/');
  // A value naming a link carries no host of its own and is neither: it is resolved by the server,
  // and rejecting it as malformed would flag every record the seeder writes.
  const namesLink = LINK_PLACEHOLDER.test(u);
  if (!isAbsolute && !isRelative && !namesLink) {
    return { valid: false, isInternal: false };
  }

  let host = '';
  if (isAbsolute) {
    try { host = new URL(u).host; } catch { return { valid: false, isInternal: false }; }
  }

  // A relative path belongs to whoever owns the base URL. With one, this provider is reached over the
  // wire and the path is theirs; without one, it resolves against the PSP and is ours.
  const external = !!baseUrl;
  const isInternal = !external && (
    isRelative || /(^|\.)localhost(:|$)/i.test(host) || /127\.0\.0\.1/.test(host) || /\/api\/v1\//.test(u)
  );

  const resolved = isAbsolute
    ? u
    : baseUrl
      ? `${baseUrl.replace(/\/$/, '')}${u.startsWith('/') ? u : `/${u}`}`
      : `\${PSP_BASE_URL}${u}`;

  const note = isInternal
    ? (INTERNAL_CALLBACK.test(u)
        ? 'Internal PSP webhook callback. The request will be handled by the PSP API itself.'
        : 'This points to the PSP internal API; the request will be handled in-process.')
    : external
      ? 'This path belongs to the external provider and is dispatched out of this process to the host below.'
      : undefined;

  return { valid: true, isInternal, note, resolved };
}
