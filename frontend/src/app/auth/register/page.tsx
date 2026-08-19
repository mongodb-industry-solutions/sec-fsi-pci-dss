'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { UserPlus, CheckCircle2, Clock } from 'lucide-react';
import { api } from '../../../lib/api';
import { PasswordFields, passwordFieldsValid } from '../../../components/PasswordFields';

function RegisterForm() {
  const params = useSearchParams();
  const domain = params.get('domain') || 'leafypay';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | 'active' | 'pending'>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError('Name and a valid email are required.');
      return;
    }
    if (!passwordFieldsValid(password, confirm)) {
      setError('Please choose a password that meets the policy and matches its confirmation.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.auth.register({ name: name.trim(), email: email.trim(), password, phone: phone.trim() || undefined, domain });
      setDone(res.status);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]';

  if (done) {
    const isActive = done === 'active';
    return (
      <div className="text-center space-y-3">
        {isActive
          ? <CheckCircle2 size={40} className="text-[#00ED64] mx-auto" />
          : <Clock size={40} className="text-amber-500 mx-auto" />}
        <h1 className="text-lg font-bold text-[#001E2B]">{isActive ? 'Account created' : 'Awaiting approval'}</h1>
        <p className="text-sm text-gray-500">
          {isActive
            ? 'Your account is active. You can sign in now.'
            : 'Your account was created and is pending approval by an administrator. You will be able to sign in once it is approved.'}
        </p>
        <Link href="/system" className="inline-block mt-2 bg-[#001E2B] text-[#00ED64] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-lg bg-[#001E2B] flex items-center justify-center shrink-0">
          <UserPlus size={20} className="text-[#00ED64]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#001E2B] leading-tight">Create an account</h1>
          <p className="text-gray-500 text-sm">Domain: <span className="font-mono">{domain}</span></p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Full name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Jane Doe" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inputCls} placeholder="jane@example.com" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Mobile phone <span className="text-gray-400">(optional)</span></label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="+44 7…" />
          <p className="text-[10px] text-gray-400 mt-0.5">Helps others send you transfers (beneficiary lookup). Stored encrypted.</p>
        </div>
        <PasswordFields password={password} confirm={confirm} onPasswordChange={setPassword} onConfirmChange={setConfirm} idPrefix="reg" />

        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}

        <button type="submit" disabled={submitting || !passwordFieldsValid(password, confirm)}
          className="w-full bg-[#001E2B] text-[#00ED64] py-2.5 rounded-lg font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors disabled:opacity-40">
          {submitting ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <p className="mt-3 text-xs text-gray-400 text-center">
        Registration does not perform identity verification (KYC), which is handled separately.
      </p>
      <div className="mt-3 text-center">
        <Link href="/system" className="text-xs text-gray-400 hover:text-[#001E2B] transition-colors">← Back to sign in</Link>
      </div>
    </>
  );
}

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#001E2B] p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <Suspense fallback={<p className="text-sm text-gray-400 text-center">Loading…</p>}>
          <RegisterForm />
        </Suspense>
      </div>
    </div>
  );
}
