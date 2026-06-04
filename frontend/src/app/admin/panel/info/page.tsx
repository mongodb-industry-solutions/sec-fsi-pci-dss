'use client';
import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../../../lib/constants';
import { getAdminToken } from '../../../../lib/adminHelpers';

interface SystemInfo {
  os: Record<string, unknown>;
  node: Record<string, unknown>;
  package: Record<string, unknown>;
  env: Record<string, string>;
}

export default function InfoPage() {
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [sysLoading, setSysLoading] = useState(false);
  const [sysError, setSysError] = useState<string | null>(null);
  const [envFilter, setEnvFilter] = useState('');

  async function fetchSysInfo() {
    const token = getAdminToken();
    if (!token) return;
    setSysLoading(true);
    setSysError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/system`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? res.statusText);
      setSysInfo(await res.json() as SystemInfo);
    } catch (err) {
      setSysError((err as Error).message);
    } finally {
      setSysLoading(false);
    }
  }

  useEffect(() => {
    fetchSysInfo();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={fetchSysInfo}
          disabled={sysLoading}
          className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded disabled:opacity-40 transition-colors"
        >
          {sysLoading ? 'Refreshing...' : 'Refresh'}
        </button>
        {sysError && <span className="text-xs text-red-400">{sysError}</span>}
      </div>

      {sysLoading && !sysInfo && (
        <div className="text-gray-500 text-sm">Loading system info...</div>
      )}

      {sysInfo && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InfoCard title="Operating System" icon="💻">
            {Object.entries(sysInfo.os).map(([k, v]) => (
              <InfoRow key={k} label={k} value={String(v)} />
            ))}
          </InfoCard>

          <InfoCard title="Node.js Runtime" icon="🟢">
            {Object.entries(sysInfo.node).map(([k, v]) => (
              <InfoRow key={k} label={k} value={String(v)} />
            ))}
          </InfoCard>

          <InfoCard title="package.json" icon="📦">
            {Object.entries(sysInfo.package).map(([k, v]) =>
              k === 'scripts' ? (
                <div key={k} className="col-span-2 mt-2">
                  <p className="text-gray-500 text-xs font-semibold uppercase mb-1">scripts</p>
                  {Object.entries(v as Record<string, string>).map(([sk, sv]) => (
                    <div key={sk} className="flex gap-2 text-xs py-0.5 border-b border-gray-800">
                      <code className="text-orange-400 min-w-[120px]">{sk}</code>
                      <code className="text-gray-400 truncate">{sv}</code>
                    </div>
                  ))}
                </div>
              ) : (
                <InfoRow key={k} label={k} value={
                  Array.isArray(v) ? (v as string[]).join(', ') : String(v)
                } />
              )
            )}
          </InfoCard>

          <InfoCard title="Environment Variables" icon="⚙️">
            <div className="col-span-2 mb-2">
              <input
                type="text"
                value={envFilter}
                onChange={(e) => setEnvFilter(e.target.value)}
                placeholder="Filter..."
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none"
              />
            </div>
            {Object.entries(sysInfo.env)
              .filter(([k]) => !envFilter || k.toLowerCase().includes(envFilter.toLowerCase()))
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => (
                <InfoRow key={k} label={k} value={v} mono />
              ))}
          </InfoCard>
        </div>
      )}
    </div>
  );
}

function InfoCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <span>{icon}</span> {title}
      </p>
      <div className="space-y-0.5 max-h-64 overflow-y-auto pr-1">{children}</div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2 text-xs py-0.5 border-b border-gray-800/60">
      <span className="text-gray-500 min-w-[140px] flex-shrink-0">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} text-gray-300 break-all`}>{value}</span>
    </div>
  );
}
