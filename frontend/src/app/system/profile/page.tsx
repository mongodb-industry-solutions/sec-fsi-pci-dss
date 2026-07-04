'use client';
import { useEffect, useState } from 'react';
import { api, type ConsentGrant } from '../../../lib/api';
import { Store } from 'lucide-react';
import { getToken, decodeToken } from '../../../lib/auth';
import { ROLE_LABELS } from '../../../lib/constants';
import { useDebugMode } from '../../../lib/debugMode';
import { Eye, EyeOff, Pencil, Save, X, Lock, ShieldCheck, User, Layers, Trash2 } from 'lucide-react';
import { RawMongoPanel } from '../../../components/RawMongoPanel';
import { SectionHeader } from '../../../components/SectionHeader';

type KycCheckStatus = 'initiated' | 'verified' | 'rejected' | 'expired';

interface CustomerAgreementKycCheck {
  customerAgreementKycCheckStatus: KycCheckStatus;
  customerAgreementKycCheckCompletedDate?: string;
  customerAgreementKycCheckReference?: string;
  customerAgreementKycCheckNotes?: string;
}

type KybCheckStatus = 'initiated' | 'verified' | 'rejected' | 'expired';

interface MerchantKybCheck {
  merchantAgreementKybCheckStatus: KybCheckStatus;
  merchantAgreementKybCheckCompletedDate?: string;
  merchantAgreementKybCheckReference?: string;
  merchantAgreementKybCheckNotes?: string;
}

interface MerchantProfileData {
  merchantAgreementInstanceReference: string;
  merchantAgreementStatus: string;
  merchantAgreementName?: string;
  merchantAgreementMerchantCategoryCode?: string;
  merchantAgreementKybCheck?: MerchantKybCheck | null;
}

interface ProfileData {
  sub: string;
  email: string;
  name: string;
  role: string;
  domain: string;
  partyInstanceReference?: string;
  party?: Record<string, unknown> | null;
  agreement: {
    customerAgreementInstanceReference?: string;
    partyInstanceReference?: string;
    customerName?: string;
    customerEmailAddress?: string;
    customerMobilePhoneNumber?: string;
    customerAgreementReference?: string;
    customerSegment?: string;
    customerAgreementStatus?: string;
    customerAgreementEnrollmentDate?: string;
    customerAgreementPreferredLanguage?: string;
    customerAgreementKycCheck?: CustomerAgreementKycCheck;  // BQ:Step, SD-53. PCI DSS Req 8.1
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

const STATUS_LABELS: Record<string, string> = {
  active:       'Active',
  agreed:       'Approved',
  under_review: 'Under Review',
  initiated:    'Pending',
  rejected:     'Not Approved',
  suspended:    'Suspended',
  closed:       'Closed',
};

const MERCHANT_STATUS_COLORS: Record<string, string> = {
  active:       'bg-green-100 text-green-800',
  agreed:       'bg-green-100 text-green-800',
  under_review: 'bg-amber-100 text-amber-800',
  initiated:    'bg-amber-100 text-amber-800',
  rejected:     'bg-red-100 text-red-800',
  suspended:    'bg-orange-100 text-orange-800',
  closed:       'bg-gray-100 text-gray-600',
};

const KYC_STATUS_COLORS: Record<KycCheckStatus, string> = {
  verified: 'bg-green-100 text-green-800 border-green-200',
  initiated: 'bg-amber-100 text-amber-800 border-amber-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
  expired: 'bg-orange-100 text-orange-800 border-orange-200',
};

const KYC_STATUS_LABELS: Record<KycCheckStatus, string> = {
  verified: 'KYC Verified',
  initiated: 'KYC Pending',
  rejected: 'KYC Rejected',
  expired: 'KYC Expired',
};

const KYB_STATUS_COLORS: Record<KybCheckStatus, string> = {
  verified: 'bg-green-100 text-green-800 border-green-200',
  initiated: 'bg-amber-100 text-amber-800 border-amber-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
  expired: 'bg-orange-100 text-orange-800 border-orange-200',
};

const KYB_STATUS_LABELS: Record<KybCheckStatus, string> = {
  verified: 'KYB Verified',
  initiated: 'KYB Pending',
  rejected: 'KYB Rejected',
  expired: 'KYB Expired',
};

function KybStatusBadge({ kyb, debugMode }: { kyb: MerchantKybCheck; debugMode: boolean }) {
  const colorClass = KYB_STATUS_COLORS[kyb.merchantAgreementKybCheckStatus] ?? 'bg-gray-100 text-gray-700 border-gray-200';
  const label = KYB_STATUS_LABELS[kyb.merchantAgreementKybCheckStatus] ?? kyb.merchantAgreementKybCheckStatus;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className={`text-xs px-2 py-0.5 rounded border font-medium ${colorClass}`}>
        <Store size={10} className="inline mr-1 mb-0.5" />{label}
      </span>
      {debugMode && (
        <>
          <span className="text-xs px-1.5 py-0.5 rounded border font-mono bg-teal-50 text-teal-700 border-teal-200">
            SD-89 · BQ:Step · KybCheck
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded border font-mono bg-slate-50 text-slate-600 border-slate-200">
            PCI Req 12.8
          </span>
        </>
      )}
    </div>
  );
}

function KycStatusBadge({ kyc, debugMode }: { kyc: CustomerAgreementKycCheck; debugMode: boolean }) {
  const colorClass = KYC_STATUS_COLORS[kyc.customerAgreementKycCheckStatus] ?? 'bg-gray-100 text-gray-700 border-gray-200';
  const label = KYC_STATUS_LABELS[kyc.customerAgreementKycCheckStatus] ?? kyc.customerAgreementKycCheckStatus;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className={`text-xs px-2 py-0.5 rounded border font-medium ${colorClass}`}>
        <ShieldCheck size={10} className="inline mr-1 mb-0.5" />{label}
      </span>
      {debugMode && (
        <>
          <span className="text-xs px-1.5 py-0.5 rounded border font-mono bg-teal-50 text-teal-700 border-teal-200">
            SD-53 · BQ:Step · KycCheck
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded border font-mono bg-slate-50 text-slate-600 border-slate-200">
            PCI Req 8.1
          </span>
        </>
      )}
    </div>
  );
}

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

function CollectionChip({ name }: { name: string }) {
  return (
    <span className="text-xs px-1.5 py-0.5 rounded border font-mono bg-[#001E2B]/5 text-amber-600 border-amber-200/60 shrink-0">
      {name}
    </span>
  );
}

function RevealField({
  label,
  plainValue,
  maskedValue,
  type,
  collection,
}: {
  label: string;
  plainValue: string;
  maskedValue: string;
  type: QEType;
  collection?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const { debugMode } = useDebugMode();
  const badgeStyle = type === 'qe-equality'
    ? 'bg-blue-100 text-blue-700 border-blue-200'
    : 'bg-purple-100 text-purple-700 border-purple-200';

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-gray-500 text-sm">{label}</span>
        {debugMode && (
          <span className={`text-xs px-1.5 py-0.5 rounded border font-mono ${badgeStyle}`}>
            {type === 'qe-equality' ? 'QE:equality' : 'QE:none'}
          </span>
        )}
        {debugMode && collection && <CollectionChip name={collection} />}
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`text-sm font-mono transition-all break-all min-w-0 ${revealed ? 'text-gray-900' : 'text-gray-400 select-none'}`}>
          {revealed ? plainValue : maskedValue}
        </span>
        <button
          onClick={() => setRevealed((v) => !v)}
          title={revealed ? 'Hide' : 'Reveal'}
          className="text-gray-400 hover:text-[#001E2B] transition-colors shrink-0"
        >
          {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </>
  );
}

function PlainField({ label, value, collection }: { label: string; value: string; collection?: string }) {
  const { debugMode } = useDebugMode();
  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-gray-500 text-sm">{label}</span>
        {debugMode && collection && <CollectionChip name={collection} />}
      </div>
      <span className="text-sm text-gray-900 break-all">{value}</span>
    </>
  );
}

export default function ProfilePage() {
  const { debugMode } = useDebugMode();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [merchant, setMerchant] = useState<MerchantProfileData | null>(null);
  const [grants, setGrants] = useState<ConsentGrant[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editLang, setEditLang] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [editAddress, setEditAddress] = useState({ streetAddress: '', city: '', postalCode: '', countryCode: '' });

  // QE reference accordion state
  const [qeExpanded, setQeExpanded] = useState<Record<string, boolean>>({});
  const toggleQe = (key: string) => setQeExpanded(p => ({ ...p, [key]: !p[key] }));

  async function reload(t: string) {
    const data = await api.auth.me(t).catch(() => null);
    if (data) {
      setProfile(data);
      setEditName((data.agreement?.customerName as string | undefined) ?? data.name ?? '');
      setEditPhone((data.agreement?.customerMobilePhoneNumber as string | undefined) ?? '');
      setEditLang((data.agreement?.customerAgreementPreferredLanguage as string | undefined) ?? '');
      const sensitive = data.agreement?.['sensitive'] as { customerAgreementResidentialAddress?: Record<string, string> } | null;
      const addr = sensitive?.customerAgreementResidentialAddress;
      if (addr) {
        setEditAddress({
          streetAddress: addr.streetAddress ?? '',
          city:          addr.city ?? '',
          postalCode:    addr.postalCode ?? '',
          countryCode:   addr.countryCode ?? '',
        });
      }
    }
    return data;
  }

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (!t) { setLoading(false); setError('Session not found.'); return; }

    reload(t)
      .then(() => {
        api.merchants.getMe(t)
          .then(res => { if (res.found && res.merchant) setMerchant(res.merchant as unknown as MerchantProfileData); })
          .catch(() => null);
        // Load OAuth consent grants (authorized apps)
        setGrantsLoading(true);
        api.consentGrants.list(t)
          .then((r) => setGrants(r.grants))
          .catch(() => { /* not fatal */ })
          .finally(() => setGrantsLoading(false));
      })
      .catch(() => {
        const user = decodeToken(t);
        if (user) {
          setProfile({ sub: user.sub, email: user.email, name: user.name, role: user.role, domain: user.domain, agreement: null });
          setEditName(user.name ?? '');
        } else {
          setError('Could not load profile.');
        }
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function cancelEdit() {
    setEditing(false);
    setSaveMsg(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const patch: Parameters<typeof api.auth.updateMe>[0] = {};
      if (editName.trim()) patch.customerName = editName.trim();
      // Customer-only fields (require agreement / party record)
      if (profile?.agreement) {
        if (editPhone.trim()) patch.customerMobilePhoneNumber = editPhone.trim();
        if (editLang.trim())  patch.customerAgreementPreferredLanguage = editLang.trim();
        if (editAddress.streetAddress.trim() || editAddress.city.trim()) {
          patch.customerAgreementResidentialAddress = {
            streetAddress: editAddress.streetAddress.trim(),
            city:          editAddress.city.trim(),
            postalCode:    editAddress.postalCode.trim(),
            countryCode:   editAddress.countryCode.trim() || 'US',
          };
        }
      }

      await api.auth.updateMe(patch, token);
      await reload(token);
      setEditing(false);
      setSaveMsg('Profile updated successfully.');
    } catch (e) {
      setSaveMsg(`Error: ${e instanceof Error ? e.message : 'Update failed.'}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-gray-400 text-sm">Loading profile...</div>;
  if (error)   return <div className="p-6 text-red-600 text-sm">{error}</div>;
  if (!profile) return null;

  const ag = profile.agreement;
  // SD-13 Party demographics — populated for every role (staff included), so non-customer
  // profiles are not empty. Customers get these from the agreement above; staff from party.
  const pty = profile.party as {
    partyMobilePhoneNumber?: string;
    partyDateOfBirth?: string;
    partyNationality?: string;
    partyPostalAddress?: { line1: string; line2?: string; city: string; postalCode: string; countryCode: string };
  } | null | undefined;
  const name   = ag?.customerName ?? profile.name;
  const status = ag?.customerAgreementStatus ?? 'active';
  const hasAddress = ag?.sensitive?.customerAgreementResidentialAddress;
  const hasGovId   = ag?.sensitive?.governmentIdentificationReference;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={User}
        title="My Profile"
        description="Your account and contact details."
        debugInfo="BIAN SD-53 Customer Agreement · PCI DSS Req 8 (identity) · Req 3 (QE at rest)"
        actions={!editing && (
          <button
            onClick={() => { setEditing(true); setSaveMsg(null); }}
            className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium"
          >
            <Pencil size={14} />
            Edit Profile
          </button>
        )}
      />

      {saveMsg && (
        <div className={`rounded-xl p-3 text-sm ${saveMsg.startsWith('Error') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          {saveMsg}
        </div>
      )}

      {/* Identity card - inline editable */}
      <div className="bg-white rounded-xl border p-5">
        {/* Header: avatar + name (editable) + status */}
        <div className="flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-full bg-[#001E2B]/10 flex items-center justify-center text-3xl shrink-0">👤</div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-lg font-bold text-gray-900 focus:outline-none focus:border-[#001E2B] focus:ring-1 focus:ring-[#001E2B]/20 mb-1"
                placeholder="Full name"
              />
            ) : (
              <p className="font-bold text-xl text-gray-900">{name}</p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-700'}`}>
                {STATUS_LABELS[status] ?? status}
              </span>
              <span className="text-xs bg-blue-500/10 text-blue-700 px-2 py-0.5 rounded">
                {ROLE_LABELS[profile.role] ?? profile.role}
              </span>
              {debugMode && <CollectionChip name="party" />}
            </div>
            {ag?.customerAgreementKycCheck && (
              <div className="mt-1.5">
                <KycStatusBadge kyc={ag.customerAgreementKycCheck} debugMode={false} />
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 items-start min-w-0">

          {/* Email - always read-only (login identity) */}
          <RevealField
            label="Email"
            plainValue={ag?.customerEmailAddress ?? profile.email}
            maskedValue={(() => { const e = ag?.customerEmailAddress ?? profile.email; const [l, d] = e.split('@'); return (l?.slice(0,2) ?? '') + '●●●' + '@' + (d ?? '●●●'); })()}
            type="qe-equality"
            collection="party"
          />

          {/* Phone - editable (customer only) */}
          {(editing && ag) ? (
            <>
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-gray-500 text-sm">Phone</span>
                {debugMode && (
                  <span className="flex items-center gap-1 bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-mono text-xs">
                    <Lock size={9} /> QE:equality
                  </span>
                )}
                {debugMode && <CollectionChip name="party" />}
              </div>
              <input
                value={editPhone}
                onChange={e => setEditPhone(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-[#001E2B] focus:ring-1 focus:ring-[#001E2B]/20"
                placeholder="+1-555-0000"
              />
            </>
          ) : ag?.customerMobilePhoneNumber ? (
            <RevealField label="Phone" plainValue={ag.customerMobilePhoneNumber} maskedValue={maskPhone(ag.customerMobilePhoneNumber)} type="qe-equality" collection="party" />
          ) : ag ? (
            <>
              <span className="text-gray-500 text-sm">Phone</span>
              <span className="text-gray-400 text-xs italic">{editing ? '' : 'Not on file'}</span>
            </>
          ) : null /* staff: phone rendered from the party record below (no duplicate row) */}

          {/* Account Reference - customers only (staff have no customer agreement) */}
          {ag?.customerAgreementReference ? (
            <RevealField label="Account Reference" plainValue={ag.customerAgreementReference} maskedValue={maskAccountRef(ag.customerAgreementReference)} type="qe-equality" collection="customerAgreementProcedure" />
          ) : ag ? (
            <>
              <span className="text-gray-500 text-sm">Account Reference</span>
              <span className="text-gray-400 text-xs italic">Not on file</span>
            </>
          ) : null}

          {/* Segment / member since - read-only */}
          {ag?.customerSegment && <PlainField label="Account type" value={SEGMENT_LABELS[ag.customerSegment] ?? ag.customerSegment} collection="customerAgreementProcedure" />}
          {ag?.customerAgreementEnrollmentDate && <PlainField label="Member since" value={new Date(ag.customerAgreementEnrollmentDate).toLocaleDateString()} collection="customerAgreementProcedure" />}

          {/* Language - editable (customer only) */}
          {(editing && ag) ? (
            <>
              <span className="text-gray-500 text-sm pt-0.5">Language</span>
              <select
                value={editLang}
                onChange={e => setEditLang(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-[#001E2B]"
              >
                <option value="en">English (en)</option>
                <option value="es">Spanish (es)</option>
                <option value="fr">French (fr)</option>
                <option value="de">German (de)</option>
                <option value="pt">Portuguese (pt)</option>
              </select>
            </>
          ) : ag?.customerAgreementPreferredLanguage && (
            <PlainField label="Language" value={ag.customerAgreementPreferredLanguage.toUpperCase()} collection="customerAgreementProcedure" />
          )}

          {/* Address - editable (QE:none, customer only) */}
          {(editing && ag) ? (
            <>
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-gray-500 text-sm">Address</span>
                {debugMode && <span className="text-xs px-1.5 py-0.5 rounded border font-mono bg-purple-100 text-purple-700 border-purple-200">QE:none</span>}
                {debugMode && <CollectionChip name="customerAgreementProcedure" />}
              </div>
              <div className="space-y-1.5">
                <input
                  value={editAddress.streetAddress}
                  onChange={e => setEditAddress(p => ({ ...p, streetAddress: e.target.value }))}
                  placeholder="Street address"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#001E2B] focus:ring-1 focus:ring-[#001E2B]/20"
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    value={editAddress.city}
                    onChange={e => setEditAddress(p => ({ ...p, city: e.target.value }))}
                    placeholder="City"
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#001E2B]"
                  />
                  <input
                    value={editAddress.postalCode}
                    onChange={e => setEditAddress(p => ({ ...p, postalCode: e.target.value }))}
                    placeholder="Postal code"
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#001E2B]"
                  />
                </div>
                <input
                  value={editAddress.countryCode}
                  onChange={e => setEditAddress(p => ({ ...p, countryCode: e.target.value.toUpperCase().slice(0, 2) }))}
                  placeholder="Country code (US)"
                  maxLength={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono uppercase focus:outline-none focus:border-[#001E2B]"
                />
              </div>
            </>
          ) : hasAddress ? (
            <RevealField
              label="Address"
              plainValue={`${hasAddress.streetAddress}, ${hasAddress.city}, ${hasAddress.postalCode}, ${hasAddress.countryCode}`}
              maskedValue={maskAddress(hasAddress)}
              type="qe-none"
              collection="customerAgreementProcedure"
            />
          ) : ag !== null && (
            <>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-gray-500 text-sm">Address</span>
                {debugMode && <span className="text-xs px-1.5 py-0.5 rounded border font-mono bg-purple-100 text-purple-700 border-purple-200">QE:none</span>}
                {debugMode && <CollectionChip name="customerAgreementProcedure" />}
              </div>
              <span className="text-gray-400 text-xs italic">Not on file</span>
            </>
          )}

          {/* Government ID - read-only */}
          {hasGovId ? (
            <RevealField label="Government ID" plainValue={hasGovId} maskedValue={maskGovId(hasGovId)} type="qe-none" collection="customerAgreementProcedure" />
          ) : ag !== null && (
            <>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-gray-500 text-sm">Government ID</span>
                {debugMode && <span className="text-xs px-1.5 py-0.5 rounded border font-mono bg-purple-100 text-purple-700 border-purple-200">QE:none</span>}
                {debugMode && <CollectionChip name="customerAgreementProcedure" />}
              </div>
              <span className="text-gray-400 text-xs italic">Not on file</span>
            </>
          )}

          {/* SD-13 Party demographics — shown for staff (no customer agreement), so their profile
              carries the same KYC-typical detail as customers: phone, DOB, nationality, address.
              Phone/DOB/address are GDPR PII (QE-encrypted at rest), shown with a reveal toggle. */}
          {!ag && pty && (() => {
            const dob = pty.partyDateOfBirth ? new Date(pty.partyDateOfBirth) : null;
            const dobValid = dob && !isNaN(dob.getTime());
            const addr = pty.partyPostalAddress;
            const addrFull = addr
              ? [addr.line1, addr.line2, addr.city, addr.postalCode, addr.countryCode].filter(Boolean).join(', ')
              : '';
            const addrMasked = addr ? `••• ${addr.city}, ${addr.countryCode}` : '';
            return (
              <>
                {pty.partyMobilePhoneNumber && (
                  <RevealField label="Phone" plainValue={pty.partyMobilePhoneNumber} maskedValue={maskPhone(pty.partyMobilePhoneNumber)} type="qe-equality" collection="party" />
                )}
                {dobValid && (
                  <RevealField label="Date of birth" plainValue={dob!.toLocaleDateString()} maskedValue="••/••/••••" type="qe-none" collection="party" />
                )}
                {pty.partyNationality && <PlainField label="Nationality" value={pty.partyNationality} collection="party" />}
                {addr && (
                  <RevealField label="Address" plainValue={addrFull} maskedValue={addrMasked} type="qe-none" collection="party" />
                )}
              </>
            );
          })()}

          {/* Inline Save / Cancel - only when editing */}
          {editing && (
            <div className="col-span-2 flex gap-2 pt-3 mt-1 border-t">
              <button
                onClick={cancelEdit}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <X size={14} />
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                <Save size={14} />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Legend - only visible in debug mode */}
      {debugMode && (
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
              <Eye size={12} />
              <span>Click to reveal a field. Click again to re-hide it. Each field is independent.</span>
            </div>
          </div>
        </div>
      )}

      {/* KYC Compliance Status, visible when agreement data is present */}
      {ag?.customerAgreementKycCheck && (
        <div className="bg-white rounded-xl border p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-gray-500 shrink-0" />
              <h2 className="font-semibold text-gray-800 text-sm">Identity Verification (KYC)</h2>
            </div>
            {debugMode && (
              <span className="text-xs px-1.5 py-0.5 rounded border font-mono bg-teal-50 text-teal-700 border-teal-200 shrink-0">
                SD-53 · BQ:Step · KycCheck · PCI Req 8.1
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm items-start">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-gray-500">KYC Status</span>
              {debugMode && <CollectionChip name="customerAgreementProcedure" />}
            </div>
            <div>
              <KycStatusBadge kyc={ag.customerAgreementKycCheck} debugMode={debugMode} />
            </div>
            {ag.customerAgreementKycCheck.customerAgreementKycCheckCompletedDate && (
              <>
                <span className="text-gray-500">Verified on</span>
                <span className="text-gray-800">
                  {new Date(ag.customerAgreementKycCheck.customerAgreementKycCheckCompletedDate).toLocaleDateString()}
                </span>
              </>
            )}
            {debugMode && ag.customerAgreementKycCheck.customerAgreementKycCheckReference && (
              <>
                <span className="text-gray-500 text-sm">Reference</span>
                <span className="font-mono text-xs text-gray-500">{ag.customerAgreementKycCheck.customerAgreementKycCheckReference}</span>
              </>
            )}
            {debugMode && ag.customerAgreementKycCheck.customerAgreementKycCheckNotes && (
              <>
                <span className="text-gray-500 text-sm">Notes</span>
                <span className="text-xs text-gray-500">{ag.customerAgreementKycCheck.customerAgreementKycCheckNotes}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* OAuth Authorized Apps — visible to any user; shows granted consent via OIDC */}
      {(grants.length > 0 || grantsLoading) && (
        <div className="bg-white rounded-xl border p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-gray-500 shrink-0" />
              <h2 className="font-semibold text-gray-800 text-sm">Authorized Applications</h2>
            </div>
            {debugMode && (
              <span className="text-xs px-1.5 py-0.5 rounded border font-mono bg-teal-50 text-teal-700 border-teal-200 shrink-0">
                SD-16 · ConsentGrant · OAuth 2.0 · OIDC
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">Apps and merchants you have authorized to access your account via OIDC. You can revoke access at any time.</p>

          {grantsLoading ? (
            <p className="text-xs text-gray-400">Loading authorized apps…</p>
          ) : (
            <div className="space-y-2">
              {grants.map((grant) => (
                <div key={grant.consentId} className="flex items-start justify-between gap-3 border border-gray-100 rounded-lg p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-gray-800">{grant.merchantName}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {grant.grantedScopes.map((scope) => (
                        <span key={scope} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">{scope}</span>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Granted {new Date(grant.consentGrantedAt).toLocaleDateString()}
                      {grant.lastUsedAt && ` · Last used ${new Date(grant.lastUsedAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      setRevoking(grant.consentId);
                      try {
                        await api.consentGrants.revoke(grant.consentId, token);
                        setGrants((g) => g.filter((x) => x.consentId !== grant.consentId));
                      } catch { /* ignore */ }
                      setRevoking(null);
                    }}
                    disabled={revoking === grant.consentId}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded-lg px-2 py-1 disabled:opacity-50 shrink-0"
                  >
                    <Trash2 size={12} />{revoking === grant.consentId ? 'Revoking…' : 'Revoke'}
                  </button>
                </div>
              ))}
              {grants.length === 0 && (
                <p className="text-xs text-gray-400 italic">No active authorized applications.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Merchant Agreement & KYB, visible when customer has a merchant application */}
      {merchant && (
        <div className="bg-white rounded-xl border p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Store size={16} className="text-gray-500 shrink-0" />
              <h2 className="font-semibold text-gray-800 text-sm">Merchant Agreement</h2>
            </div>
            {debugMode && (
              <span className="text-xs px-1.5 py-0.5 rounded border font-mono bg-teal-50 text-teal-700 border-teal-200 shrink-0">
                SD-89 · MerchantAgreementProcedure · PCI Req 12.8
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm items-start">
            {merchant.merchantAgreementName && (
              <>
                <span className="text-gray-500">Business name</span>
                <span className="text-gray-800 font-medium">{merchant.merchantAgreementName}</span>
              </>
            )}
            {merchant.merchantAgreementMerchantCategoryCode && (
              <>
                <span className="text-gray-500">MCC</span>
                <span className="font-mono text-xs text-gray-700">{merchant.merchantAgreementMerchantCategoryCode}</span>
              </>
            )}
            <>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-gray-500">Agreement status</span>
                {debugMode && <CollectionChip name="merchantAgreementProcedure" />}
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-xs px-2 py-0.5 rounded font-medium w-fit ${MERCHANT_STATUS_COLORS[merchant.merchantAgreementStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABELS[merchant.merchantAgreementStatus] ?? merchant.merchantAgreementStatus}
                </span>
                {debugMode && (
                  <span className="font-mono text-gray-400 text-[10px]">{merchant.merchantAgreementStatus}</span>
                )}
              </div>
            </>
            {merchant.merchantAgreementKybCheck && (
              <>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-gray-500">KYB Status</span>
                </div>
                <KybStatusBadge kyb={merchant.merchantAgreementKybCheck} debugMode={debugMode} />
              </>
            )}
            {merchant.merchantAgreementKybCheck?.merchantAgreementKybCheckCompletedDate && (
              <>
                <span className="text-gray-500">KYB completed</span>
                <span className="text-gray-800">
                  {new Date(merchant.merchantAgreementKybCheck.merchantAgreementKybCheckCompletedDate).toLocaleDateString()}
                </span>
              </>
            )}
            {debugMode && merchant.merchantAgreementKybCheck?.merchantAgreementKybCheckReference && (
              <>
                <span className="text-gray-500">KYB reference</span>
                <span className="font-mono text-xs text-gray-500">{merchant.merchantAgreementKybCheck.merchantAgreementKybCheckReference}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Payment-card management lives in its own section: /system/cards (BIAN SD-88). */}

      {/* Data protection notice, debug mode only */}
      {debugMode && (
        <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-xl p-4 text-sm text-gray-600">
          <p className="font-semibold text-[#001E2B] mb-1">Data protection</p>
          Sensitive fields are stored encrypted using MongoDB Queryable Encryption. They are never
          accessible in plaintext to database administrators or support staff.
        </div>
      )}

      {/* Debug: raw MongoDB documents via RawMongoPanel */}
      {debugMode && (
        <RawMongoPanel
          token={token}
          sections={[
            {
              kind: 'mongo' as const,
              collection: 'customerAuthenticationAssessment',
              id: profile.sub,
              label: 'customerAuthenticationAssessment',
              labelColor: 'text-yellow-400',
              description: 'SD-91 - login identity, role, QE:equality (email), bcrypt hash',
            },
            ...(profile.partyInstanceReference ? [{
              kind: 'mongo' as const,
              collection: 'party',
              id: profile.partyInstanceReference,
              label: 'party',
              labelColor: 'text-emerald-400',
              description: 'SD-13 PII store - QE:equality (email, phone) + plaintext (name, segment)',
            }] : []),
            ...(profile.agreement?.customerAgreementInstanceReference ? [{
              kind: 'mongo' as const,
              collection: 'customerAgreementProcedure',
              id: profile.agreement.customerAgreementInstanceReference,
              label: 'customerAgreementProcedure',
              labelColor: 'text-blue-400',
              description: 'QE:equality (accountRef) + QE:none (address, govId) - v2 unified document',
            }] : []),
          ]}
        />
      )}

      {/* QE field definition reference - same style as RawMongoPanel, debug only */}
      {debugMode && (
        <div className="rounded-xl overflow-hidden border border-[#00ED64]/20">

          {/* Header - identical to RawMongoPanel header */}
          <div className="bg-[#001E2B] px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[#00ED64] text-xs font-semibold shrink-0">
                How QE fields are declared in MongoDB
              </span>
              <span className="text-gray-500 text-xs hidden sm:inline">
                Each entry in{' '}
                <span className="font-mono text-gray-300">encryptedFieldsMap</span>
                {' '}controls storage mode and searchability.
              </span>
            </div>
            <a
              href="https://www.mongodb.com/docs/manual/core/queryable-encryption/"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 text-xs text-[#00ED64] border border-[#00ED64]/40 px-2 py-1 rounded hover:bg-[#00ED64]/10 transition-colors"
            >
              Docs ↗
            </a>
          </div>

          {/* Three code sections + comparison table - all accordion rows */}
          {([
            {
              key: 'equality',
              badge: <span className="bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-mono text-xs shrink-0">QE:equality</span>,
              desc: 'Encrypted + searchable by exact match. Atlas stores ciphertext; the driver encrypts the predicate client-side.',
              code: `{\n  path: "customerEmailAddress",\n  bsonType: "string",\n  queries: [{ queryType: "equality" }]   // enables QE:equality search\n}`,
            },
            {
              key: 'none',
              badge: <span className="bg-purple-100 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded font-mono text-xs shrink-0">QE:none</span>,
              desc: 'Encrypted with DEK-sensitive. Not searchable. Requires L2 escalation token to reveal.',
              code: `{\n  path: "customerAgreementResidentialAddress",\n  bsonType: "object"\n  // No "queries" key → stored encrypted, never queryable\n}`,
            },
            {
              key: 'plaintext',
              badge: <span className="bg-gray-800 text-gray-400 border border-gray-700 px-1.5 py-0.5 rounded font-mono text-xs shrink-0">plaintext</span>,
              desc: 'Not listed in encryptedFieldsMap. Atlas stores the raw value - readable without any key.',
              code: `// Simply omit the field from encryptedFieldsMap\n// Atlas stores:   "customerName": "Luis Fernandez"        ← plaintext\n// QE stores:      "customerEmailAddress": { "$binary": { "subType": "06" ... } }`,
            },
          ] as const).map(({ key, badge, desc, code }) => (
            <div key={key} className="border-t border-[#00ED64]/60">
              <button
                onClick={() => toggleQe(key)}
                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 bg-[#001E2B] hover:bg-[#001020] transition-colors duration-150 text-left"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {badge}
                  <span className="text-gray-600 text-xs hidden md:inline truncate">{desc}</span>
                </span>
                <span className="text-[#00ED64] text-xs shrink-0">{qeExpanded[key] ? '▲' : '▼'}</span>
              </button>
              {qeExpanded[key] && (
                <div className="border-t border-[#00ED64]/20">
                  <pre className={[
                    'text-xs text-green-300 whitespace-pre font-mono max-h-40 overflow-auto bg-[#001E2B] px-4 py-3',
                    '[scrollbar-width:thin] [scrollbar-color:#00ED64_#001020]',
                    '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5',
                    '[&::-webkit-scrollbar-track]:bg-[#001020] [&::-webkit-scrollbar-track]:rounded-full',
                    '[&::-webkit-scrollbar-thumb]:bg-[#00ED64]/40 [&::-webkit-scrollbar-thumb]:rounded-full',
                    '[&::-webkit-scrollbar-thumb:hover]:bg-[#00ED64]/70',
                  ].join(' ')}>{code}</pre>
                </div>
              )}
            </div>
          ))}

          {/* Comparison table - accordion row */}
          <div className="border-t border-[#00ED64]/60">
            <button
              onClick={() => toggleQe('table')}
              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 bg-[#001E2B] hover:bg-[#001020] transition-colors duration-150 text-left"
            >
              <span className="flex items-center gap-2">
                <span className="text-gray-300 text-xs font-mono shrink-0">comparison</span>
                <span className="text-gray-600 text-xs hidden md:inline">Mode vs storage format vs searchability vs DEK</span>
              </span>
              <span className="text-[#00ED64] text-xs shrink-0">{qeExpanded['table'] ? '▲' : '▼'}</span>
            </button>
            {qeExpanded['table'] && (
              <div className="border-t border-[#00ED64]/20 bg-[#001E2B] px-4 py-3">
                <table className="w-full text-xs text-gray-400">
                  <thead>
                    <tr className="text-gray-600 uppercase tracking-wide">
                      <th className="text-left pb-2 pr-4">Mode</th>
                      <th className="text-left pb-2 pr-4 hidden sm:table-cell">Atlas stores</th>
                      <th className="text-left pb-2 pr-4">Searchable</th>
                      <th className="text-left pb-2">DEK</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#00ED64]/10">
                    <tr>
                      <td className="py-1.5 pr-4 font-mono text-blue-400">QE:equality</td>
                      <td className="py-1.5 pr-4 font-mono text-amber-400 hidden sm:table-cell">$binary subType 06</td>
                      <td className="py-1.5 pr-4 text-green-400">Yes, exact match</td>
                      <td className="py-1.5 text-gray-500">DEK-lookup</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-4 font-mono text-purple-400">QE:none</td>
                      <td className="py-1.5 pr-4 font-mono text-amber-400 hidden sm:table-cell">$binary subType 06</td>
                      <td className="py-1.5 pr-4 text-red-400">No</td>
                      <td className="py-1.5 text-gray-500">DEK-sensitive (L2)</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-4 font-mono text-gray-500">plaintext</td>
                      <td className="py-1.5 pr-4 font-mono text-green-300 hidden sm:table-cell">Raw value</td>
                      <td className="py-1.5 pr-4 text-green-400">Yes, standard index</td>
                      <td className="py-1.5 text-gray-500">None</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
