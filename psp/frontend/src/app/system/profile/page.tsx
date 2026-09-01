'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, type ConsentGrant } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { ROLE_LABELS, AUTHORITY_UI_PUBLIC_URL } from '../../../lib/constants';
import { useDebugMode } from '../../../lib/debugMode';
import { DisplayMask } from '../../../components/record/DisplayMask';
import { Eye, EyeOff, Pencil, Save, X, Lock, ShieldCheck, User, Layers, Trash2, Copy, Check, KeyRound, ChevronRight, Info, IdCard, ExternalLink } from 'lucide-react';
import { RawMongoPanel } from '../../../components/RawMongoPanel';
import { SectionHeader } from '../../../components/SectionHeader';
import { DebugChip } from '../../../components/DebugChip';

type KycCheckStatus = 'initiated' | 'verified' | 'rejected' | 'expired';

interface CustomerAgreementKycCheck {
  customerAgreementKycCheckStatus: KycCheckStatus;
  customerAgreementKycCheckCompletedDate?: string;
  customerAgreementKycCheckReference?: string;
  customerAgreementKycCheckNotes?: string;
  // v27 provider-produced verdicts (structured, auditable). Present for the owner.
  customerAgreementKycCheckRiskScore?: number;
  customerAgreementKycCheckRiskRating?: 'low' | 'medium' | 'high';
  customerAgreementKycCheckPepStatus?: boolean;
  customerAgreementKycCheckSanctionsResult?: 'clear' | 'hit' | 'pending';
}

interface GovernmentID {
  type?: string;
  number?: string;
  issuingCountry?: string;
  expiryDate?: string;
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
    customerAgreementKycCheck?: CustomerAgreementKycCheck;  // BQ:Step. PCI DSS
    // v27 KYC identity, decrypted for the owner (self-profile runs on the L2/auditor client).
    customerAgreementGovernmentID?: GovernmentID | null;
    customerAgreementTaxIDNumber?: string;
    customerAgreementOccupation?: string;
    partyDateOfBirth?: string;
    partyNationality?: string;
    partyPlaceOfBirth?: string;
    partySex?: string;
    sensitive?: {
      customerAgreementResidentialAddress?: {
        streetAddress?: string;
        city?: string;
        postalCode?: string;
        countryCode?: string;
      } | null;
      customerAgreementSourceOfFunds?: string | null;
      customerAgreementPurposeOfRelationship?: string | null;
    } | null;
  } | null;
}

const COUNTRY_NAMES: Record<string, string> = {
  ES: 'Spain', GB: 'United Kingdom', US: 'United States', FR: 'France', DE: 'Germany',
  IT: 'Italy', PT: 'Portugal', PL: 'Poland', MX: 'Mexico', NG: 'Nigeria',
};

// Turn a system enum value (e.g. "national_id", "salary") into a human label.
function humanize(v: string): string {
  return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bId\b/g, 'ID');
}

function countryLabel(code?: string): string {
  if (!code) return '—';
  return COUNTRY_NAMES[code] ? `${COUNTRY_NAMES[code]} (${code})` : code;
}

const SEX_LABELS: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
  unspecified: 'Not specified',
};

function sexLabel(value?: string): string {
  if (!value) return '—';
  return SEX_LABELS[value] ?? value;
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
          <DebugChip label="BQ:Step · KycCheck" />
          <DebugChip label="PCI DSS" tone="standard" />
        </>
      )}
    </div>
  );
}

type QEType = 'qe-equality' | 'qe-none' | 'qe-range' | 'qe-prefix' | 'qe-suffix';

// Badge label + styling per QE query mode, so each field shows how it is stored/searchable.
const QE_BADGE: Record<QEType, { label: string; cls: string }> = {
  'qe-equality': { label: 'QE:equality', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  'qe-range':    { label: 'QE:range',    cls: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
  'qe-prefix':   { label: 'QE:prefix',   cls: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  'qe-suffix':   { label: 'QE:suffix',   cls: 'bg-violet-100 text-violet-700 border-violet-200' },
  'qe-none':     { label: 'QE:none',     cls: 'bg-purple-100 text-purple-700 border-purple-200' },
};

// Hover/focus tooltip that explains what a profile field means. Icon-only so it never adds noise;
// the text appears on hover and is exposed to assistive tech via role="tooltip".
function InfoHint({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex items-center align-middle">
      <Info size={12} className="text-gray-400 hover:text-[#001E2B] cursor-help shrink-0" tabIndex={0} aria-label={text} />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 w-56 -translate-x-1/2 rounded-lg bg-[#001E2B] px-3 py-2 text-xs font-normal leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

function CollectionChip({ name }: { name: string }) {
  return <DebugChip label={name} tone="collection" />;
}

// Copy-to-clipboard for a protected field's plaintext value. Mirrors the account-detail affordance.
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Clear any pending reset on unmount so the timer never fires setState after the component is gone.
  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => setCopied(false), 1200);
        } catch { /* clipboard unavailable, no-op */ }
      }}
      title={copied ? 'Copied' : `Copy ${label}`}
      aria-label={`Copy ${label}`}
      className="text-gray-400 hover:text-[#001E2B] transition-colors shrink-0"
    >
      {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
    </button>
  );
}

// Fully obscured placeholder for any encrypted value while hidden. We deliberately do NOT leak
// the length or any characters of the plaintext; the eye toggle reveals the real value on demand.
const MASK = '••••••••';

// v32 C1: this is the customer's OWN record, which the data subject is entitled to hold (GDPR
// Art. 15), so the mask here is a screen-sharing convenience and NOT an access control. It uses the
// shared DisplayMask, whose tooltip states that plainly, rather than SensitiveReveal, which is
// reserved for values fetched from an audited reveal endpoint (ADR-052).
function RevealField({
  label, plainValue, type, collection, info,
}: {
  label: string; plainValue: string; type: QEType; collection?: string; info?: string;
}) {
  const { debugMode } = useDebugMode();
  const badge = QE_BADGE[type];
  return (
    <DisplayMask
      label={label}
      value={plainValue}
      {...(info ? { info } : {})}
      chrome={debugMode ? (
        <>
          <span className={`text-xs px-1.5 py-0.5 rounded border font-mono ${badge.cls}`}>{badge.label}</span>
          {collection && <CollectionChip name={collection} />}
        </>
      ) : undefined}
      actions={(shown) => <CopyButton value={shown} label={label} />}
    />
  );
}

function PlainField({ label, value, collection, qe, info }: { label: string; value: string; collection?: string; qe?: QEType; info?: string }) {
  const { debugMode } = useDebugMode();
  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-gray-500 text-sm">{label}</span>
        {info && <InfoHint text={info} />}
        {debugMode && qe && (
          <span className={`text-xs px-1.5 py-0.5 rounded border font-mono ${QE_BADGE[qe].cls}`}>
            {QE_BADGE[qe].label}
          </span>
        )}
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
  const [editAddress, setEditAddress] = useState({ streetAddress : '', city : '', postalCode : '', countryCode: '' });

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
  // Party demographics: populated for every role (staff included), so non-customer
  // profiles are not empty. Customers get these from the agreement above; staff from party.
  const pty = profile.party as {
    partyMobilePhoneNumber?: string;
    partyDateOfBirth?: string;
    partyNationality?: string;
    partySex?: string;
    partyPostalAddress?: { line1: string; line2?: string; city: string; postalCode: string; countryCode: string };
  } | null | undefined;
  const name   = ag?.customerName ?? profile.name;
  const status = ag?.customerAgreementStatus ?? 'active';
  const hasAddress = ag?.sensitive?.customerAgreementResidentialAddress;
  // v32 (ADR-050): the deprecated document reference is gone; govId below is the source of truth.
  // v27 structured KYC identity (customer self-profile, decrypted by the L2/auditor client).
  const govId      = ag?.customerAgreementGovernmentID;
  const custDob    = ag?.partyDateOfBirth ? new Date(ag.partyDateOfBirth) : null;
  const custDobOk  = custDob && !isNaN(custDob.getTime());
  const govExpiry  = govId?.expiryDate ? new Date(govId.expiryDate) : null;
  const govExpiryOk = govExpiry && !isNaN(govExpiry.getTime());
  const sourceOfFunds = ag?.sensitive?.customerAgreementSourceOfFunds;
  const purpose       = ag?.sensitive?.customerAgreementPurposeOfRelationship;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={User}
        title="My Profile"
        description="Your account and contact details."
        debugInfo="Customer Agreement · PCI DSS: identity · QE at rest"
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
            type="qe-equality"
            collection="party"
            info="Your login email. Encrypted at rest; searchable by exact match (QE:equality)."
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
            <RevealField label="Phone" plainValue={ag.customerMobilePhoneNumber} type="qe-equality" collection="party" info="Your mobile number (GDPR PII). Encrypted at rest; searchable by exact match (QE:equality)." />
          ) : ag ? (
            <>
              <span className="text-gray-500 text-sm">Phone</span>
              <span className="text-gray-400 text-xs italic">{editing ? '' : 'Not on file'}</span>
            </>
          ) : null /* staff: phone rendered from the party record below (no duplicate row) */}

          {/* Account Reference - customers only (staff have no customer agreement) */}
          {ag?.customerAgreementReference ? (
            <RevealField label="Account Reference" plainValue={ag.customerAgreementReference} type="qe-equality" collection="customerAgreementProcedure" info="Your account/agreement reference. Encrypted at rest; searchable by exact match (QE:equality)." />
          ) : ag ? (
            <>
              <span className="text-gray-500 text-sm">Account Reference</span>
              <span className="text-gray-400 text-xs italic">Not on file</span>
            </>
          ) : null}

          {/* Segment / member since - read-only */}
          {ag?.customerSegment && <PlainField label="Account type" value={SEGMENT_LABELS[ag.customerSegment] ?? ag.customerSegment} collection="customerAgreementProcedure" info="Your customer segment (retail, premium, etc.). Stored as plaintext (not sensitive)." />}
          {ag?.customerAgreementEnrollmentDate && <PlainField label="Member since" value={new Date(ag.customerAgreementEnrollmentDate).toLocaleDateString()} collection="customerAgreementProcedure" info="The date your agreement was opened. Stored as plaintext (not sensitive)." />}

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
            <PlainField label="Language" value={ag.customerAgreementPreferredLanguage.toUpperCase()} collection="customerAgreementProcedure" info="Your preferred communication language. Stored as plaintext (not sensitive)." />
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
              info="Your residential address (GDPR PII). Encrypted at rest and not searchable (QE:none); requires Level 2 escalation for staff to reveal."
              plainValue={`${hasAddress.streetAddress}, ${hasAddress.city}, ${hasAddress.postalCode}, ${hasAddress.countryCode}`}
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

          {/* v27 KYC identity attributes (the government identity document itself is grouped in its
              own "Identity document" card below, to avoid a confusing "Government ID no." label when
              the document is e.g. a driver license). */}
          {custDobOk && (
            <RevealField label="Date of birth" plainValue={custDob!.toLocaleDateString()} type="qe-range" collection="party" info="Your date of birth (GDPR PII). Encrypted at rest; supports encrypted range queries (QE:range)." />
          )}
          {ag?.partyNationality && <PlainField label="Nationality" value={countryLabel(ag.partyNationality)} qe="qe-equality" collection="party" info="Your nationality (ISO country code). Encrypted at rest; searchable by exact match (QE:equality)." />}
          {ag?.partyPlaceOfBirth && <PlainField label="Place of birth" value={ag.partyPlaceOfBirth} qe="qe-equality" collection="party" info="City/country where you were born. Encrypted at rest; searchable by exact match (QE:equality)." />}
          {ag?.partySex && <PlainField label="Sex" value={sexLabel(ag.partySex)} qe="qe-equality" collection="party" info="Sex/gender demographic. Encrypted at rest; searchable by exact match (QE:equality)." />}
          {ag?.customerAgreementTaxIDNumber && (
            <RevealField label="Tax ID (TIN)" plainValue={ag.customerAgreementTaxIDNumber} type="qe-prefix" collection="customerAgreementProcedure" info="Your tax identification number. Encrypted at rest; supports encrypted starts-with queries (QE:prefix)." />
          )}
          {ag?.customerAgreementOccupation && <PlainField label="Occupation" value={humanize(ag.customerAgreementOccupation)} qe="qe-equality" collection="customerAgreementProcedure" info="Your declared occupation, collected for KYC. Encrypted at rest; searchable by exact match (QE:equality)." />}
          {sourceOfFunds && <PlainField label="Source of funds" value={humanize(sourceOfFunds)} qe="qe-none" collection="customerAgreementProcedure" info="Declared origin of your funds (AML/KYC). Encrypted at rest and not searchable (QE:none)." />}
          {purpose && <PlainField label="Purpose of relationship" value={humanize(purpose)} qe="qe-none" collection="customerAgreementProcedure" info="Why you opened this account (AML/KYC). Encrypted at rest and not searchable (QE:none)." />}

          {/* Party demographics: shown for staff (no customer agreement), so their profile
              carries the same KYC-typical detail as customers: phone, DOB, nationality, address.
              Phone/DOB/address are GDPR PII (QE-encrypted at rest), shown with a reveal toggle. */}
          {!ag && pty && (() => {
            const dob = pty.partyDateOfBirth ? new Date(pty.partyDateOfBirth) : null;
            const dobValid = dob && !isNaN(dob.getTime());
            const addr = pty.partyPostalAddress;
            const addrFull = addr
              ? [addr.line1, addr.line2, addr.city, addr.postalCode, addr.countryCode].filter(Boolean).join(', ')
              : '';
            return (
              <>
                {pty.partyMobilePhoneNumber && (
                  <RevealField label="Phone" plainValue={pty.partyMobilePhoneNumber} type="qe-equality" collection="party" />
                )}
                {dobValid && (
                  <RevealField label="Date of birth" plainValue={dob!.toLocaleDateString()} type="qe-none" collection="party" />
                )}
                {pty.partyNationality && <PlainField label="Nationality" value={pty.partyNationality} collection="party" />}
                {pty.partySex && <PlainField label="Sex" value={sexLabel(pty.partySex)} qe="qe-equality" collection="party" />}
                {addr && (
                  <RevealField label="Address" plainValue={addrFull} type="qe-none" collection="party" />
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

      {/* Identity document (Government ID) - grouped in its own card so the document number is
          labelled generically ("Document number") alongside its type, rather than the confusing
          "Government ID no." when the document is e.g. a driver license. */}
      {ag && govId?.number && (
        <div className="bg-white rounded-xl border p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <IdCard size={16} className="text-gray-500 shrink-0" />
              <h2 className="font-semibold text-gray-800 text-sm">Identity document</h2>
              <InfoHint text="The government-issued identity document you provided at onboarding (KYC). Each field is encrypted at rest in MongoDB with Queryable Encryption." />
            </div>
            {debugMode && (
              <DebugChip label="customerAgreementGovernmentID" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm items-start">
            {govId?.type && (
              <PlainField label="Document type" value={humanize(govId.type)} qe="qe-equality" collection="customerAgreementProcedure" info="Kind of identity document (passport, national ID, driver license). Encrypted at rest; searchable by exact match (QE:equality)." />
            )}
            {govId?.number ? (
              <RevealField label="Document number" plainValue={govId.number} type="qe-suffix" collection="customerAgreementProcedure" info="The document's number. Encrypted at rest; supports encrypted ends-with queries (QE:suffix)." />
            ) : null}
            {govId?.issuingCountry && (
              <PlainField label="Issuing country" value={countryLabel(govId.issuingCountry)} qe="qe-equality" collection="customerAgreementProcedure" info="Country that issued the document (ISO code). Encrypted at rest; searchable by exact match (QE:equality)." />
            )}
            {govExpiryOk && (
              <PlainField label="Expiry date" value={govExpiry!.toLocaleDateString()} qe="qe-range" collection="customerAgreementProcedure" info="When the document expires. Encrypted at rest; supports encrypted range queries (QE:range)." />
            )}
          </div>
        </div>
      )}

      {/* Legend - only visible in debug mode */}
      {debugMode && (
        <div className="bg-white rounded-xl border p-4 text-sm">
          <p className="font-semibold text-gray-700 mb-2">Field encryption legend</p>
          <div className="space-y-1.5 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <span className="bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-mono shrink-0">QE:equality</span>
              <span>Encrypted in Atlas. Searchable by exact match without server-side decryption.</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-cyan-100 text-cyan-700 border border-cyan-200 px-1.5 py-0.5 rounded font-mono shrink-0">QE:range</span>
              <span>Encrypted in Atlas. Searchable by range (e.g. dates, scores) over ciphertext.</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-indigo-100 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded font-mono shrink-0">QE:prefix</span>
              <span>Encrypted in Atlas. Searchable by starts-with over ciphertext (8.2+).</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-violet-100 text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded font-mono shrink-0">QE:suffix</span>
              <span>Encrypted in Atlas. Searchable by ends-with over ciphertext (8.2+).</span>
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
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldCheck size={16} className="text-gray-500 shrink-0" />
              <h2 className="font-semibold text-gray-800 text-sm">Identity Verification (KYC)</h2>
            </div>
            {debugMode && (
              <DebugChip label="BQ:Step · KycCheck · PCI DSS" />
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
            {/* v27 provider verdicts (HRP screening): risk score QE:range; rating / PEP / sanctions QE:equality. */}
            {typeof ag.customerAgreementKycCheck.customerAgreementKycCheckRiskScore === 'number' && (
              <PlainField label="Risk score" value={`${ag.customerAgreementKycCheck.customerAgreementKycCheckRiskScore} / 100`} qe="qe-range" collection="customerAgreementProcedure" info="Screening risk score (0-100) from KYC/AML checks. Encrypted at rest; supports encrypted range queries (QE:range)." />
            )}
            {ag.customerAgreementKycCheck.customerAgreementKycCheckRiskRating && (
              <PlainField label="Risk rating" value={humanize(ag.customerAgreementKycCheck.customerAgreementKycCheckRiskRating)} qe="qe-equality" collection="customerAgreementProcedure" info="Overall risk band (low / medium / high). Encrypted at rest; searchable by exact match (QE:equality)." />
            )}
            {typeof ag.customerAgreementKycCheck.customerAgreementKycCheckPepStatus === 'boolean' && (
              <PlainField label="PEP status" value={ag.customerAgreementKycCheck.customerAgreementKycCheckPepStatus ? 'Yes' : 'No'} qe="qe-equality" collection="customerAgreementProcedure" info="Whether you are a Politically Exposed Person. Encrypted at rest; searchable by exact match (QE:equality)." />
            )}
            {ag.customerAgreementKycCheck.customerAgreementKycCheckSanctionsResult && (
              <PlainField label="Sanctions result" value={humanize(ag.customerAgreementKycCheck.customerAgreementKycCheckSanctionsResult)} qe="qe-equality" collection="customerAgreementProcedure" info="Result of sanctions-list screening (clear / hit / pending). Encrypted at rest; searchable by exact match (QE:equality)." />
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

      {/* Credentials live at the identity service, which is the only place a password is entered. */}
      {(profile.domain === 'leafypay' || profile.domain === 'local') && (
        <div className="bg-white rounded-xl border p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <KeyRound size={16} className="text-gray-500 shrink-0" />
              <h2 className="font-semibold text-gray-800 text-sm">Password and sign-in</h2>
            </div>
            <a
              href={`${AUTHORITY_UI_PUBLIC_URL}/profile/credentials`}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 flex items-center gap-1.5"
            >
              <ExternalLink size={13} /> Manage credentials
            </a>
          </div>
          <p className="text-xs text-gray-500">
            Your password and your authenticators are held by the identity service, not by this
            application. This application never receives a credential, which is why changing one
            happens there.
          </p>
        </div>
      )}

      {/* OAuth Authorized Apps: visible to any user; shows granted consent via OIDC */}
      {(grants.length > 0 || grantsLoading) && (
        <div className="bg-white rounded-xl border p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Layers size={16} className="text-gray-500 shrink-0" />
              <h2 className="font-semibold text-gray-800 text-sm">Authorized Applications</h2>
            </div>
            {debugMode && (
              <DebugChip label="ConsentGrant · OAuth 2.0 · OIDC" />
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

      {/* Passwordless credentials link (full management at /system/profile/credentials). */}
      <Link href="/system/profile/credentials"
        className="bg-white rounded-xl border p-5 flex items-center justify-between hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-[#00684A]/10 text-[#00684A] flex items-center justify-center shrink-0" style={{ width: 40, height: 40 }}>
            <KeyRound size={18} />
          </span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-semibold text-gray-800 text-sm">Credentials</h2>
              {debugMode && <DebugChip label="partyEnrolledCredential · CIBA · PCI DSS" />}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Security keys for passwordless sign-in. Enroll, rotate and revoke your devices.</p>
          </div>
        </div>
        <ChevronRight size={18} className="text-gray-400 shrink-0" />
      </Link>

      {/* Payment-card management lives in its own section: /system/cards . */}

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
              description: 'login identity, role, QE:equality (email), bcrypt hash',
            },
            ...(profile.partyInstanceReference ? [{
              kind: 'mongo' as const,
              collection: 'party',
              id: profile.partyInstanceReference,
              label: 'party',
              labelColor: 'text-emerald-400',
              description: 'PII store - QE:equality (email, phone) + plaintext (name, segment)',
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
