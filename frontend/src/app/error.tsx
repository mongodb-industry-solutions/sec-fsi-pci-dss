'use client';
// Route-level boundary, dependency-free so it cannot fail for the reason it is catching.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center p-6">
      <div className="bg-white rounded-xl border border-red-200 p-6 max-w-xl w-full">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-0.5 text-red-600">⚠</span>
          <div className="min-w-0">
            <h2 className="font-semibold text-[#001E2B]">This section hit an unexpected error</h2>
            <p className="mt-1 text-sm text-gray-600">
              The rest of the app keeps working. Retry, and if it persists report the reference below.
            </p>
            {error.digest && (
              <p className="mt-2 text-xs font-mono text-gray-400 truncate">ref: {error.digest}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => reset()}
                className="px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-semibold"
              >
                Try again
              </button>
              <a href="/system" className="px-4 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">
                Back to overview
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
