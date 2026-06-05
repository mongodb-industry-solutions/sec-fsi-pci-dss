'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';

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
  email:      'Email (QE:equality)',
  phone:      'Phone (QE:equality)',
  accountRef: 'Account Reference (QE:equality)',
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

  useEffect(() => {
    const t = getToken() ?? '';
    const user = t ? decodeToken(t) : null;
    if (user?.role === 'customer') {
      router.replace('/demo/payment/history');
      return;
    }
    setToken(t);
  }, [router]);

  const [searchField, setSearchField] = useState<SearchField>('email');
  const [searchValue, setSearchValue] = useState('');
  const [customer, setCustomer] = useState<CustomerResult | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [cardToken, setCardToken] = useState('');
  const [txnLoading, setTxnLoading] = useState(false);

  async function handleSearch() {
    if (!searchValue.trim()) return;
    setSearchLoading(true);
    setSearchError(null);
    setCustomer(null);
    setTransactions([]);
    setCardToken('');
    try {
      let result: Record<string, unknown>;
      if (searchField === 'email') result = await api.customer.getByEmail(searchValue.trim(), token);
      else if (searchField === 'phone') result = await api.customer.getByPhone(searchValue.trim(), token);
      else result = await api.customer.getByAccountRef(searchValue.trim(), token);
      setCustomer(result as CustomerResult);
    } catch {
      setSearchError('No customer found for the given value. Verify the field and try again.');
    } finally {
      setSearchLoading(false);
    }
  }

  async function loadTransactions() {
    if (!cardToken.trim()) return;
    setTxnLoading(true);
    try {
      const res = await api.transactions.getByCardToken(cardToken.trim(), token);
      setTransactions((res.results ?? []) as Transaction[]);
    } catch {
      setTransactions([]);
    } finally {
      setTxnLoading(false);
    }
  }

  async function openNewCase(txnId: string) {
    // Navigate to create-case flow via investigation, pre-selecting the transaction
    // For now: navigate to the investigation dashboard filtered to relevant cases
    window.location.href = `/demo/investigation`;
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5">
      <h1 className="text-2xl font-bold">Customer Lookup</h1>
      <p className="text-sm text-gray-500">
        When a customer contacts support, search by their email, phone, or account reference
        to identify them via Queryable Encryption. You can then view their transactions and open an investigation case.
      </p>

      {/* QE search */}
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
            onClick={handleSearch}
            disabled={searchLoading || !searchValue.trim()}
            className="px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-semibold disabled:opacity-50"
          >
            {searchLoading ? 'Searching...' : 'Search'}
          </button>
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
                placeholder="tok_xxxxxxxx  or  ****-****-****-1234"
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
            <span className="text-xs text-gray-500">Click to view case or open new investigation</span>
          </div>
          {transactions.map((txn, i) => (
            <div key={txn.cardTransactionInstanceReference ?? i} className="px-5 py-3 flex items-center gap-4">
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
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: txn.cardTransactionAmount.currency }).format(txn.cardTransactionAmount.amount)}
                  </p>
                )}
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  txn.cardTransactionStatus === 'disputed' ? 'bg-red-100 text-red-700' :
                  txn.cardTransactionStatus === 'authorized' || txn.cardTransactionStatus === 'settled' ? 'bg-green-100 text-green-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {txn.cardTransactionStatus}
                </span>
              </div>
              <div className="shrink-0 flex gap-2">
                <Link
                  href="/demo/investigation"
                  className="text-xs px-2 py-1 rounded border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors"
                >
                  View cases
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {transactions.length === 0 && customer && cardToken && !txnLoading && (
        <div className="bg-white rounded-xl border p-5 text-center text-sm text-gray-500">
          No transactions found for this card token.
        </div>
      )}
    </div>
  );
}
