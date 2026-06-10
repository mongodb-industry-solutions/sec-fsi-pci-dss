'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../lib/api';
import { getToken } from '../../../lib/auth';
import { Link2, ShoppingCart, Key, Webhook, Copy, Check, Plus, Trash2, ExternalLink } from 'lucide-react';

type Tab = 'checkout' | 'links' | 'keys' | 'webhook';

interface Merchant {
  merchantAgreementInstanceReference: string;
  merchantName: string;
  merchantCategoryCode: string;
  merchantAgreementStatus: string;
  merchantWebhookEndpoint?: string;
}

interface PaymentLink {
  paymentLinkInstanceReference: string;
  paymentLinkCode: string;
  paymentLinkAmount: number;
  paymentLinkCurrency: string;
  paymentLinkDescription: string;
  paymentLinkStatus: string;
  paymentLinkUsageType: string;
  paymentLinkCurrentUses: number;
  paymentLinkCreatedDateTime: string;
}

export default function MerchantPage() {
  const [tab, setTab] = useState<Tab>('checkout');
  const [token, setToken] = useState('');
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [selectedMerchantId, setSelectedMerchantId] = useState('');
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);

  // Create checkout session form
  const [csAmount, setCsAmount] = useState('99.00');
  const [csCurrency, setCsCurrency] = useState('USD');
  const [csDescription, setCsDescription] = useState('Demo Order #1234');
  const [csReturnUrl, setCsReturnUrl] = useState('https://example.com/success');
  const [csCancelUrl, setCsCancelUrl] = useState('https://example.com/cancel');
  const [csRef, setCsRef] = useState('ORDER-001');
  const [csResult, setCsResult] = useState<{ paymentPageUrl: string; expiresAt: string } | null>(null);
  const [csLoading, setCsLoading] = useState(false);
  const [csError, setCsError] = useState('');

  // Create payment link form
  const [plAmount, setPlAmount] = useState('49.99');
  const [plCurrency, setPlCurrency] = useState('USD');
  const [plDescription, setPlDescription] = useState('Consulting Session');
  const [plMessage, setPlMessage] = useState('');
  const [plUsageType, setPlUsageType] = useState<'single_use' | 'multi_use'>('single_use');
  const [plResult, setPlResult] = useState<{ paymentUrl: string; paymentLinkCode: string } | null>(null);
  const [plLoading, setPlLoading] = useState(false);
  const [plError, setPlError] = useState('');

  // API key management
  const [apiKeyResult, setApiKeyResult] = useState<{ merchantApiKey: string; keyId: string; keyPrefix: string } | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);

  // Webhook
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookSaved, setWebhookSaved] = useState(false);

  const [copied, setCopied] = useState<string | null>(null);

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
  }, []);

  useEffect(() => {
    if (!token) return;
    api.merchants.list({}, token).then((res) => {
      const list = res.results as unknown as Merchant[];
      setMerchants(list);
      if (list.length > 0 && !selectedMerchantId) {
        setSelectedMerchantId(list[0].merchantAgreementInstanceReference);
        setWebhookUrl(list[0].merchantWebhookEndpoint ?? '');
      }
    }).catch(() => {});
  }, [token]);

  const loadLinks = useCallback(async () => {
    if (!token || !selectedMerchantId) return;
    setLoadingLinks(true);
    try {
      const res = await api.paymentLinks.list(selectedMerchantId, token);
      setLinks(res.results as unknown as PaymentLink[]);
    } catch {}
    setLoadingLinks(false);
  }, [token, selectedMerchantId]);

  useEffect(() => {
    if (tab === 'links') loadLinks();
  }, [tab, loadLinks]);

  useEffect(() => {
    if (!selectedMerchantId) return;
    const m = merchants.find((m) => m.merchantAgreementInstanceReference === selectedMerchantId);
    if (m) setWebhookUrl(m.merchantWebhookEndpoint ?? '');
  }, [selectedMerchantId, merchants]);

  async function handleCreateSession(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMerchantId) return;
    setCsLoading(true);
    setCsError('');
    setCsResult(null);
    try {
      const result = await api.checkout.createSession({
        merchantAgreementInstanceReference: selectedMerchantId,
        amount: parseFloat(csAmount),
        currency: csCurrency,
        description: csDescription,
        returnUrl: csReturnUrl,
        cancelUrl: csCancelUrl,
        merchantReference: csRef,
      }, token);
      setCsResult(result);
    } catch (err) {
      setCsError(err instanceof Error ? err.message : 'Failed to create session.');
    }
    setCsLoading(false);
  }

  async function handleCreateLink(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMerchantId) return;
    setPlLoading(true);
    setPlError('');
    setPlResult(null);
    try {
      const result = await api.paymentLinks.create({
        merchantAgreementInstanceReference: selectedMerchantId,
        amount: parseFloat(plAmount),
        currency: plCurrency,
        description: plDescription,
        customerMessage: plMessage || undefined,
        usageType: plUsageType,
      }, token);
      setPlResult(result);
      if (tab === 'links') loadLinks();
    } catch (err) {
      setPlError(err instanceof Error ? err.message : 'Failed to create link.');
    }
    setPlLoading(false);
  }

  async function handleGenerateKey() {
    if (!selectedMerchantId) return;
    setKeyLoading(true);
    setApiKeyResult(null);
    try {
      const result = await api.merchants.generateKey(selectedMerchantId, token);
      setApiKeyResult(result);
    } catch {}
    setKeyLoading(false);
  }

  async function handleSaveWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMerchantId || !webhookUrl) return;
    setWebhookSaving(true);
    try {
      await api.merchants.registerWebhook(selectedMerchantId, webhookUrl, token);
      setWebhookSaved(true);
      setTimeout(() => setWebhookSaved(false), 3000);
    } catch {}
    setWebhookSaving(false);
  }

  async function handleDeactivateLink(id: string) {
    if (!selectedMerchantId) return;
    try {
      await api.paymentLinks.deactivate(id, selectedMerchantId, token);
      loadLinks();
    } catch {}
  }

  const selectedMerchant = merchants.find((m) => m.merchantAgreementInstanceReference === selectedMerchantId);

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'checkout', label: 'Checkout Session', icon: <ShoppingCart size={15} /> },
    { key: 'links', label: 'Payment Links', icon: <Link2 size={15} /> },
    { key: 'keys', label: 'API Keys', icon: <Key size={15} /> },
    { key: 'webhook', label: 'Webhook', icon: <Webhook size={15} /> },
  ];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Merchant Sandbox</h1>
        <p className="text-sm text-gray-500 mt-0.5">Test Redirect Checkout and Payment Links integration.</p>
      </div>

      {/* Merchant selector */}
      {merchants.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="block text-xs text-gray-500 mb-1.5">Active Merchant</label>
          <select
            value={selectedMerchantId}
            onChange={(e) => { setSelectedMerchantId(e.target.value); setCsResult(null); setPlResult(null); setApiKeyResult(null); }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
          >
            {merchants.map((m) => (
              <option key={m.merchantAgreementInstanceReference} value={m.merchantAgreementInstanceReference}>
                {m.merchantName} ({m.merchantAgreementStatus})
              </option>
            ))}
          </select>
          {selectedMerchant && (
            <div className="mt-2 text-xs text-gray-400 font-mono truncate">
              ID: {selectedMerchant.merchantAgreementInstanceReference}
            </div>
          )}
        </div>
      )}

      {merchants.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          No merchants found. Run the seed script or create a merchant via POST /api/v1/merchants.
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab: Checkout Session */}
      {tab === 'checkout' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-800">Create Checkout Session</h2>
            <p className="text-xs text-gray-500 mt-0.5">Merchant redirects buyer to the hosted payment page. SAQ A compliance.</p>
          </div>

          <form onSubmit={handleCreateSession} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Amount</label>
                <input
                  required type="number" step="0.01" min="0.01"
                  value={csAmount} onChange={(e) => setCsAmount(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Currency</label>
                <select
                  value={csCurrency} onChange={(e) => setCsCurrency(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                >
                  {['USD', 'EUR', 'GBP', 'BRL', 'COP'].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Description</label>
              <input
                required type="text" value={csDescription} onChange={(e) => setCsDescription(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Merchant Reference (order ID)</label>
              <input
                required type="text" value={csRef} onChange={(e) => setCsRef(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Return URL</label>
                <input
                  required type="url" value={csReturnUrl} onChange={(e) => setCsReturnUrl(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Cancel URL</label>
                <input
                  required type="url" value={csCancelUrl} onChange={(e) => setCsCancelUrl(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                />
              </div>
            </div>
            {csError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{csError}</div>}
            <button
              type="submit" disabled={csLoading || !selectedMerchantId}
              className="w-full bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-60 text-sm"
            >
              {csLoading ? 'Creating...' : 'Create Session'}
            </button>
          </form>

          {csResult && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
              <div className="text-sm font-medium text-green-800">Session created. Redirect buyer to:</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 font-mono text-xs text-green-700 bg-white border border-green-200 rounded px-2 py-1.5 truncate">
                  {csResult.paymentPageUrl}
                </div>
                <button onClick={() => copyToClipboard(csResult.paymentPageUrl, 'csUrl')}
                  className="shrink-0 p-1.5 rounded hover:bg-green-100">
                  {copied === 'csUrl' ? <Check size={14} className="text-green-600" /> : <Copy size={14} className="text-green-600" />}
                </button>
                <a href={csResult.paymentPageUrl} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 p-1.5 rounded hover:bg-green-100">
                  <ExternalLink size={14} className="text-green-600" />
                </a>
              </div>
              <div className="text-xs text-green-600">
                Expires: {new Date(csResult.expiresAt).toLocaleString()} (30 min)
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Payment Links */}
      {tab === 'links' && (
        <div className="space-y-4">
          {/* Create link form */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-gray-800">Create Payment Link</h2>
              <p className="text-xs text-gray-500 mt-0.5">Shareable URL for email, QR codes, or social media.</p>
            </div>

            <form onSubmit={handleCreateLink} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Amount</label>
                  <input
                    required type="number" step="0.01" min="0.01"
                    value={plAmount} onChange={(e) => setPlAmount(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Currency</label>
                  <select
                    value={plCurrency} onChange={(e) => setPlCurrency(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                  >
                    {['USD', 'EUR', 'GBP', 'BRL', 'COP'].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Description</label>
                <input
                  required type="text" value={plDescription} onChange={(e) => setPlDescription(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Customer Message (optional)</label>
                <input
                  type="text" value={plMessage} onChange={(e) => setPlMessage(e.target.value)}
                  placeholder="Message shown to buyer"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Usage Type</label>
                <select
                  value={plUsageType} onChange={(e) => setPlUsageType(e.target.value as 'single_use' | 'multi_use')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                >
                  <option value="single_use">Single Use (invoice / one-time)</option>
                  <option value="multi_use">Multi Use (store / recurring)</option>
                </select>
              </div>
              {plError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{plError}</div>}
              <button
                type="submit" disabled={plLoading || !selectedMerchantId}
                className="w-full bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-60 text-sm"
              >
                {plLoading ? 'Creating...' : 'Create Payment Link'}
              </button>
            </form>

            {plResult && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
                <div className="text-sm font-medium text-green-800">Payment link created. Share this URL:</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 font-mono text-xs text-green-700 bg-white border border-green-200 rounded px-2 py-1.5 truncate">
                    {plResult.paymentUrl}
                  </div>
                  <button onClick={() => copyToClipboard(plResult.paymentUrl, 'plUrl')}
                    className="shrink-0 p-1.5 rounded hover:bg-green-100">
                    {copied === 'plUrl' ? <Check size={14} className="text-green-600" /> : <Copy size={14} className="text-green-600" />}
                  </button>
                  <a href={plResult.paymentUrl} target="_blank" rel="noopener noreferrer"
                    className="shrink-0 p-1.5 rounded hover:bg-green-100">
                    <ExternalLink size={14} className="text-green-600" />
                  </a>
                </div>
                <div className="text-xs text-green-600 font-mono">Code: {plResult.paymentLinkCode}</div>
              </div>
            )}
          </div>

          {/* Active links list */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="font-medium text-gray-800 text-sm">Active Links</h3>
              <button onClick={loadLinks} className="text-xs text-[#00ED64] hover:underline">Refresh</button>
            </div>
            {loadingLinks ? (
              <div className="px-5 py-6 text-center text-sm text-gray-400">Loading...</div>
            ) : links.length === 0 ? (
              <div className="px-5 py-6 text-center text-sm text-gray-400">No payment links yet.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {links.map((link) => (
                  <li key={link.paymentLinkInstanceReference} className="px-5 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-600">{link.paymentLinkCode}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          link.paymentLinkStatus === 'active' ? 'bg-green-100 text-green-700' :
                          link.paymentLinkStatus === 'completed' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {link.paymentLinkStatus}
                        </span>
                        <span className="text-xs text-gray-400">{link.paymentLinkUsageType}</span>
                      </div>
                      <div className="text-sm text-gray-700 mt-0.5 truncate">{link.paymentLinkDescription}</div>
                      <div className="text-xs text-gray-400">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: link.paymentLinkCurrency }).format(link.paymentLinkAmount)}
                        {' · '}{link.paymentLinkCurrentUses} use{link.paymentLinkCurrentUses !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <a
                        href={`/gateway/pay/${link.paymentLinkCode}`} target="_blank" rel="noopener noreferrer"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                      >
                        <ExternalLink size={13} />
                      </a>
                      {link.paymentLinkStatus === 'active' && (
                        <button
                          onClick={() => handleDeactivateLink(link.paymentLinkInstanceReference)}
                          className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Tab: API Keys */}
      {tab === 'keys' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-800">API Key Management</h2>
            <p className="text-xs text-gray-500 mt-0.5">Generate API keys for programmatic merchant access. Keys are shown once and stored as bcrypt hashes.</p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
            PCI DSS: API keys are never stored in plaintext. Only bcrypt hashes are persisted. Save each key immediately after generation.
          </div>

          <button
            onClick={handleGenerateKey}
            disabled={keyLoading || !selectedMerchantId}
            className="flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 text-sm"
          >
            <Plus size={15} />
            {keyLoading ? 'Generating...' : 'Generate New API Key'}
          </button>

          {apiKeyResult && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
              <div className="text-sm font-medium text-green-800">New API Key Generated. Save it now - it will NOT be shown again.</div>
              <div>
                <div className="text-xs text-gray-500 mb-1">API Key (full, shown once)</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 font-mono text-xs text-green-800 bg-white border border-green-200 rounded px-3 py-2 break-all select-all">
                    {apiKeyResult.merchantApiKey}
                  </div>
                  <button onClick={() => copyToClipboard(apiKeyResult.merchantApiKey, 'apiKey')}
                    className="shrink-0 p-2 rounded hover:bg-green-100">
                    {copied === 'apiKey' ? <Check size={14} className="text-green-600" /> : <Copy size={14} className="text-green-600" />}
                  </button>
                </div>
              </div>
              <div className="text-xs text-gray-500">
                Key ID: <span className="font-mono">{apiKeyResult.keyId}</span>
                {' · '}
                Prefix: <span className="font-mono">{apiKeyResult.keyPrefix}</span>
              </div>
              <div className="text-xs text-gray-500">
                Use as: <code className="bg-white border border-gray-200 rounded px-1">X-Merchant-Api-Key: {apiKeyResult.merchantApiKey}</code>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Webhook */}
      {tab === 'webhook' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-800">Webhook Configuration</h2>
            <p className="text-xs text-gray-500 mt-0.5">Configure an HTTPS endpoint to receive payment event notifications.</p>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs space-y-1 text-gray-600">
            <div className="font-medium text-gray-700 mb-2">Events delivered:</div>
            <div><code className="bg-white border border-gray-200 rounded px-1">checkout.completed</code> - Buyer completed checkout session</div>
            <div><code className="bg-white border border-gray-200 rounded px-1">payment_link.completed</code> - Buyer paid via payment link</div>
            <div className="mt-2 text-gray-500">Delivery: up to 3 attempts with exponential backoff. Signed with <code>X-Webhook-Signature: sha256=...</code></div>
          </div>

          <form onSubmit={handleSaveWebhook} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Webhook Endpoint URL</label>
              <input
                required type="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://your-server.com/webhooks/payments"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
              />
            </div>
            <button
              type="submit" disabled={webhookSaving || !selectedMerchantId}
              className={`w-full font-medium py-2 rounded-lg transition-colors disabled:opacity-60 text-sm ${
                webhookSaved ? 'bg-green-500 text-white' : 'bg-[#001E2B] hover:bg-[#001E2B]/80 text-white'
              }`}
            >
              {webhookSaving ? 'Saving...' : webhookSaved ? 'Saved!' : 'Save Webhook URL'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
