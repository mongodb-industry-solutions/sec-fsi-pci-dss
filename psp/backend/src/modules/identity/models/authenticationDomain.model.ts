// Party Authentication - Authentication Domain configuration records

export const AUTHENTICATION_DOMAIN_COLLECTION = 'authenticationDomain';

// The PROTOCOL a domain authenticates with. `local` here means a password this platform holds, as opposed
// to a federated one, and it is deliberately NOT renamed: it names the mechanism, not the realm.
export type AuthDomainType = 'local' | 'oidc' | 'saml';

// The REALM a user belongs to. Customers and employees are both LeafyPay users, so this is the platform
// realm rather than a staff one, and v37 renamed it from `local` to say so: a realm called `local` reads as
// "wherever this is deployed" instead of naming the institution whose users these are.
export type AuthDomainName = 'leafypay' | 'msentra' | 'bigid';

/** The platform realm. Referenced rather than spelled out, so it cannot drift between call sites. */
export const PLATFORM_AUTH_DOMAIN: AuthDomainName = 'leafypay';

// What `local` still means on the wire. External clients, saved bookmarks and anything integrated before
// the rename may still send it, and login compares the request against the stored domain, so an unmapped
// alias would reject a correct password with "invalid credentials". Kept as an alias rather than a second
// realm: there is one realm, under two names.
const WIRE_ALIASES: Record<string, AuthDomainName> = { local: PLATFORM_AUTH_DOMAIN };

/**
 * Resolves whatever a caller sent to the realm it means. An unknown value is returned untouched, so it
 * fails the domain comparison the same way it did before rather than being silently coerced to the
 * platform realm.
 */
export function resolveAuthDomainName(sent: string | undefined | null): string | undefined {
  if (sent === undefined || sent === null || sent === '') return undefined;
  return WIRE_ALIASES[sent] ?? sent;
}
/** OAuth/SSO flow type: determines whether the UI shows a credential form or redirects */
export type AuthDomainFlowType = 'client_credentials' | 'authorization_code' | 'saml' | 'oidc';

export interface AuthenticationDomainRecord {
  partyAuthenticationDomainInstanceReference: string;
  /** Unique slug used in login requests and JWT domain claim */
  partyAuthenticationDomainName: AuthDomainName;
  /** Human-readable label shown in the UI domain selector */
  partyAuthenticationDomainDisplayName: string;
  /** Protocol used by this domain */
  partyAuthenticationDomainType: AuthDomainType;
  /** OAuth/SSO flow  -  client_credentials shows username+password; others show a redirect button */
  partyAuthenticationDomainFlowType?: AuthDomainFlowType;
  /** Only enabled domains are surfaced to the UI */
  partyAuthenticationDomainEnabled: boolean;
  /**
   * Self-registration (local domains only): when true, the login screen shows a "Register" link
   * that opens the public account-registration form for this domain. Absent/false = disabled.
   */
  partyAuthenticationDomainSelfRegistrationEnabled?: boolean;
  /**
   * Auto-approval policy for self-registration: when true, a self-registered account is created
   * `active` and can log in immediately; when false/absent it is created `pending` and a manager
   * must approve it. Note: this only gates login access, NOT KYC (a separate process).
   */
  partyAuthenticationDomainSelfRegistrationAutoApprove?: boolean;
  /** Optional banner shown in the login UI for this domain (e.g. "not yet active in this build") */
  partyAuthenticationDomainAlertMessage?: string;
  /** Provider-specific configuration (tenant, client ID, scopes, etc.) */
  partyAuthenticationDomainConfiguration: Record<string, unknown>;
  /**
   * ADR-030: for remote (OIDC/SAML) domains, maps an external IdP claim/group to a local role
   * (E4, plan §13.3). Local domains manage users directly instead. Roles are global (`role`
   * collection). Ignored for `type: 'local'`.
   */
  partyAuthenticationDomainRoleMappings?: Array<{ externalClaimOrGroup: string; roleName: string }>;
  bianServiceDomain: 'PartyAuthentication';
  bianControlRecordType: 'AuthenticationDomain';
  recordCreatedDateTime: Date;
  schemaVersion: number;
}
