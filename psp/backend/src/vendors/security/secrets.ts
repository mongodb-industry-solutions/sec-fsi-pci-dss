import { createHash } from 'crypto';

/**
 * One configured secret, four independent signing keys.
 *
 * `PSP_JWT_SECRET` used to sign and verify everything: the browser session, a case escalation, the
 * platform administrative token, the enrolment challenge, and, through a derivation, the bank's own
 * access tokens. Anything able to mint one of those could mint all of them, so the boundaries between
 * them were decorative: a session token and an escalation capability were the same credential wearing
 * different claims.
 *
 * Domain separation fixes that without asking a deployment to configure four values. Each purpose
 * derives its own key from the configured root, and a token signed for one purpose fails the
 * signature check of every other. A deployment that wants genuinely independent keys sets the
 * per-purpose variable and the root is never consulted for it.
 *
 * The derivation is one way, so holding a purpose key does not yield the root or any sibling key.
 */

const ROOT_DEFAULT = 'demo-local-secret-change-in-production';

function pspEnv(name: string): string | undefined {
  return process.env[`PSP_${name}`] ?? process.env[name];
}

function root(): string {
  return pspEnv('JWT_SECRET') ?? ROOT_DEFAULT;
}

/** Domain-separated derivation: the purpose is part of the input, so no two purposes collide. */
export function deriveKey(purpose: string, secret: string): string {
  return createHash('sha256').update(`${purpose}:${secret}`).digest('hex');
}

/**
 * The browser session.
 *
 * Read on every authenticated request, so it is the key most exposed to a verification bug, and the
 * one that must not also authorise anything privileged.
 */
export function sessionSecret(): string {
  return pspEnv('SESSION_SECRET') ?? deriveKey('psp:session', root());
}

/**
 * A case escalation: a short-lived, case-scoped capability.
 *
 * Separate from the session on purpose. These grant more than a session does, and a session token
 * able to pass as one is the privilege escalation the name warns about.
 */
export function escalationSecret(): string {
  return pspEnv('ESCALATION_SECRET') ?? deriveKey('psp:escalation', root());
}

/** The platform administrative token, for the operational surface. */
export function adminSecret(): string {
  return pspEnv('ADMIN_SECRET') ?? deriveKey('psp:admin', root());
}

/** The enrolment challenge, which binds a device registration to one attempt. */
export function enrollmentSecret(): string {
  return pspEnv('ENROLLMENT_SECRET') ?? deriveKey('psp:enrollment', root());
}

/**
 * The credential the PSP presents to the BANK's own diagnostics surface.
 *
 * It is the bank's key, held here the way any client holds a credential for a service it calls, and
 * it is deliberately not derived from this platform's root: the bank derives it from its own. That
 * is the whole point of the separation. The two sides agree on it through configuration, which is
 * what a credential is, rather than through both reading one platform-wide secret, which is what an
 * identity would be.
 */
export function bankcoreAdminCredential(): string {
  return pspEnv('BANKCORE_ADMIN_SECRET')
    ?? deriveKey('bankcore:admin', pspEnv('BANKCORE_SECRET') ?? 'bankcore-local-secret-change-in-production');
}
