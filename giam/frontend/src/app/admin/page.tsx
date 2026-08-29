'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listViews, readView, readPosture, cellText,
  adminToken, setAdminToken, clearAdminToken,
  AdminError, type ConsoleView, type Posture,
} from '../../lib/admin';

/**
 * The operator console.
 *
 * One screen driven by the catalog the authority publishes, rather than nine screens that each know
 * the shape of one collection. A view added at the authority appears here on the next load, and the
 * columns come from what the API says it returns: the console cannot show a field the API withholds,
 * because it never learns the field exists.
 *
 * Read only, deliberately. Changing a realm, a role or a client is a mutation that deserves its own
 * route, its own audit event and its own confirmation, none of which belong behind a table cell.
 */
export default function AdminPage() {
  const [views, setViews] = useState<ConsoleView[]>([]);
  const [active, setActive] = useState<string>('');
  const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);
  const [total, setTotal] = useState(0);
  const [realm, setRealm] = useState('');
  const [search, setSearch] = useState('');
  const [posture, setPosture] = useState<Posture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);

  const handle = useCallback((cause: unknown) => {
    if (cause instanceof AdminError) {
      // 503 means nobody configured a credential, and 401 means the one held is wrong. They are
      // different problems and the console says which, rather than showing one login box for both.
      setNeedsToken(cause.status === 401);
      setError(cause.status === 503
        ? 'This authority has no administrative credential configured, so the surface is closed.'
        : cause.message);
      return;
    }
    setError('The identity service could not be reached.');
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const { views: available } = await listViews();
      setViews(available);
      setNeedsToken(false);
      setError(null);
      setActive((current) => current || available[0]?.name || '');
      setPosture(await readPosture().catch(() => null));
    } catch (cause) {
      handle(cause);
    }
  }, [handle]);

  useEffect(() => {
    if (!adminToken()) {
      setNeedsToken(true);
      return;
    }
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    readView(active, { realm: realm || undefined, q: search || undefined, limit: 100 })
      .then((page) => {
        if (cancelled) return;
        setRecords(page.records);
        setTotal(page.total);
        setError(null);
      })
      .catch((cause) => { if (!cancelled) handle(cause); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, realm, search, handle]);

  if (needsToken) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAdminToken(token);
            void loadCatalog();
          }}
          className="w-full max-w-md rounded-xl border bg-white p-8 shadow-sm"
        >
          <h1 className="text-2xl font-semibold text-mongodb-dark">Operator console</h1>
          <p className="mt-2 text-sm text-gray-500">
            This surface has its own credential, separate from any sign-in.
          </p>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
            className="mt-6 w-full rounded-md border px-3 py-2"
            placeholder="Administrative token"
          />
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <button type="submit" className="mt-4 w-full rounded-md bg-mongodb-green px-4 py-2 font-medium text-mongodb-dark">
            Continue
          </button>
        </form>
      </main>
    );
  }

  const current = views.find((view) => view.name === active);
  const columns = current?.fields ?? [];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-mongodb-dark">Operator console</h1>
          <div className="flex items-center gap-4">
            {posture && (
              // Shown next to everything else on purpose. A weakness reported only in a log nobody
              // opens is the same as a weakness nobody reported.
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  posture.status === 'healthy' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'
                }`}
                title={posture.findings?.map((finding) => finding.code).join(', ')}
              >
                {posture.status}
                {posture.findings?.length ? ` · ${posture.findings.length}` : ''}
              </span>
            )}
            <button
              type="button"
              onClick={() => { clearAdminToken(); setNeedsToken(true); }}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              Forget token
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        <nav className="w-56 shrink-0 border-r bg-white p-3">
          {views.map((view) => (
            <button
              key={view.name}
              type="button"
              onClick={() => { setActive(view.name); setSearch(''); }}
              className={`mb-1 block w-full rounded-md px-3 py-2 text-left text-sm ${
                view.name === active ? 'bg-gray-100 font-medium text-mongodb-dark' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {view.name}
            </button>
          ))}
        </nav>

        <section className="min-w-0 flex-1 p-6">
          {current && (
            <div className="mb-4">
              <h2 className="text-lg font-medium text-mongodb-dark">{current.summary}</h2>
              {current.note && (
                // The reason a field is missing, shown where somebody would otherwise wonder.
                <p className="mt-1 text-sm text-gray-500">{current.note}</p>
              )}
            </div>
          )}

          <div className="mb-4 flex gap-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search the fields shown"
              className="w-72 rounded-md border px-3 py-2 text-sm"
            />
            {current?.realmScoped && (
              <input
                value={realm}
                onChange={(event) => setRealm(event.target.value)}
                placeholder="Realm"
                className="w-48 rounded-md border px-3 py-2 text-sm"
              />
            )}
            <span className="self-center text-sm text-gray-500">
              {loading ? 'Loading…' : `${records.length} of ${total}`}
            </span>
          </div>

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          <div className="overflow-auto rounded-lg border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  {columns.map((column) => (
                    <th key={column} className="whitespace-nowrap px-3 py-2 font-medium">{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((record, index) => (
                  <tr key={index} className="border-t align-top">
                    {columns.map((column) => (
                      <td key={column} className="max-w-xs truncate px-3 py-2" title={cellText(record[column])}>
                        {cellText(record[column])}
                      </td>
                    ))}
                  </tr>
                ))}
                {!loading && records.length === 0 && (
                  <tr>
                    <td colSpan={Math.max(1, columns.length)} className="px-3 py-8 text-center text-gray-500">
                      Nothing matches.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
