// Help (demo explainer): what this integration is, HOW it was built, and WHY Sec4 Pay / MongoDB.
import Link from 'next/link';
import {
  KeyRound, ShieldCheck, Database, Zap, Store, ServerCog, Link2, CreditCard, Repeat, UserCheck,
  Percent, Lock, Search, ArrowRight, LifeBuoy, BookOpen, FileCode, ExternalLink,
} from 'lucide-react';
import { Chip } from '@/components/ui/Bits';
import { Tip } from '@/components/ui/Tooltip';
import { ENV } from '@/lib/env';
import { BRAND } from '@/lib/brand';

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5 transition duration-200 hover:-translate-y-0.5 hover:border-leaf/40">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-leaf/10 text-leaf-deep ring-1 ring-leaf/20">{icon}</span>
        <h3 className="font-semibold text-ink">{title}</h3>
      </div>
      <div className="mt-3 text-sm text-muted">{children}</div>
    </div>
  );
}

export default function HelpPage() {
  const wikiUrl = ENV.wikiUrl();
  const apiDocsUrl = ENV.apiDocsUrl();
  return (
    <div className="space-y-10">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <LifeBuoy className="h-6 w-6 text-leaf-deep" aria-hidden /> How this demo works
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Espresso Works is an <b>external</b> storefront. It has no database and never touches card data. Everything
          runs through the {BRAND.full} PSP over OAuth2/OIDC and its API.
        </p>
      </header>

      {/* Flow diagram */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">The integration at a glance</h2>
        <div className="glass flex flex-col items-stretch gap-3 rounded-2xl p-5 sm:flex-row sm:items-center">
          <div className="flex flex-1 flex-col items-center rounded-xl bg-brand-soft p-4 text-center ring-1 ring-line">
            <Store className="h-6 w-6 text-brand" aria-hidden />
            <p className="mt-2 text-sm font-medium text-ink">Espresso Works</p>
            <p className="text-xs text-muted">External merchant app · no DB</p>
          </div>
          <div className="flex items-center justify-center text-muted">
            <div className="text-center">
              <ArrowRight className="mx-auto h-5 w-5" aria-hidden />
              <span className="text-[10px] uppercase tracking-wide">OAuth SSO + API</span>
            </div>
          </div>
          <div className="flex flex-1 flex-col items-center rounded-xl bg-gradient-to-br from-leaf-ink to-[#04322c] p-4 text-center text-white ring-1 ring-leaf/30">
            <ShieldCheck className="h-6 w-6 text-leaf" aria-hidden />
            <p className="mt-2 text-sm font-medium">{BRAND.full} PSP</p>
            <p className="text-xs text-white/70">Auth · payments · balances</p>
          </div>
          <div className="flex items-center justify-center text-muted">
            <div className="text-center">
              <ArrowRight className="mx-auto h-5 w-5" aria-hidden />
              <span className="text-[10px] uppercase tracking-wide">Encrypted</span>
            </div>
          </div>
          <div className="flex flex-1 flex-col items-center rounded-xl bg-surface-alt p-4 text-center">
            <Database className="h-6 w-6 text-leaf-deep" aria-hidden />
            <p className="mt-2 text-sm font-medium text-ink">MongoDB</p>
            <p className="text-xs text-muted">Queryable Encryption</p>
          </div>
        </div>
      </section>

      {/* HOW it was built */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">How it was built</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card icon={<KeyRound className="h-5 w-5" aria-hidden />} title="OAuth2 / OIDC SSO with PKCE">
            You sign in on {BRAND.full}, not here. We use the authorization-code flow with{' '}
            <Tip label="Proof Key for Code Exchange: protects the code exchange without a client secret in the browser."><span className="cursor-help font-medium text-leaf-deep underline">PKCE</span></Tip>{' '}
            and granular consent. The merchant only receives an encrypted session cookie, never your password or card.
          </Card>
          <Card icon={<ServerCog className="h-5 w-5" aria-hidden />} title="No local database">
            There is no merchant DB. Every screen is rendered from live PSP API calls, server-side. Tokens stay on the
            server; the browser only ever sees an <code className="font-mono">httpOnly</code> encrypted cookie.
          </Card>
          <Card icon={<CreditCard className="h-5 w-5" aria-hidden />} title="Three payment methods">
            <ul className="space-y-1">
              <li className="flex items-center gap-2"><Link2 className="h-4 w-4 text-muted" aria-hidden /> <b>Payment Link</b>: shareable hosted page.</li>
              <li className="flex items-center gap-2"><ArrowRight className="h-4 w-4 text-muted" aria-hidden /> <b>Redirect checkout</b>: PSP captures the card.</li>
              <li className="flex items-center gap-2"><ServerCog className="h-4 w-4 text-muted" aria-hidden /> <b>API payment</b>: server-to-server on a tokenised card.</li>
              <li className="flex items-center gap-2"><Repeat className="h-4 w-4 text-muted" aria-hidden /> <b>Subscription</b>: recurring redirect checkout.</li>
            </ul>
          </Card>
          <Card icon={<UserCheck className="h-5 w-5" aria-hidden />} title="On-behalf-of endpoints">
            Beneficiaries, accounts, transfers and history are fetched with your access token, bound to your identity
            (<code className="font-mono">token.sub</code>). The merchant can only act for the signed-in user, and only
            for the scopes you granted.
          </Card>
          <Card icon={<Percent className="h-5 w-5" aria-hidden />} title="Commission model">
            Each sale carries a merchant commission (display-only here, e.g. 2.5%). The PSP is the source of truth for
            fees and settlement; the merchant just shows the number for transparency.
          </Card>
          <Card icon={<Lock className="h-5 w-5" aria-hidden />} title="Data minimisation">
            Sensitive identifiers (PAN, IBAN) never reach the merchant in clear; they arrive masked. That keeps this app
            in <Chip tone="accent">PCI DSS SAQ A</Chip> scope.
          </Card>
        </div>
      </section>

      {/* WHY Sec4 Pay / MongoDB */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Why {BRAND.full} &amp; MongoDB</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card icon={<ShieldCheck className="h-5 w-5" aria-hidden />} title="Secure, PCI-aligned PSP">
            Card data and balances stay inside {BRAND.full}. The merchant offloads compliance scope and never stores
            cardholder data.
          </Card>
          <Card icon={<Lock className="h-5 w-5" aria-hidden />} title="Queryable Encryption">
            Sensitive fields are encrypted at rest <i>and</i> remain queryable, so investigators can search encrypted PAN
            or IBAN without ever exposing plaintext.
          </Card>
          <Card icon={<Database className="h-5 w-5" aria-hidden />} title="Single data layer">
            Identity, payments, transfers and audit all live in one MongoDB model (BIAN-aligned), so there is no brittle
            sync between siloed systems.
          </Card>
          <Card icon={<Zap className="h-5 w-5" aria-hidden />} title="Fast to integrate">
            A brand-new external app like this one talks to the PSP with standard OAuth + REST, so the whole storefront is
            a thin, database-free client.
          </Card>
        </div>
      </section>

      {/* Documentation & references */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Documentation &amp; references</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href={wikiUrl} target="_blank" rel="noopener noreferrer"
            className="glass rounded-2xl p-5 transition duration-200 hover:-translate-y-0.5 hover:border-leaf/40 block">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-leaf/10 text-leaf-deep ring-1 ring-leaf/20"><BookOpen className="h-5 w-5" aria-hidden /></span>
              <h3 className="font-semibold text-ink flex items-center gap-1.5">Wiki <ExternalLink className="h-3.5 w-3.5 text-muted" aria-hidden /></h3>
            </div>
            <p className="mt-3 text-sm text-muted">Architecture, BIAN mapping, datasets and end-user guides for the whole demo.</p>
          </a>
          <a href={apiDocsUrl} target="_blank" rel="noopener noreferrer"
            className="glass rounded-2xl p-5 transition duration-200 hover:-translate-y-0.5 hover:border-leaf/40 block">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-leaf/10 text-leaf-deep ring-1 ring-leaf/20"><FileCode className="h-5 w-5" aria-hidden /></span>
              <h3 className="font-semibold text-ink flex items-center gap-1.5">API (Swagger) <ExternalLink className="h-3.5 w-3.5 text-muted" aria-hidden /></h3>
            </div>
            <p className="mt-3 text-sm text-muted">Interactive OpenAPI docs for the {BRAND.full} PSP API this storefront integrates with.</p>
          </a>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-alt p-5">
        <Search className="h-5 w-5 text-leaf-deep" aria-hidden />
        <p className="flex-1 text-sm text-muted">Ready to try it? Head to the shop and pay with any of the four methods.</p>
        <Link href="/products" className="btn-primary text-sm">
          Go to shop <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </section>
    </div>
  );
}
