'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Landmark, ChevronRight, CreditCard, ShieldCheck, Users, BellRing, ScrollText, FileSearch } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { getToken } from '../../../../../lib/auth';

// The administration panel of a subsystem, not a generic "administer any bank" surface.
//
// A fixed path is correct here rather than a limitation: administering a bank's internals is something this
// bank offers because it is our own. A real institution exposes Open Banking APIs and nothing else, so there
// is no generic surface to build, and parameterising this route would invent a pattern the domain does not
// have. Operation ROUTING stays registry driven and names no bank in code; this panel is specific to the bank
// that happens to expose one, and confusing the two in either direction is the failure mode.
//
// Every request goes to the PSP, which dispatches to the bank. The browser keeps one origin, one token and no
// preflight, and a test fails any frontend source that targets the bank directly.

type Health = 'ok' | 'degraded' | 'unreachable' | 'disabled' | 'misconfigured' | 'unknown';

interface ServiceState {
  name?: string;
  status?: Health;
  detail?: string;
  baseUrl?: string;
}

const HEALTH_STYLE: Record<Health, string> = {
  ok: 'bg-[#00684A]/10 text-[#00684A] border-[#00684A]/20',
  degraded: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  unreachable: 'bg-red-500/10 text-red-700 border-red-500/20',
  disabled: 'bg-gray-200 text-gray-600 border-gray-300',
  misconfigured: 'bg-red-500/10 text-red-700 border-red-500/20',
  unknown: 'bg-gray-100 text-gray-500 border-gray-200',
};

// Its own capabilities, reusing the pages that already exist. Only the mount point and the target change:
// forking a parallel surface for the bank would double every screen for no gain.
const CAPABILITIES = [
  { key: 'card-issuer', label: 'Card Issuer', icon: CreditCard, description: 'The PAN vault, the issued-card registry, validation rules and per-card limits.' },
  { key: 'card-authorization', label: 'Card Authorisation', icon: ShieldCheck, description: 'The authorisation hold, and the response codes it answers with.' },
  { key: 'account-information', label: 'Account Information', icon: Users, description: 'Accounts, balances and transactions, as the standard exposes them.' },
  { key: 'credit-bureau', label: 'Credit Bureau', icon: FileSearch, description: 'The assessment this bank makes of the parties it banks, and its scoring rules.' },
];

// Bank-level administration, which has no PSP equivalent: these are the bank's own records.
const BANK_ADMIN = [
  { resource: 'tpp/registrations', label: 'Third-party registrations', icon: Users, description: 'Which clients may reach the banking API, with their scopes and roles.' },
  { resource: 'consents', label: 'Consents', icon: ScrollText, description: 'Account access agreements and their status, including the manual authorisation path.' },
  { resource: 'tpp/deliveries', label: 'Notification deliveries', icon: BellRing, description: 'One row per delivery attempt, so a notification that never arrived is visible.' },
  { resource: 'audit', label: 'Audit trail', icon: FileSearch, description: 'Every request the bank answered: who asked, of what, under which consent, and the outcome.' },
];

function HealthBadge({ status, detail }: { status: Health; detail?: string }) {
  return (
    <span
      title={detail}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${HEALTH_STYLE[status]}`}
    >
      {status}
    </span>
  );
}

export default function BankcorePanelPage() {
  const [service, setService] = useState<ServiceState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    fetch('/api/v1/system/services', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body) => setService((body.results ?? [])[0] ?? null))
      // A failed probe is reported as unknown rather than as healthy: showing `ok` because the check itself
      // failed is the one answer this badge must never give.
      .catch(() => setService({ status: 'unknown', detail: 'the health probe could not be reached' }))
      .finally(() => setLoading(false));
  }, []);

  const status: Health = (service?.status as Health) ?? 'unknown';

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={Landmark}
        title="Bankcore"
        description="The bank's own administration. Its capabilities and its records, reached through the payment service provider."
      />

      {/* Health at the entry, so a bank that is down is visible here and not only on opening a capability. */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-gray-800 text-sm">Service</p>
              {loading ? (
                <span className="text-[10px] uppercase tracking-wide text-gray-400">checking</span>
              ) : (
                <HealthBadge status={status} detail={service?.detail} />
              )}
            </div>
            <p className="text-xs text-gray-500">
              {service?.detail ?? 'The bank runs as its own service with its own database.'}
            </p>
          </div>
          <Link href="/system/admin/setup-logs" className="text-xs text-[#016BF8] hover:underline">
            Logs
          </Link>
        </div>
      </div>

      {status === 'disabled' && (
        // A bank that is switched off is not a bank that is broken, and the panel says which.
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-600">
          The bank is switched off, so its capabilities are served by the provider&apos;s built-in engines. Nothing
          below will answer until it is enabled.
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Capabilities</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CAPABILITIES.map((c) => (
            <Link
              key={c.key}
              href={`/system/admin/modules/${c.key}`}
              className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-[#001E2B]/30 hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <c.icon size={18} className="text-[#001E2B]" />
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{c.label}</p>
                    <p className="text-xs text-gray-500">{c.description}</p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-gray-400" />
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Bank administration</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {BANK_ADMIN.map((item) => (
            <Link
              key={item.resource}
              href={`/system/admin/modules/bankcore/${encodeURIComponent(item.resource)}`}
              className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-[#001E2B]/30 hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <item.icon size={18} className="text-[#001E2B]" />
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{item.label}</p>
                    <p className="text-xs text-gray-500">{item.description}</p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-gray-400" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
