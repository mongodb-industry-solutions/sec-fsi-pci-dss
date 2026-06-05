'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { ROLE_LABELS } from '../../../lib/constants';

interface ProfileData {
  sub: string;
  email: string;
  name: string;
  role: string;
  domain: string;
  agreement: {
    customerName?: string;
    customerEmailAddress?: string;
    customerMobilePhoneNumber?: string;
    customerAgreementReference?: string;
    customerSegment?: string;
    customerAgreementStatus?: string;
    customerAgreementEnrollmentDate?: string;
    customerAgreementPreferredLanguage?: string;
    sensitive?: {
      customerAgreementResidentialAddress?: {
        streetAddress?: string;
        city?: string;
        postalCode?: string;
        countryCode?: string;
      } | null;
      governmentIdentificationReference?: string | null;
    } | null;
  } | null;
}

const SEGMENT_LABELS: Record<string, string> = {
  retail: 'Retail',
  premium: 'Premium',
  corporate: 'Corporate',
  sme: 'SME',
};

const STATUS_COLORS: Record<string, string> = {
  active:    'bg-green-100 text-green-800',
  suspended: 'bg-amber-100 text-amber-800',
  closed:    'bg-red-100 text-red-800',
};

function maskPhone(phone: string) {
  return phone.slice(0, 4) + ' ●●●● ' + phone.slice(-3);
}

function maskAccountRef(ref: string) {
  return ref.slice(0, 4) + '-●●●●●●●';
}

function maskAddress(addr: { streetAddress?: string; city?: string; postalCode?: string; countryCode?: string }) {
  return `${addr.streetAddress?.slice(0, 3)}●●●●, ${addr.city ?? ''}, ${addr.countryCode ?? ''}`;
}

function maskGovId(id: string) {
  return id.slice(0, 6) + '●●●●';
}

type QEType = 'qe-equality' | 'qe-none';

function RevealField({
  label,
  plainValue,
  maskedValue,
  type,
}: {
  label: string;
  plainValue: string;
  maskedValue: string;
  type: QEType;
}) {
  const [revealed, setRevealed] = useState(false);
  const badgeStyle = type === 'qe-equality'
    ? 'bg-blue-100 text-blue-700 border-blue-200'
    : 'bg-purple-100 text-purple-700 border-purple-200';

  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="text-gray-500 text-sm">{label}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded border font-mono ${badgeStyle}`}>
          {type === 'qe-equality' ? 'QE:equality' : 'QE:none'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-mono transition-all ${revealed ? 'text-gray-900' : 'text-gray-400 select-none'}`}>
          {revealed ? plainValue : maskedValue}
        </span>
        <button
          onClick={() => setRevealed((v) => !v)}
          title={revealed ? 'Hide' : 'Reveal'}
          className="text-gray-400 hover:text-[#001E2B] transition-colors text-base shrink-0"
        >
          {revealed ? '🙈' : '👁'}
        </button>
      </div>
    </>
  );
}

function PlainField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-gray-500 text-sm">{label}</span>
      <span className="text-sm text-gray-900">{value}</span>
    </>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = getToken() ?? '';
    if (!t) { setLoading(false); setError('Session not found.'); return; }

    api.auth.me(t)
      .then(setProfile)
      .catch(() => {
        // Fallback: show JWT data only
        const user = decodeToken(t);
        if (user) {
          setProfile({ sub: user.sub, email: user.email, name: user.name, role: user.role, domain: user.domain, agreement: null });
        } else {
          setError('Could not load profile.');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-gray-400 text-sm">Loading profile...</div>;
  if (error)   return <div className="p-6 text-red-600 text-sm">{error}</div>;
  if (!profile) return null;

  const ag = profile.agreement;
  const name   = ag?.customerName ?? profile.name;
  const status = ag?.customerAgreementStatus ?? 'active';
  const hasAddress = ag?.sensitive?.customerAgreementResidentialAddress;
  const hasGovId   = ag?.sensitive?.governmentIdentificationReference;

  return (
    <div className="max-w-xl mx-auto p-6 space-y-5">
      <h1 className="text-2xl font-bold">My Profile</h1>

      {/* Identity card */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-full bg-[#001E2B]/10 flex items-center justify-center text-3xl shrink-0">👤</div>
          <div>
            <p className="font-bold text-xl text-gray-900">{name}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-700'}`}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </span>
              <span className="text-xs bg-blue-500/10 text-blue-700 px-2 py-0.5 rounded">
                {ROLE_LABELS[profile.role] ?? profile.role}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-4 items-center">

          {/* QE:equality fields */}
          <RevealField
            label="Email"
            plainValue={ag?.customerEmailAddress ?? profile.email}
            maskedValue={(() => { const e = ag?.customerEmailAddress ?? profile.email; const [l, d] = e.split('@'); return (l?.slice(0,2) ?? '') + '●●●' + '@' + (d ?? '●●●'); })()}
            type="qe-equality"
          />

          {ag?.customerMobilePhoneNumber ? (
            <RevealField
              label="Phone"
              plainValue={ag.customerMobilePhoneNumber}
              maskedValue={maskPhone(ag.customerMobilePhoneNumber)}
              type="qe-equality"
            />
          ) : (
            <>
              <span className="text-gray-500 text-sm">Phone</span>
              <span className="text-gray-400 text-xs italic">Not on file</span>
            </>
          )}

          {ag?.customerAgreementReference ? (
            <RevealField
              label="Account Reference"
              plainValue={ag.customerAgreementReference}
              maskedValue={maskAccountRef(ag.customerAgreementReference)}
              type="qe-equality"
            />
          ) : (
            <>
              <span className="text-gray-500 text-sm">Account Reference</span>
              <span className="text-gray-400 text-xs italic">Not on file</span>
            </>
          )}

          {/* Plaintext fields */}
          {ag?.customerSegment && (
            <PlainField label="Account type" value={SEGMENT_LABELS[ag.customerSegment] ?? ag.customerSegment} />
          )}
          {ag?.customerAgreementEnrollmentDate && (
            <PlainField label="Member since" value={new Date(ag.customerAgreementEnrollmentDate).toLocaleDateString()} />
          )}
          {ag?.customerAgreementPreferredLanguage && (
            <PlainField label="Language" value={ag.customerAgreementPreferredLanguage.toUpperCase()} />
          )}

          {/* QE:none fields (sensitive) */}
          {hasAddress ? (
            <RevealField
              label="Address"
              plainValue={`${hasAddress.streetAddress}, ${hasAddress.city}, ${hasAddress.postalCode}, ${hasAddress.countryCode}`}
              maskedValue={maskAddress(hasAddress)}
              type="qe-none"
            />
          ) : ag !== null && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500 text-sm">Address</span>
                <span className="text-xs px-1.5 py-0.5 rounded border font-mono bg-purple-100 text-purple-700 border-purple-200">QE:none</span>
              </div>
              <span className="text-gray-400 text-xs italic">Not on file</span>
            </>
          )}

          {hasGovId ? (
            <RevealField
              label="Government ID"
              plainValue={hasGovId}
              maskedValue={maskGovId(hasGovId)}
              type="qe-none"
            />
          ) : ag !== null && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500 text-sm">Government ID</span>
                <span className="text-xs px-1.5 py-0.5 rounded border font-mono bg-purple-100 text-purple-700 border-purple-200">QE:none</span>
              </div>
              <span className="text-gray-400 text-xs italic">Not on file</span>
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white rounded-xl border p-4 text-sm">
        <p className="font-semibold text-gray-700 mb-2">Field encryption legend</p>
        <div className="space-y-1.5 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <span className="bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-mono shrink-0">QE:equality</span>
            <span>Encrypted in Atlas. Searchable without server-side decryption.</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-purple-100 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded font-mono shrink-0">QE:none</span>
            <span>Encrypted in Atlas. Not searchable. Requires Level 2 escalation to reveal.</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-base">👁</span>
            <span>Click to reveal. Click 🙈 to re-hide. Each field is independent.</span>
          </div>
        </div>
      </div>

      {/* Data protection notice */}
      <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-xl p-4 text-sm text-gray-600">
        <p className="font-semibold text-[#001E2B] mb-1">Data protection</p>
        Sensitive fields are stored encrypted using MongoDB Queryable Encryption. They are never
        accessible in plaintext to database administrators or support staff.
      </div>
    </div>
  );
}
