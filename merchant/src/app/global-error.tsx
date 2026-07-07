'use client';
// Explicit global error boundary. Providing our own avoids the Turbopack/RSC bug where the
// builtin global-error module is missing from the React Client Manifest (which crashed the
// server render and, in dev, fed a reload loop). Must render its own <html>/<body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'Inter, system-ui, sans-serif', margin: 0, background: '#f2f6f4', color: '#001e2b' }}>
        <div style={{ maxWidth: 480, margin: '10vh auto', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Something went wrong</h1>
          <p style={{ color: '#4f6470', fontSize: '.9rem', marginTop: '.5rem' }}>
            The app hit an unexpected error. You can try again.
          </p>
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
