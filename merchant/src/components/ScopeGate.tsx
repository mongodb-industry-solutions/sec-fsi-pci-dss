// Small helper for graceful degradation (E-12): renders a friendly notice when a
// required scope was not granted, instead of breaking the page.
export function ScopeMissing({ scope }: { scope: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="font-semibold text-amber-800">Permission not granted</h2>
      <p className="text-sm text-amber-700 mt-1">
        This feature needs the <code className="font-mono">{scope}</code> permission, which you did
        not grant to Espresso Works. You can{' '}
        <a href="/api/auth/login" className="underline">re-authorise</a> to enable it.
      </p>
    </div>
  );
}

export function PspUnavailable({ message }: { message?: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6">
      <h2 className="font-semibold text-red-800">Not available</h2>
      <p className="text-sm text-red-700 mt-1">
        {message ?? 'The PSP declined this request or is unreachable.'}
      </p>
    </div>
  );
}
