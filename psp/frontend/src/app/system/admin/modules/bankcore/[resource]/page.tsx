'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Landmark, ArrowLeft } from 'lucide-react';
import { SectionHeader } from '../../../../../../components/SectionHeader';
import { getToken } from '../../../../../../lib/auth';

// Reads one of the bank's administrative records through the PSP. Never at the bank: the browser keeps one
// origin and one token, and a test fails any frontend source that targets the bank directly.

const TITLES: Record<string, { title: string; description: string }> = {
  'tpp/registrations': {
    title: 'Third-party registrations',
    description: 'Which clients may reach the banking API, with the scopes and roles granted to each.',
  },
  consents: {
    title: 'Consents',
    description: 'Account access agreements and their status, including any awaiting manual authorisation.',
  },
  'tpp/deliveries': {
    title: 'Notification deliveries',
    description: 'One row per delivery ATTEMPT, so a retry that eventually succeeded reads differently from a first-time success.',
  },
  audit: {
    title: 'Audit trail',
    description: 'Every request the bank answered: who asked, of what, under which consent, and what it answered.',
  },
  'tpp/subscriptions': {
    title: 'Notification subscriptions',
    description: 'Where the bank delivers notifications, and how it signs them.',
  },
  'module/config': {
    title: 'Engine configuration',
    description: "The bank's own engines and the rules they read per call.",
  },
};

export default function BankcoreResourcePage() {
  const params = useParams<{ resource: string }>();
  const resource = decodeURIComponent(String(params?.resource ?? ''));
  const meta = TITLES[resource] ?? { title: resource, description: "One of the bank's administrative records." };

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    setLoading(true);
    fetch(`/api/v1/system/services/bankcore/admin/${resource}?limit=50`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          // The reason, not a generic failure: an unreachable bank and a refused request are different
          // problems, and an empty table would imply neither.
          throw new Error((body as { error?: string })?.error ?? `request failed with ${response.status}`);
        }
        return body as { results?: Record<string, unknown>[] } | Record<string, unknown>[];
      })
      .then((body) => {
        const results = Array.isArray(body) ? body : body?.results ?? [];
        setRows(results);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [resource]);

  // The columns are whatever the records carry. A fixed column set per resource would need editing every time
  // the bank adds a field, and would silently hide the new one until someone did.
  const columns = rows.length > 0
    ? Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 8)
    : [];

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Link href="/system/admin/modules/bankcore" className="inline-flex items-center gap-1 text-xs text-[#016BF8] hover:underline">
        <ArrowLeft size={14} /> Bankcore
      </Link>

      <SectionHeader icon={Landmark} title={meta.title} description={meta.description} />

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-800">The bank did not answer</p>
          <p className="text-xs text-red-700 mt-1">{error}</p>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-gray-500">The bank holds no records here yet.</p>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                {columns.map((column) => (
                  <th key={column} className="text-left font-semibold text-gray-600 px-3 py-2 whitespace-nowrap">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={String(row.id ?? index)} className="border-t border-gray-100">
                  {columns.map((column) => (
                    <td key={column} className="px-3 py-2 align-top text-gray-700 max-w-[22rem] truncate">
                      {typeof row[column] === 'object' && row[column] !== null
                        ? JSON.stringify(row[column])
                        : String(row[column] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
