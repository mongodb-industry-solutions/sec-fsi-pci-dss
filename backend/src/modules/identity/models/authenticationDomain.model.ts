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
  /** Optional banner shown in the login UI for this domain (e.g. "not yet active in this build") */
  partyAuthenticationDomainAlertMessage?: string;
  /** Provider-specific configuration (tenant, client ID, scopes, etc.) */
  partyAuthenticationDomainConfiguration: Record<string, unknown>;
  bianServiceDomain: 'PartyAuthentication';
  bianControlRecordType: 'AuthenticationDomain';
  recordCreatedDateTime: Date;
  schemaVersion: number;
}
