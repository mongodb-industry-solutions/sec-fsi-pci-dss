'use client';
import { useCallback, useEffect, useState } from 'react';
import { Copy, Check, Key, ShieldCheck, Trash2, Search, Plus, Pencil, X, Download } from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { Pagination } from '../../../../components/Pagination';
import { useRequireActiveMerchant } from '../../../../lib/merchantContext';
import { api } from '../../../../lib/api';

type KeyMeta = {
  keyId: string;
  keyPrefix: string;
  keyLabel: string | null;
  keyStatus: 'active' | 'revoked';
  keyOrigin?: 'generated' | 'imported';
  keyCreatedDateTime: string;
  keyLastUsedDateTime: string | null;
};

export default function ApiKeysSectionPage() {
  const { token, merchant } = useRequireActiveMerchant();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';

  const [keys, setKeys] = useState<KeyMeta[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [label, setLabel] = useState('');
  const [result, setResult] = useState<{ merchantApiKey: string; keyId: string; keyPrefix: string; keyLabel?: string | null } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  // Import an existing key (from the merchant's own system)
  const [importValue, setImportValue] = useState('');
  const [importLabel, setImportLabel] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Inline label editing
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [savingLabel, setSavingLabel] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'revoked'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadKeys = useCallback(async () => {
    if (!merchantId) return;
    setLoadingKeys(true);
    try { setKeys((await api.merchants.listKeys(merchantId, token)).keys); }
    catch { setKeys([]); }
    setLoadingKeys(false);
  }, [merchantId, token]);

  useEffect(() => { if (merchantId) loadKeys(); }, [merchantId, loadKeys]);

  if (!merchant) return null;

  async function generate() {
    setGenerating(true); setResult(null);
    try {
      setResult(await api.merchants.generateKey(merchantId, token, label.trim() || undefined));
      setLabel('');
      loadKeys();
    } catch {}
    setGenerating(false);
  }

  async function revoke(keyId: string) {
    try { await api.merchants.revokeKey(merchantId, keyId, token); loadKeys(); } catch {}
  }

  async function importExisting() {
    if (!importValue.trim()) return;
    setImporting(true); setImportMsg(null);
    try {
      const r = await api.merchants.importKey(merchantId, importValue.trim(), token, importLabel.trim() || undefined);
      setImportMsg({ ok: true, text: `Imported key ${r.keyPrefix}… (${r.keyLabel ?? 'unlabeled'}).` });
      setImportValue(''); setImportLabel('');
      loadKeys();
    } catch (e) {
      setImportMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed to import key.' });
    }
    setImporting(false);
  }

  function startEdit(k: KeyMeta) { setEditingKeyId(k.keyId); setEditLabel(k.keyLabel ?? ''); }
  function cancelEdit() { setEditingKeyId(null); setEditLabel(''); }
  async function saveLabel(keyId: string) {
    setSavingLabel(true);
    try { await api.merchants.updateKeyLabel(merchantId, keyId, editLabel.trim(), token); setEditingKeyId(null); loadKeys(); }
    catch {}
    setSavingLabel(false);
  }

  const activeCount = keys.filter((k) => k.keyStatus === 'active').length;
  const q = search.trim().toLowerCase();
  const filtered = keys.filter((k) => {
    if (statusFilter !== 'all' && k.keyStatus !== statusFilter) return false;
    if (q && !((k.keyLabel ?? '').toLowerCase().includes(q) || k.keyPrefix.toLowerCase().includes(q))) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <SectionHeader
        icon={Key}
        title="API Keys"
        description="Server-to-server credentials for the gateway API."
        debugInfo="BIAN SD-89 credential management · PCI DSS Req 3 (hash only) · Req 8 (unique, revocable credentials)"
      />

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 flex items-start gap-2">
        <ShieldCheck size={14} className="text-amber-600 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-700">
          The full key is shown <strong>once</strong> at creation; only a bcrypt hash is stored, so it cannot be retrieved later. Below you can see which keys exist (label, prefix, date), and revoke any of them.
        </p>
      </div>

      {/* Generate */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800 text-sm">Generate a new key</h2>
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">Label (optional, to identify this key)</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Production server, Staging, CI pipeline"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            />
          </div>
          <button onClick={generate} disabled={generating}
            className="flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 text-sm">
            <Key size={15} />{generating ? 'Generating...' : 'Generate'}
          </button>
        </div>

        {result && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
            <div className="text-sm font-medium text-green-800">
              New key{result.keyLabel ? ` “${result.keyLabel}”` : ''} created. Copy it now:
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 font-mono text-xs text-green-700 bg-white border border-green-200 rounded px-2 py-1.5 truncate">{result.merchantApiKey}</div>
              <button onClick={() => { navigator.clipboard.writeText(result.merchantApiKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="shrink-0 p-1.5 rounded hover:bg-green-100">
                {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} className="text-green-600" />}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Import an existing key (from the merchant's own system) */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5"><Download size={14} /> Add an existing key</h2>
        <p className="text-xs text-gray-500">
          Register a key your own system already issued. It is hashed on the server (bcrypt) and never
          stored in plaintext — only its prefix is shown afterwards. Marked as <span className="font-medium">imported</span>.
        </p>
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">API key</label>
            <input
              value={importValue}
              onChange={(e) => setImportValue(e.target.value)}
              placeholder="Paste the full API key from your system"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            />
          </div>
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-gray-500 mb-1">Label (optional)</label>
              <input
                value={importLabel}
                onChange={(e) => setImportLabel(e.target.value)}
                placeholder="e.g. Merchant ERP key, Legacy gateway"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
              />
            </div>
            <button onClick={importExisting} disabled={importing || !importValue.trim()}
              className="flex items-center gap-2 border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 text-sm">
              <Plus size={15} />{importing ? 'Importing...' : 'Import key'}
            </button>
          </div>
        </div>
        {importMsg && (
          <p className={`text-xs ${importMsg.ok ? 'text-green-700' : 'text-red-600'}`}>{importMsg.text}</p>
        )}
      </div>

      {/* Existing keys */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="font-medium text-gray-800 text-sm">
            Keys <span className="text-gray-400 font-normal">({activeCount} active of {keys.length})</span>
          </h3>
          <button onClick={loadKeys} className="text-xs text-[#001E2B] font-medium hover:underline">Refresh</button>
        </div>

        {/* Filter + search */}
        <div className="flex flex-wrap gap-2 items-center px-5 py-3 border-b border-gray-100 bg-gray-50/60">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by label or prefix…"
              className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as 'all' | 'active' | 'revoked'); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
          </select>
        </div>

        {loadingKeys ? (
          <div className="px-5 py-6 text-center text-sm text-gray-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-gray-400">{keys.length === 0 ? 'No API keys yet.' : 'No keys match the current filters.'}</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {paginated.map((k) => (
              <li key={k.keyId} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  {editingKeyId === k.keyId ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        autoFocus
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveLabel(k.keyId); if (e.key === 'Escape') cancelEdit(); }}
                        maxLength={80}
                        placeholder="Label (empty to clear)"
                        className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                      />
                      <button onClick={() => saveLabel(k.keyId)} disabled={savingLabel}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-[#001E2B] text-[#00ED64] disabled:opacity-50">
                        <Check size={13} /> {savingLabel ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={cancelEdit} disabled={savingLabel}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border text-gray-600 hover:bg-gray-50">
                        <X size={13} /> Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-800 text-sm">{k.keyLabel || 'Unlabeled key'}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${k.keyStatus === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{k.keyStatus}</span>
                      {k.keyOrigin === 'imported' && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700 border border-blue-200">imported</span>
                      )}
                    </div>
                  )}
                  <div className="text-xs text-gray-400 mt-0.5 font-mono">
                    {k.keyPrefix}… · created {new Date(k.keyCreatedDateTime).toLocaleDateString()}
                    {k.keyLastUsedDateTime ? ` · last used ${new Date(k.keyLastUsedDateTime).toLocaleDateString()}` : ''}
                  </div>
                </div>
                {editingKeyId !== k.keyId && (
                  <div className="shrink-0 flex items-center gap-1.5">
                    <button onClick={() => startEdit(k)} title="Rename / relabel"
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                      <Pencil size={13} /> Rename
                    </button>
                    {k.keyStatus === 'active' && (
                      <button onClick={() => revoke(k.keyId)} title="Revoke key"
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                        <Trash2 size={13} /> Revoke
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {!loadingKeys && filtered.length > 0 && (
          <div className="px-3 py-2 border-t border-gray-100">
            <Pagination
              page={safePage}
              totalPages={totalPages}
              total={filtered.length}
              limit={pageSize}
              onPageChange={setPage}
              onLimitChange={(l) => { setPageSize(l); setPage(1); }}
              limitOptions={[10, 20, 50]}
              noun="keys"
            />
          </div>
        )}
      </div>
    </div>
  );
}
