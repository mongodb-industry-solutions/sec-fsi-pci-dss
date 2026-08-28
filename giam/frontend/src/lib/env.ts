// Everything the console needs to reach the identity API, resolved in one place.
//
// An empty base means "same origin": the Next.js rewrites forward to the API server side, so the
// browser never makes a cross-origin call and no deployment needs a CORS entry to work.
export const env = {
  apiBaseUrl: (process.env.NEXT_PUBLIC_GIAM_API_URL || '').replace(/\/+$/, ''),
} as const;

export function apiUrl(path: string): string {
  return `${env.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
