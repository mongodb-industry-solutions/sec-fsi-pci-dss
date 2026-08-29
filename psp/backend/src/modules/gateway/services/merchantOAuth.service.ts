/**
 * Merchant OAuth 2.0 client management (BQ:Grant, ADR-037)
 * Issues, rotates, and revokes OAuth client credentials for merchants.
 */
import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { registerAuthorityClient, rotateAuthorityClientSecret, revokeAuthorityClient, updateAuthorityClient } from '../../../vendors/security/clientRegistration';
import {
  MERCHANT_AGREEMENT_COLLECTION,
  MerchantAgreementControlRecord,
} from '../models/merchantAgreement.model';
import {
  OAuthClientRecord, OAuthClientPublic, OAuthGrantType, OAuthBackchannelDeliveryMode, toPublicClient,
} from '../models/oauthClient.model';
import {
  findClientById, findClientByOwner, findActiveClientByOwner,
  insertClient, updateClient, revokeClientByOwner,
} from './oauthClientRegistry.service';

// ── Scope Catalog (v18 E-01) ────────────────────────────────────────────────
// Single source of truth for OAuth scope metadata: human-readable description +
// whether the scope is mandatory (cannot be de-selected on the consent page).
// `openid` is the only required scope (OIDC baseline); everything else is opt-in,
// enforcing least-privilege granular consent (OAuth 2.0 Security BCP). Documented in
// technical-spec.md §6. Unknown scopes fall back to a generated label at render time.
export interface ScopeCatalogEntry {
  description: string;
  required: boolean;
}

// Real PSP `verb:resource` scope convention (enforced by merchantBeneficiary/
// merchantGateway controllers). `openid` is the only required scope (OIDC baseline).
export const SCOPE_CATALOG: Record<string, ScopeCatalogEntry> = {
  openid: { description: 'Verify your identity', required: true },
  profile: { description: 'Read your name and username', required: false },
  'read:beneficiaries': { description: 'View your saved beneficiaries', required: false },
  'write:beneficiaries': { description: 'Add and manage your beneficiaries', required: false },
  'read:transactions': { description: 'View your transaction and operation history', required: false },
  'read:accounts': { description: 'View your bank accounts (masked IBAN)', required: false },
  'read:merchant_profile': { description: 'View the merchant profile', required: false },
  'read:notifications': { description: 'View your notifications', required: false },
  'write:transfers': { description: 'Preview and execute bank transfers on your behalf', required: false },
  // v28 Request to Pay (RTP) scopes.
  'read:rtp': { description: 'View your payment requests (Request to Pay)', required: false },
  'write:rtp': { description: 'Create, approve, reject and cancel payment requests (Request to Pay)', required: false },
  // v18 (Item 2): server-to-server merchant charge scope. Machine grant (client_credentials) only,
  // never requested on the user consent page (it is the merchant's own capability, not user-delegated).
  'write:payments': { description: 'Create payments (server-to-server merchant charge)', required: false },
};

// Scope descriptor returned to the consent UI (E-03).
export interface ScopeDescriptor {
  scope: string;
  description: string;
  required: boolean;
}

// DRY: describe an arbitrary scope, falling back gracefully for scopes not in the catalog.
export function describeScope(scope: string): ScopeDescriptor {
  const entry = SCOPE_CATALOG[scope];
  return {
    scope,
    description: entry?.description ?? `Access to ${scope.replace(/[:._]/g, ' ')}`,
    required: entry?.required ?? false,
  };
}

// Required scopes present in a given allowlist (always force-included on grant, E-04).
export function requiredScopesIn(scopes: string[]): string[] {
  return scopes.filter((s) => SCOPE_CATALOG[s]?.required);
}

export interface IssueMerchantOAuthClientInput {
  redirect_uris: string[];
  grant_types: OAuthGrantType[];
  scopes: string[];
  require_pkce?: boolean;
  token_lifetime_seconds?: number;
  refresh_token_lifetime_days?: number;
}

export interface IssueMerchantOAuthClientResult {
  client_id: string;
  client_secret: string; // shown once, never stored
  client_secret_prefix: string;
  redirect_uris: string[];
  grant_types: OAuthGrantType[];
  scopes: string[];
}

export async function issueMerchantOAuthClient(
  db: Db,
  merchantAgreementInstanceReference: string,
  input: IssueMerchantOAuthClientInput,
): Promise<IssueMerchantOAuthClientResult> {
  const col = db.collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION);
  const merchant = await col.findOne({ merchantAgreementInstanceReference });

  if (!merchant) {
    throw Object.assign(new Error('Merchant not found'), { statusCode: 404 });
  }
  if (merchant.merchantAgreementStatus !== 'active') {
    throw Object.assign(new Error('Merchant must be in active status to issue OAuth credentials'), { statusCode: 400 });
  }
  if ((await findActiveClientByOwner(db, merchantAgreementInstanceReference))?.oauthClientStatus === 'active') {
    throw Object.assign(new Error('OAuth client already active: revoke existing client first'), { statusCode: 409 });
  }

  // The credential is created by the identity authority, which is the only party that ever sees the
  // secret in the clear. This service used to generate and hash it, which meant it had a credential
  // store, a hashing decision and a rotation policy of its own, and would eventually get one of them
  // subtly wrong in a way nobody notices until an audit.
  const registered = await registerAuthorityClient({
    client_name: merchant.merchantName,
    redirect_uris: input.redirect_uris,
    grant_types: input.grant_types,
    scope: input.scopes.join(' '),
    owner_ref: merchantAgreementInstanceReference,
  });
  if (!registered) {
    throw Object.assign(new Error('The identity authority could not register this client'), { statusCode: 503 });
  }
  const clientId = registered.client_id;
  const plainSecret = registered.client_secret;
  // A display label only, and deliberately NOT a prefix of the real secret: the authority holds that
  // and this service never learns enough of it to leak any part.
  const secretPrefix = uuidv4().slice(0, 8);

  const now = new Date();
  const cfg: OAuthClientRecord = {
    oauthClientId: clientId,
    oauthClientSecretPrefix: secretPrefix,
    oauthRedirectUris: input.redirect_uris,
    oauthGrantTypes: input.grant_types,
    oauthScopes: input.scopes,
    oauthClientStatus: 'active',
    oauthClientCreatedDateTime: new Date(),
    oauthTokenLifetimeSeconds: input.token_lifetime_seconds ?? 3600,
    oauthRefreshTokenLifetimeDays: input.refresh_token_lifetime_days ?? 30,
    oauthRequirePkce: input.require_pkce ?? true,
    merchantAgreementInstanceReference,
    // Denormalized at registration, so the audit trail can name the owner without a second read.
    merchantName: merchant.merchantName,
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };

  await insertClient(db, cfg);

  return {
    client_id: clientId,
    client_secret: plainSecret,
    client_secret_prefix: secretPrefix,
    redirect_uris: input.redirect_uris,
    grant_types: input.grant_types,
    scopes: input.scopes,
  };
}

export async function revokeMerchantOAuthClient(
  db: Db,
  merchantAgreementInstanceReference: string,
): Promise<void> {
  const existing = await findActiveClientByOwner(db, merchantAgreementInstanceReference);
  const revoked = await revokeClientByOwner(db, merchantAgreementInstanceReference);
  if (!revoked) {
    throw Object.assign(new Error('Merchant not found or OAuth client already revoked'), { statusCode: 404 });
  }

  // Withdrawn at the authority too. Marking it revoked only here would leave a credential that still
  // authenticates perfectly well, which is the worst of both records: the screen says revoked and
  // the client keeps working.
  if (existing) await revokeAuthorityClient(existing.oauthClientId);
}

export interface UpdateMerchantOAuthClientInput {
  redirect_uris?: string[];
  post_logout_redirect_uris?: string[];
  grant_types?: OAuthGrantType[];
  scopes?: string[];
  require_pkce?: boolean;
  token_lifetime_seconds?: number;
  refresh_token_lifetime_days?: number;
  claim_mapping?: Record<string, string>;
  logo_uri?: string;    // v18: OIDC client logo_uri (https)
  client_uri?: string;  // v18: OIDC client_uri home page (https)
  // CIBA delivery config. Notification endpoint must be HTTPS (PCI DSS + CIBA spec); required
  // when the delivery mode is ping/push.
  backchannel_token_delivery_mode?: OAuthBackchannelDeliveryMode;
  backchannel_client_notification_endpoint?: string;
  // Full credential management from the admin UI. Changing client_id ROTATES the client identity:
  // existing access tokens (aud) and consent grants that reference the old id are orphaned and the
  // relying party's configured client_id must be updated too. Setting client_secret re-hashes it.
  // client_secret_prefix is an INDEPENDENT display/identification label (not derived from the secret,
  // so it leaks no secret bytes); set or generate it on its own. Omit any field to leave it unchanged.
  client_id?: string;
  client_secret?: string;
  client_secret_prefix?: string;
}

// v18: OIDC client metadata must be an https URL (RFC 7591). Empty string clears the field.
// Exception: http://localhost and http://127.0.0.1 are allowed so the documented local-dev workflow
// (merchant app on http://localhost:8082) can update branding without switching to https.
function assertHttpsOrEmpty(value: string | undefined, label: string): void {
  if (value === undefined || value === '') return;
  let ok = false;
  try {
    const url = new URL(value);
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    ok = url.protocol === 'https:' || (url.protocol === 'http:' && isLocalhost);
  } catch { ok = false; }
  if (!ok) throw Object.assign(new Error(`${label} must be a valid https URL (http allowed only for localhost)`), { statusCode: 400 });
}

export type MerchantOAuthClientConfigPublic = OAuthClientPublic;

export async function updateMerchantOAuthClient(
  db: Db,
  merchantId: string,
  patch: UpdateMerchantOAuthClientInput,
): Promise<MerchantOAuthClientConfigPublic> {
  const col = db.collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION);
  const merchant = await col.findOne({ merchantAgreementInstanceReference: merchantId });

  if (!merchant) {
    throw Object.assign(new Error('Merchant not found'), { statusCode: 404 });
  }
  const existingClient = await findClientByOwner(db, merchantId);
  if (!existingClient) {
    throw Object.assign(new Error('No OAuth client configured for this merchant: issue one first'), { statusCode: 400 });
  }

  assertHttpsOrEmpty(patch.logo_uri, 'logo_uri');
  assertHttpsOrEmpty(patch.client_uri, 'client_uri');

  // CIBA: resolve the effective delivery mode + notification endpoint (patch overlaid on existing),
  // then enforce HTTPS + presence for ping/push (PCI DSS + CIBA spec).
  const effectiveGrants = patch.grant_types ?? existingClient.oauthGrantTypes;
  const effectiveDeliveryMode = patch.backchannel_token_delivery_mode
    ?? existingClient.oauthBackchannelTokenDeliveryMode;
  const effectiveNotifyEndpoint = patch.backchannel_client_notification_endpoint
    ?? existingClient.oauthBackchannelClientNotificationEndpoint;
  if (effectiveGrants.includes('urn:openid:params:grant-type:ciba')
    && (effectiveDeliveryMode === 'ping' || effectiveDeliveryMode === 'push')) {
    if (!effectiveNotifyEndpoint) {
      throw Object.assign(new Error('backchannel_client_notification_endpoint is required for ping/push delivery'), { statusCode: 400 });
    }
    assertHttpsOrEmpty(effectiveNotifyEndpoint, 'backchannel_client_notification_endpoint');
  }

  // Credential rotation from the admin UI.
  const credentialPatch: Partial<OAuthClientRecord> = {};
  if (patch.client_id !== undefined) {
    const newId = patch.client_id.trim();
    if (!newId) throw Object.assign(new Error('client_id cannot be empty'), { statusCode: 400 });
    if (newId !== existingClient.oauthClientId) {
      // Global uniqueness: the client_id is the OAuth identity a token resolves back to. A plain
      // lookup on the registry now, rather than a nested query across commercial records.
      const clash = await findClientById(db, newId);
      if (clash && clash.merchantAgreementInstanceReference !== merchantId) {
        throw Object.assign(new Error('client_id already in use by another merchant'), { statusCode: 409 });
      }
    }
    credentialPatch.oauthClientId = newId;
  }
  if (patch.client_secret !== undefined && patch.client_secret !== '') {
    if (patch.client_secret.length < 8) {
      throw Object.assign(new Error('client_secret must be at least 8 characters'), { statusCode: 400 });
    }
    // Hash the secret only. The prefix is an independent label (see below), not derived here, so
    // setting a secret never changes it and no part of the real secret is exposed via the prefix.
  }
  if (patch.client_secret_prefix !== undefined) {
    const prefix = patch.client_secret_prefix.trim();
    if (prefix.length > 16) {
      throw Object.assign(new Error('client_secret_prefix must be at most 16 characters'), { statusCode: 400 });
    }
    credentialPatch.oauthClientSecretPrefix = prefix; // independent display/identification label
  }

  const updated: OAuthClientRecord = {
    ...existingClient,
    ...credentialPatch,
    ...(patch.redirect_uris !== undefined && { oauthRedirectUris: patch.redirect_uris }),
    ...(patch.logo_uri !== undefined && { oauthLogoUri: patch.logo_uri }),
    ...(patch.client_uri !== undefined && { oauthClientUri: patch.client_uri }),
    ...(patch.post_logout_redirect_uris !== undefined && { oauthPostLogoutRedirectUris: patch.post_logout_redirect_uris }),
    ...(patch.grant_types !== undefined && { oauthGrantTypes: patch.grant_types }),
    ...(patch.scopes !== undefined && { oauthScopes: patch.scopes }),
    ...(patch.require_pkce !== undefined && { oauthRequirePkce: patch.require_pkce }),
    ...(patch.token_lifetime_seconds !== undefined && { oauthTokenLifetimeSeconds: patch.token_lifetime_seconds }),
    ...(patch.refresh_token_lifetime_days !== undefined && { oauthRefreshTokenLifetimeDays: patch.refresh_token_lifetime_days }),
    ...(patch.claim_mapping !== undefined && { oauthClaimMapping: patch.claim_mapping }),
    ...(patch.backchannel_token_delivery_mode !== undefined && { oauthBackchannelTokenDeliveryMode: patch.backchannel_token_delivery_mode }),
    ...(patch.backchannel_client_notification_endpoint !== undefined && { oauthBackchannelClientNotificationEndpoint: patch.backchannel_client_notification_endpoint }),
  };

  await updateClient(db, existingClient.oauthClientId, updated);

  // The authority holds the registration that actually governs the flow: its redirect URIs are what
  // an authorization request is checked against, not the copy here. Changing one and not the other
  // is how a merchant edits a redirect URI and the login keeps going to the old one.
  await updateAuthorityClient(existingClient.oauthClientId, {
    ...(patch.redirect_uris !== undefined ? { redirect_uris: patch.redirect_uris } : {}),
    ...(patch.scopes !== undefined ? { scope: patch.scopes.join(String.fromCharCode(32)) } : {}),
    ...(patch.logo_uri !== undefined ? { logo_uri: patch.logo_uri } : {}),
  });

  return toPublicClient(updated);
}

export async function rotateMerchantOAuthClientSecret(
  db: Db,
  merchantAgreementInstanceReference: string,
): Promise<{ client_id: string; client_secret: string; client_secret_prefix: string }> {
  const client = await findActiveClientByOwner(db, merchantAgreementInstanceReference);
  if (!client || client.oauthClientStatus !== 'active') {
    throw Object.assign(new Error('No active OAuth client found for this merchant'), { statusCode: 404 });
  }

  const rotated = await rotateAuthorityClientSecret(client.oauthClientId);
  if (!rotated) {
    throw Object.assign(new Error('The identity authority could not rotate this credential'), { statusCode: 503 });
  }
  const plainSecret = rotated.client_secret;
  // A fresh display label, not derived from the secret. The previous credential stopped working the
  // moment the authority rotated it: there is no overlap window, because two live secrets means a
  // compromised one keeps working for the length of that window.
  const secretPrefix = uuidv4().slice(0, 8);

  await updateClient(db, client.oauthClientId, {
    oauthClientSecretPrefix: secretPrefix,
  });

  return {
    client_id: client.oauthClientId,
    client_secret: plainSecret,
    client_secret_prefix: secretPrefix,
  };
}
