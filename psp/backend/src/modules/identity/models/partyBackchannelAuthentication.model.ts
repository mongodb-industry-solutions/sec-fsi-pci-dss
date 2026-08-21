// Party Authentication. CIBA (OIDC Client-Initiated Backchannel Authentication) session.
// Models the auth_req_id lifecycle. Patterned on partyAuthorizationCode (TTL-expiring, one-time).
// auth_req_id is an OIDC protocol artifact housed here as the closest BIAN fit (protocol-driven,
// not a native BIAN business object).

export const PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION = 'partyBackchannelAuthentication';

export type BackchannelAuthStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';
export type BackchannelDeliveryMode = 'poll' | 'ping' | 'push';

export interface PartyBackchannelAuthenticationRecord {
  authReqId: string;                 // PK, opaque, unique
  clientId: string;                  // BOUND: only this client may redeem (token endpoint enforces)
  // Resolved from the CIBA hint. The login id (customerAuthenticationInstanceReference / sub).
  customerAuthenticationInstanceReference: string;
  scopes: string[];
  challenge: string;                 // server nonce the device signs (base64url)
  bindingMessage?: string;           // human-readable context shown on the authentication device
  deliveryMode: BackchannelDeliveryMode;
  clientNotificationToken?: string;  // Bearer for ping/push callback auth (per-request)
  status: BackchannelAuthStatus;
  interval: number;                  // poll interval seconds (enforces slow_down)
  expiresAt: Date;                   // TTL index
  lastPolledAt?: Date;               // to enforce slow_down
  credentialIdUsed?: string;         // credential that approved
  signatureVerifiedAt?: Date;
  // BIAN metadata
  bianServiceDomain: 'PartyAuthentication';
  bianControlRecordType: 'BackchannelAuthentication';
  recordCreatedDateTime: Date;
}
