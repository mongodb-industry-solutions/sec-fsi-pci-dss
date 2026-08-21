'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { SectionHeader } from '../../../components/SectionHeader';
import { Breadcrumb, type Crumb } from '../../../components/Breadcrumb';
import { EncryptedKycSearch } from '../../../components/EncryptedKycSearch';
import { Users } from 'lucide-react';
import { formatAmount } from '../../../lib/money';

type SearchField = 'email' | 'phone' | 'accountRef';

interface CustomerResult {
  customerAgreementInstanceReference?: string;
  customerName?: string;
  customerSegment?: string;
  customerAgreementStatus?: string;
  customerAgreementEnrollmentDate?: string;
}

interface Transaction {
  cardTransactionInstanceReference?: string;
  cardTransactionAmount?: { amount: number; currency: string };
  cardTransactionMerchantName?: string;
  cardTransactionDateTime?: string;
  cardTransactionStatus?: string;
  cardTransactionMaskedPanDisplay?: string;
  cardTransactionChannel?: string;
  paymentCardReference?: string;
}

const FIELD_LABELS: Record<SearchField, string> = {
  email:      'Email',
  phone:      'Phone',
  accountRef: 'Account Reference',
};

const FIELD_PLACEHOLDERS: Record<SearchField, string> = {
  email:      'customer@example.com',
  phone:      '+1-555-0000',
  accountRef: 'ACC-001',
};

const SEGMENT_LABELS: Record<string, string> = {
  retail: 'Retail', premium: 'Premium', corporate: 'Corporate', sme: 'SME',
};

export default function UsersPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [role, setRole] = useState('level1_analyst');
  const [fromTxn, setFromTxn] = useState<string | null>(null);
  // Opening/reopening a case is an analyst action (SoD); the auditor is read-only.
  const canOpenCase = role === 'level1_analyst' || role === 'level2_investigator';
  // Blind single-record lookup is the L1 triage surface (no browsing). L2/auditor use only the
  // advanced encrypted-attribute search below, which also carries the email/phone/accountRef keys,
  // so everything the simple lookup does is available there too (unified, simpler UI).
  const isL1 = role === 'level1_analyst';
  const isStaffSearch = role === 'level2_investigator' || role === 'security_auditor';

  useEffect(() => {
    const t = getToken() ?? '';
    const user = t ? decodeToken(t) : null;
    if (user?.role === 'customer') {
      router.replace('/system/payment/history');
      return;
    }
    setToken(t);
    setRole(user?.role ?? 'level1_analyst');
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('from') === 'transaction' && sp.get('txnId')) setFromTxn(sp.get('txnId'));
    }
  }, [router]);

  const [searchField, setSearchField] = useState<SearchField>('email');
  const [searchValue, setSearchValue] = useState('');
  const [customer, setCustomer] = useState<CustomerResult | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [casesMap, setCasesMap] = useState<Record<string, { id: string; ref: string; status: string } | null>>({});
  const [caseActionBusy, setCaseActionBusy] = useState<Record<string, boolean>>({});
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [cardToken, setCardToken] = useState('');
  const [txnLoading, setTxnLoading] = useState(false);

  function clearSearch() {
    setSearchValue('');
    setSearchError(null);
    setCustomer(null);
    setTransactions([]);
    setCasesMap({});
    setCardToken('');
  }

  async function handleSearch(valueOverride?: string, fieldOverride?: SearchField) {
    const field = fieldOverride ?? searchField;
    const value = (valueOverride ?? searchValue).trim();
    if (!value) return;
    setSearchLoading(true);
    setSearchError(null);
    setCustomer(null);
    setTransactions([]);
    setCardToken('');
    try {
      let result: Record<string, unknown>;
      if (field === 'email') result = await api.customer.getByEmail(value, token);
      else if (field === 'phone') result = await api.customer.getByPhone(value, token);
      else result = await api.customer.getByAccountRef(value, token);
      setCustomer(result as CustomerResult);
    } catch {
      setSearchError('No customer found for the given value. Verify the field and try again.');
    } finally {
      setSearchLoading(false);
    }
  }

  // Deep-linkable search: prefill from ?field=&q= once after mount and auto-run.
  const [autoApplied, setAutoApplied] = useState(false);
  useEffect(() => {
    if (autoApplied || !token || typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const field = sp.get('field') as SearchField | null;
    const q = sp.get('q');
    if (field && FIELD_LABELS[field]) setSearchField(field);
    if (q) {
      setSearchValue(q);
      handleSearch(q, field && FIELD_LABELS[field] ? field : undefined);
    }
    setAutoApplied(true);
  }, [token, autoApplied]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadTransactions() {
    if (!cardToken.trim()) return;
    setTxnLoading(true);
    setCasesMap({});
    try {
      const res = await api.transactions.getByCardToken(cardToken.trim(), token);
      const txns = (res.results ?? []) as Transaction[];
      setTransactions(txns);

      // For each transaction, look up the associated fraud case (max 1 per transaction)
      const caseEntries = await Promise.all(
        txns
          .filter(t => t.cardTransactionInstanceReference)
          .map(async t => {
            const id = t.cardTransactionInstanceReference!;
            const cases = await api.fraud.list({ transactionId: id, limit: 1 }, token).catch(() => null);
            const c = cases?.results?.[0];
            return [id, c ? { id: c.fraudDiagnosisInstanceReference, ref: c.fraudDiagnosisCaseReference, status: c.caseStatus } : null] as const;
          })
      );
      setCasesMap(Object.fromEntries(caseEntries));
    } catch {
      setTransactions([]);
    } finally {
      setTxnLoading(false);
    }
  }

  async function handleCaseAction(txnId: string, existingCase: { id: string; ref: string; status: string } | null | undefined) {
    setCaseActionBusy(prev => ({ ...prev, [txnId]: true }));
    try {
      if (!existingCase) {
        // No case: create a new one
        const res = await api.fraud.open({ transactionId: txnId, reason: 'Manually opened by analyst from customer lookup' }, token);
        const caseData = await api.fraud.getById(res.fraudDiagnosisInstanceReference, token);
        setCasesMap(prev => ({ ...prev, [txnId]: { id: res.fraudDiagnosisInstanceReference, ref: caseData.fraudDiagnosisCaseReference, status: caseData.caseStatus } }));
      } else if (['closed', 'resolved_cleared', 'resolved_fraud'].includes(existingCase.status)) {
        // Closed case: reopen it
        await api.fraud.update(existingCase.id, { fraudDiagnosisCaseStatus: 'open' }, token);
        setCasesMap(prev => ({ ...prev, [txnId]: { ...existingCase, status: 'open' } }));
      }
      // If case is open/active, just navigate (handled by Link below)
    } catch {
      // Silently handle errors
    } finally {
      setCaseActionBusy(prev => ({ ...prev, [txnId]: false }));
    }
  }

  const crumbs: Crumb[] = fromTxn
    ? [
        { label: 'Home', href: '/system' },
        { label: 'Transactions', href: '/system/transactions' },
        { label: 'Transaction', href: `/system/transactions/${fromTxn}` },
        { label: 'Customer' },
      ]
    : [
        { label: 'Home', href: '/system' },
        { label: 'Users' },
      ];

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={crumbs} />
      <SectionHeader
        icon={Users}
        title="Users"
        description={isL1
          ? 'Find a customer by encrypted email, phone or account reference.'
          : 'Find a customer by exact key (email, phone, account reference) or investigate over encrypted KYC attributes with Queryable Encryption.'}
        debugInfo="Customer Agreement / PCI DSS · MongoDB Queryable Encryption (no plaintext leaves the app)"
      />

      {/* Blind single-record lookup: L1 only. L2/auditor use the advanced search below. */}
      {isL1 && (<>
      <div className="bg-white rounded-xl border p-5 space-y-4">
        <h2 className="font-semibold">Search by encrypted field</h2>
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(FIELD_LABELS) as SearchField[]).map((f) => (
            <button
              key={f}
              onClick={() => { setSearchField(f); setSearchValue(''); setCustomer(null); setTransactions([]); setSearchError(null); }}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                searchField === f ? 'bg-[#001E2B] text-[#00ED64] border-[#001E2B]' : 'border-gray-300 text-gray-600 hover:border-gray-400'
              }`}
            >
              {FIELD_LABELS[f]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={FIELD_PLACEHOLDERS[searchField]}
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={() => handleSearch()}
            disabled={searchLoading || !searchValue.trim()}
            className="px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-semibold disabled:opacity-50"
          >
            {searchLoading ? 'Searching...' : 'Search'}
          </button>
          {(customer || searchError || searchValue) && (
            <button
              onClick={clearSearch}
              className="px-3 py-2 rounded-lg border text-sm text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        {searchError && <p className="text-sm text-red-600">{searchError}</p>}
      </div>

      {/* Customer profile result */}
      {customer && (
        <div className="bg-white rounded-xl border p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#001E2B]/10 flex items-center justify-center text-xl">👤</div>
            <div>
              <p className="font-semibold text-gray-900">{customer.customerName ?? 'Unknown'}</p>
              <div className="flex gap-2 mt-0.5">
                {customer.customerSegment && (
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                    {SEGMENT_LABELS[customer.customerSegment] ?? customer.customerSegment}
                  </span>
                )}
                {customer.customerAgreementStatus && (
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    customer.customerAgreementStatus === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {customer.customerAgreementStatus}
                  </span>
                )}
                {customer.customerAgreementEnrollmentDate && (
                  <span className="text-xs text-gray-400">
                    Since {new Date(customer.customerAgreementEnrollmentDate).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Search transactions by card token */}
          <div className="border-t pt-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Look up transactions</p>
            <p className="text-xs text-gray-500 mb-2">
              Ask the customer for their card token (or masked PAN) to retrieve their transaction history.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={cardToken}
                onChange={(e) => setCardToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadTransactions()}
                placeholder="Card token (pm_xxx)  or  masked PAN (****-****-****-1234)"
                className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono"
              />
              <button
                onClick={loadTransactions}
                disabled={txnLoading || !cardToken.trim()}
                className="px-3 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] text-sm font-medium disabled:opacity-50 hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors"
              >
                {txnLoading ? '...' : 'Load'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transactions */}
      {transactions.length > 0 && (
        <div className="bg-white rounded-xl border divide-y">
          <div className="px-5 py-3 flex items-center justify-between">
            <h2 className="font-semibold">Transactions ({transactions.length})</h2>
            <span className="text-xs text-gray-400">One investigation case per transaction</span>
          </div>
          {transactions.map((txn, i) => {
            const txnId = txn.cardTransactionInstanceReference ?? '';
            const linkedCase = txnId ? casesMap[txnId] : undefined;
            const busy = txnId ? !!caseActionBusy[txnId] : false;
            const isClosed = linkedCase?.status === 'closed' || linkedCase?.status === 'resolved_cleared' || linkedCase?.status === 'resolved_fraud';

            return (
              <div key={txnId || i} className="px-5 py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{txn.cardTransactionMerchantName ?? 'Unknown'}</p>
                  <p className="text-xs text-gray-500">
                    {txn.cardTransactionDateTime ? new Date(txn.cardTransactionDateTime).toLocaleString() : ''}
                    {txn.cardTransactionMaskedPanDisplay ? ` · ${txn.cardTransactionMaskedPanDisplay}` : ''}
                    {txn.cardTransactionChannel ? ` · ${txn.cardTransactionChannel}` : ''}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  {txn.cardTransactionAmount && (
                    <p className="font-semibold text-sm">
                      {formatAmount(txn.cardTransactionAmount.amount, txn.cardTransactionAmount.currency)}
                    </p>
                  )}
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    txn.cardTransactionStatus === 'disputed'   ? 'bg-red-100 text-red-700' :
                    txn.cardTransactionStatus === 'authorized' || txn.cardTransactionStatus === 'settled' ? 'bg-green-100 text-green-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>{txn.cardTransactionStatus}</span>
                </div>

                {/* Case action  -  context-aware */}
                <div className="shrink-0 text-right space-y-1">
                  {linkedCase === undefined ? (
                    // Still loading case info
                    <span className="text-xs text-gray-300">...</span>
                  ) : linkedCase && !isClosed ? (
                    // Active case: direct link (read-only navigation, all roles)
                    <Link
                      href={`/system/investigation/${linkedCase.id}`}
                      className="text-xs px-2 py-1 rounded bg-[#001E2B] text-[#00ED64] hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors font-medium"
                    >
                      Open case
                    </Link>
                  ) : canOpenCase && linkedCase && isClosed ? (
                    // Closed case: reopen (analyst only)
                    <button
                      disabled={busy}
                      onClick={() => handleCaseAction(txnId, linkedCase)}
                      className="text-xs px-2 py-1 rounded border border-amber-600 text-amber-700 hover:bg-amber-50 disabled:opacity-50 transition-colors"
                    >
                      {busy ? '...' : 'Reopen case'}
                    </button>
                  ) : canOpenCase ? (
                    // No case: open new investigation (analyst only)
                    <button
                      disabled={busy}
                      onClick={() => handleCaseAction(txnId, null)}
                      className="text-xs px-2 py-1 rounded border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] disabled:opacity-50 transition-colors"
                    >
                      {busy ? '...' : 'Open investigation'}
                    </button>
                  ) : linkedCase && isClosed ? (
                    // Auditor read-only on a closed case
                    <Link href={`/system/investigation/${linkedCase.id}`} className="text-xs text-blue-600 hover:underline">View case</Link>
                  ) : (
                    <span className="text-xs text-gray-400 italic">Read-only</span>
                  )}
                  {linkedCase && (
                    <p className={`text-xs ${isClosed ? 'text-gray-400' : 'text-orange-600'}`}>
                      {linkedCase.ref} · {linkedCase.status.replace(/_/g, ' ')}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {transactions.length === 0 && customer && cardToken && !txnLoading && (
        <div className="bg-white rounded-xl border p-5 text-center text-sm text-gray-500">
          No transactions found for this card token.
        </div>
      )}
      </>
      )}

      {/* v27: encrypted-attribute search (Queryable Encryption). For L2/auditor this is THE search
          surface: it carries the exact keys (email/phone/account reference) plus the KYC attributes,
          so everything the L1 blind lookup does is available here too. Discovery capability that
          returns a list, gated to L2 investigator / auditor (least-privilege, PCI DSS). Server
          enforces the gate. */}
      {isStaffSearch && (
        <div className="space-y-4">
          <EncryptedKycSearch
            token={token}
            role={role}
            resultHref={(r) => `/system/users/${r.customerAgreementInstanceReference}`}
          />
        </div>
      )}
    </div>
  );
}
