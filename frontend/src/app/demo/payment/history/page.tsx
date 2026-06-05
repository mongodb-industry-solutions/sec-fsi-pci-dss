'use client';
import Link from 'next/link';
import { getToken, decodeToken } from '../../../../lib/auth';

export default function TransactionHistoryPage() {
  const token = getToken() ?? '';
  const user = token ? decodeToken(token) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#001E2B] text-white px-4 py-3 flex justify-between">
        <span className="font-bold text-[#00ED64]">🏦 Payment Gateway Demo</span>
        <div className="flex gap-3 items-center text-sm">
          {user && <span className="text-gray-300">{user.name} [Customer]</span>}
          <Link href="/demo" className="text-gray-400 hover:text-white">Sign out</Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto p-6">
        <div className="flex justify-between items-center mb-5">
          <h1 className="text-2xl font-bold">💳 My Transactions</h1>
          <Link href="/demo/payment" className="bg-[#001E2B] text-[#00ED64] px-4 py-2 rounded-lg text-sm font-semibold">
            + New Payment
          </Link>
        </div>
        <div className="bg-white rounded-xl border p-6 text-center text-gray-500">
          <p className="mb-2">Your transaction history will appear here after making a payment.</p>
          <p className="text-sm">Transactions above $500 or from high-risk merchants are automatically flagged for fraud review.</p>
          <Link href="/demo/payment" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
            Make your first payment →
          </Link>
        </div>
      </main>
    </div>
  );
}
