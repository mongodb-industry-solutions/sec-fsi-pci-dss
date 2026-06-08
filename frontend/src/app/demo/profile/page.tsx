'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { ROLE_LABELS } from '../../../lib/constants';
import { useDebugMode } from '../../../lib/debugMode';
import { Eye, EyeOff, Pencil, Save, X, Lock, ShieldCheck } from 'lucide-react';
import { RawMongoPanel } from '../../../components/RawMongoPanel';

interface ProfileData {
  sub: string;
  email: string;
  name: string;
  role: string;
  domain: string;
  agreement: {
    customerAgreementInstanceReference?: string;
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
      <div className="flex items-center gap-2">
        <span className={`text-sm font-mono transition-all ${revealed ? 'text-gray-900' : 'text-gray-400 select-none'}`}>
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
      <span className="text-sm text-gray-900">{value}</span>
    </>
  );
}

export default function ProfilePage() {
  const { debugMode } = useDebugMode();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState('');

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
    if (!profile?.agreement) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const patch: Parameters<typeof api.auth.updateMe>[0] = {};
      if (editName.trim())  patch.customerName = editName.trim();
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
  const name   = ag?.customerName ?? profile.name;
  const status = ag?.customerAgreementStatus ?? 'active';
  const hasAddress = ag?.sensitive?.customerAgreementResidentialAddress;
  const hasGovId   = ag?.sensitive?.governmentIdentificationReference;

  return (
    <div className="max-w-xl mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Profile</h1>
        {ag && !editing && (
          <button
            onClick={() => { setEditing(true); setSaveMsg(null); }}
            className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium"
          >
            <Pencil size={14} />
            Edit Profile
          </button>
        )}
      </div>

      {saveMsg && (
        <div className={`rounded-xl p-3 text-sm ${saveMsg.startsWith('Error') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          {saveMsg}
        </div>
      )}

      {/* Identity card — inline editable */}
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
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </span>
              <span className="text-xs bg-blue-500/10 text-blue-700 px-2 py-0.5 rounded">
                {ROLE_LABELS[profile.role] ?? profile.role}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-4 items-start">

          {/* Email — always read-only (login identity) */}
          <RevealField
            label="Email"
            plainValue={ag?.customerEmailAddress ?? profile.email}
            maskedValue={(() => { const e = ag?.customerEmailAddress ?? profile.email; const [l, d] = e.split('@'); return (l?.slice(0,2) ?? '') + '●●●' + '@' + (d ?? '●●●'); })()}
            type="qe-equality"
            collection="customerAgreementProcedure"
          />

          {/* Phone — editable */}
          {editing ? (
            <>
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-gray-500 text-sm">Phone</span>
                {debugMode && (
                  <span className="flex items-center gap-1 bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-mono text-xs">
                    <Lock size={9} /> QE:equality
                  </span>
                )}
                {debugMode && <CollectionChip name="customerAgreementProcedure" />}
              </div>
              <input
                value={editPhone}
                onChange={e => setEditPhone(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-[#001E2B] focus:ring-1 focus:ring-[#001E2B]/20"
                placeholder="+1-555-0000"
              />
            </>
          ) : ag?.customerMobilePhoneNumber ? (
            <RevealField label="Phone" plainValue={ag.customerMobilePhoneNumber} maskedValue={maskPhone(ag.customerMobilePhoneNumber)} type="qe-equality" collection="customerAgreementProcedure" />
          ) : (
            <>
              <span className="text-gray-500 text-sm">Phone</span>
              <span className="text-gray-400 text-xs italic">{editing ? '' : 'Not on file'}</span>
            </>
          )}

          {/* Account Reference — read-only */}
          {ag?.customerAgreementReference ? (
            <RevealField label="Account Reference" plainValue={ag.customerAgreementReference} maskedValue={maskAccountRef(ag.customerAgreementReference)} type="qe-equality" collection="customerAgreementProcedure" />
          ) : (
            <>
              <span className="text-gray-500 text-sm">Account Reference</span>
              <span className="text-gray-400 text-xs italic">Not on file</span>
            </>
          )}

          {/* Segment / member since — read-only */}
          {ag?.customerSegment && <PlainField label="Account type" value={SEGMENT_LABELS[ag.customerSegment] ?? ag.customerSegment} collection="customerAgreementProcedure" />}
          {ag?.customerAgreementEnrollmentDate && <PlainField label="Member since" value={new Date(ag.customerAgreementEnrollmentDate).toLocaleDateString()} collection="customerAgreementProcedure" />}

          {/* Language — editable */}
          {editing ? (
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

          {/* Address — editable (QE:none) */}
          {editing ? (
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

          {/* Government ID — read-only */}
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

          {/* Inline Save / Cancel — only when editing */}
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

      {/* Legend — only visible in debug mode */}
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

      {/* Data protection notice */}
      <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-xl p-4 text-sm text-gray-600">
        <p className="font-semibold text-[#001E2B] mb-1">Data protection</p>
        Sensitive fields are stored encrypted using MongoDB Queryable Encryption. They are never
        accessible in plaintext to database administrators or support staff.
      </div>

      {/* Debug: raw MongoDB documents via RawMongoPanel */}
      {debugMode && profile?.agreement?.customerAgreementInstanceReference && (
        <RawMongoPanel
          token={token}
          sections={[
            {
              kind: 'mongo' as const,
              collection: 'customerAgreementProcedure',
              id: profile.agreement.customerAgreementInstanceReference,
              label: 'customerAgreementProcedure',
              labelColor: 'text-blue-400',
              description: 'QE:equality (accountRef) + QE:none (address, govId) inline — v2 unified document',
            },
          ]}
        />
      )}

      {/* QE field definition reference — same style as RawMongoPanel, debug only */}
      {debugMode && (
        <div className="rounded-xl overflow-hidden border border-[#00ED64]/20">

          {/* Header — identical to RawMongoPanel header */}
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

          {/* Three code sections + comparison table — all accordion rows */}
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
              desc: 'Not listed in encryptedFieldsMap. Atlas stores the raw value — readable without any key.',
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

          {/* Comparison table — accordion row */}
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
