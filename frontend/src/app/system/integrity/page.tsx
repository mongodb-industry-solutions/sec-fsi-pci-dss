'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, decodeToken } from '../../../lib/auth';
import { IntegrityPanel } from '../../../components/dashboard/IntegrityPanel';
import { SectionHeader } from '../../../components/SectionHeader';
import { ShieldCheck } from 'lucide-react';

// Security Auditor only: control-record data-integrity oversight (PCI DSS Req 10).
export default function IntegrityPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const t = getToken() ?? '';
    const role = t ? decodeToken(t)?.role : '';
    if (role !== 'security_auditor') { router.replace('/system'); return; }
    setToken(t);
    setAuthorized(true);
  }, [router]);

  if (!authorized) return null;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-4">
      <SectionHeader
        icon={ShieldCheck}
        title="Data Integrity"
        description="Read-only oversight of fraud case and payment-card records."
        info="This view checks that every case reference is unique, that cases still link to an existing transaction and customer, that the counts reconcile, and that payment cards are not duplicated by error (same card under multiple tokens, or registry drift). It reports aggregates and masked PANs only; never cardholder data."
        debugInfo="BIAN SD-83 / SD-88 control-record integrity · PCI DSS Req 10 (logging & monitoring) · read-only"
      />
      <IntegrityPanel token={token} />
    </div>
  );
}
