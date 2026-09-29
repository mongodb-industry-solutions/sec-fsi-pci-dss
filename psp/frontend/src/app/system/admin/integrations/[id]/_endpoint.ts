// Shared endpoint classification for inbound/outbound test URL fields.
// Validates the format and flags URLs that target the PSP's own internal API
// (relative paths or localhost), so the UI can warn the operator and show the
// full URL that will actually be called.

export interface EndpointInfo {
  valid: boolean;
  isInternal: boolean;
  note?: string;
  resolved?: string;
}

const INTERNAL_CALLBACK = /^\/api\/v1\/webhooks\/[^/]+\/callback$/i;

export function classifyEndpoint(url: string): EndpointInfo {
  const u = (url ?? '').trim();
  if (!u) return { valid: true, isInternal: false };

  const isAbsolute = /^https?:\/\//i.test(u);
  const isRelative = u.startsWith('/');
  if (!isAbsolute && !isRelative) {
    return { valid: false, isInternal: false };
  }

  let host = '';
  if (isAbsolute) {
    try { host = new URL(u).host; } catch { return { valid: false, isInternal: false }; }
  }

  const isInternal = isRelative || /(^|\.)localhost(:|$)/i.test(host) || /127\.0\.0\.1/.test(host) || /\/api\/v1\//.test(u);

  let note: string | undefined;
  let resolved: string | undefined;
  if (isInternal) {
    resolved = isRelative ? `\${PSP_BASE_URL}${u}` : u;
    note = INTERNAL_CALLBACK.test(u)
      ? 'Internal PSP webhook callback. The request will be handled by the PSP API itself.'
      : 'This points to the PSP internal API; the request will be handled in-process.';
  }
  return { valid: true, isInternal, note, resolved };
}
