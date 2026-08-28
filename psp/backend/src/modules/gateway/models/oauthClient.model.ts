/**
 * The OAuth client registry, as a collection of its own.
 *
 * It used to be a sub-document inside the merchant's commercial agreement, which coupled two things
 * that have nothing to do with each other: a credential the authorization server verifies on every
 * token request, and a commercial record the gateway module owns. Every consumer of the credential
 * had to know the shape of the agreement to reach it, and the client lifecycle could not move
 * anywhere without taking the merchant record with it.
 *
 * Field names are unchanged from the embedded configuration on purpose. This step decouples WHERE the
 * record lives, and nothing else; renaming to the standard's vocabulary belongs to the step that
 * moves it to the identity authority, and doing both at once would make a mechanical change
 * unreviewable.
 */
export const OAUTH_CLIENT_COLLECTION = 'oauthClient';

// The CIBA grant is the full URN, spec-faithful.
export type OAuthGrantType =
  | 'authorization_code'
  | 'client_credentials'
  | 'refresh_token'
  | 'urn:openid:params:grant-type:ciba';

// poll is the mandatory baseline; ping and push add client notification.
export type OAuthBackchannelDeliveryMode = 'poll' | 'ping' | 'push';

export interface OAuthClientRecord {
  oauthClientId: string;
  /** bcrypt(12). The plaintext is shown once and never stored. */
  oauthClientSecretHash: string;
  oauthClientSecretPrefix: string;
  oauthRedirectUris: string[];
  oauthGrantTypes: OAuthGrantType[];
  oauthScopes: string[];
  oauthClientStatus: 'active' | 'suspended' | 'revoked';
  oauthClientCreatedDateTime: Date;
  oauthTokenLifetimeSeconds: number;
  oauthRefreshTokenLifetimeDays: number;
  oauthRequirePkce: boolean;
  oauthPostLogoutRedirectUris?: string[];
  oauthClaimMapping?: Record<string, string>;
  oauthLogoUri?: string;
  oauthClientUri?: string;
  oauthBackchannelTokenDeliveryMode?: OAuthBackchannelDeliveryMode;
  /** HTTPS only, and required when the delivery mode is ping or push. */
  oauthBackchannelClientNotificationEndpoint?: string;

  /**
   * The commercial record this client belongs to.
   *
   * The only back-reference, and it is one way: the client knows its owner, the owner does not embed
   * the client. That direction is what lets the registry move without the merchant record moving.
   */
  merchantAgreementInstanceReference: string;
  /**
   * Denormalized at registration.
   *
   * The audit trail names the party a token was issued to, and looking it up meant the identity
   * module querying a commercial collection on a hot path. Copying the display name removes that
   * dependency entirely, which is what makes the audit code portable.
   */
  merchantName?: string;

  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

/** Everything safe to return over the API: the secret hash is never one of them. */
export type OAuthClientPublic = Omit<OAuthClientRecord, 'oauthClientSecretHash'>;

export function toPublicClient(record: OAuthClientRecord): OAuthClientPublic {
  const { oauthClientSecretHash: _secret, ...rest } = record;
  return rest;
}
