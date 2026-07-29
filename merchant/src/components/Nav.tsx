// Server component: reads the session + scopes, then renders the client NavBar.
// Scope-gated links degrade gracefully (E-12); profile menu shows only when signed in.
import { getSession, hasScope } from '@/lib/session';
import NavBar, { type NavLink } from './NavBar';
import { BRAND } from '@/lib/brand';

export default async function Nav() {
  const session = await getSession();

  const all: (NavLink & { show: boolean })[] = [
    { href: '/products', label: 'Shop', icon: 'products', tip: `Browse the catalogue, one product per ${BRAND.full} payment method.`, show: true },
    { href: '/beneficiaries', label: 'Beneficiaries', icon: 'beneficiaries', tip: 'People and accounts you can pay. Identifiers are always masked.', show: hasScope(session, 'read:beneficiaries') },
    { href: '/transfers', label: 'Transfers', icon: 'transfers', tip: 'Send a bank transfer (ACH / SEPA / SWIFT) on your behalf.', show: hasScope(session, 'write:transfers') },
    { href: '/accounts', label: 'Accounts', icon: 'accounts', tip: 'Your payout accounts with masked IBAN only.', show: hasScope(session, 'read:accounts') },
    { href: '/history', label: 'History', icon: 'history', tip: 'Your payments and transfers with status and fees.', show: hasScope(session, 'read:transactions') },
    { href: '/help', label: 'Help', icon: 'help', tip: `How this integration works and why ${BRAND.full} / MongoDB.`, show: true },
  ];

  const user = session
    ? {
        name: session.name ?? session.email ?? session.sub,
        email: session.email,
        merchant: 'Espresso Works',
      }
    : null;

  return <NavBar links={all.filter((l) => l.show)} user={user} />;
}
