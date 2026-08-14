'use client';
// Explicit global boundary (as in the merchant app): the builtin one can be missing from the manifest.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'Inter, system-ui, sans-serif', margin: 0, background: '#f8fafb', color: '#001e2b' }}>
        <div style={{ maxWidth: 480, margin: '10vh auto', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Something went wrong</h1>
          <p style={{ color: '#4f6470', fontSize: '.9rem', marginTop: '.5rem' }}>
            The app hit an unexpected error. You can try again.
          </p>
          {error.digest && (
            <p style={{ color: '#89979b', fontSize: '.75rem', marginTop: '.5rem', fontFamily: 'monospace' }}>
              ref: {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{ marginTop: '1rem', padding: '.5rem 1rem', borderRadius: 12, border: 0, background: '#00684a', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
