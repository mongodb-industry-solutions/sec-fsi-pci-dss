// BIAN SD-16: Party Authentication - Authentication Domain configuration records

export const AUTHENTICATION_DOMAIN_COLLECTION = 'authenticationDomain';

export type AuthDomainType = 'local' | 'oidc' | 'saml';
export type AuthDomainName = 'local' | 'msentra' | 'bigid';

export interface AuthenticationDomainRecord {
  partyAuthenticationDomainInstanceReference: string;
  /** Unique slug used in login requests and JWT domain claim */
  partyAuthenticationDomainName: AuthDomainName;
  /** Human-readable label shown in the UI domain selector */
  partyAuthenticationDomainDisplayName: string;
  /** Protocol used by this domain */
  partyAuthenticationDomainType: AuthDomainType;
  /** Only enabled domains are surfaced to the UI */
  partyAuthenticationDomainEnabled: boolean;
  /** Provider-specific configuration (tenant, client ID, scopes, etc.) */
  partyAuthenticationDomainConfiguration: Record<string, unknown>;
  bianServiceDomain: 'PartyAuthentication';
  bianControlRecordType: 'AuthenticationDomain';
  recordCreatedDateTime: Date;
  schemaVersion: number;
}
