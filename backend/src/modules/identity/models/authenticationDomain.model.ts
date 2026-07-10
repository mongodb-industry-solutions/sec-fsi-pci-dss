// BIAN SD-16: Party Authentication - Authentication Domain configuration records

export const AUTHENTICATION_DOMAIN_COLLECTION = 'authenticationDomain';

export type AuthDomainType = 'local' | 'oidc' | 'saml';
export type AuthDomainName = 'local' | 'msentra' | 'bigid';
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
