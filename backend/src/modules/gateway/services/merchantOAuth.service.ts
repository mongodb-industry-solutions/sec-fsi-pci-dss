/**
 * Merchant OAuth 2.0 client management (BIAN SD-89 BQ:Grant, ADR-037)
 * Issues, rotates, and revokes OAuth client credentials for merchants.
 */
import { Db } from 'mongodb';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import {
  MERCHANT_AGREEMENT_COLLECTION,
  MerchantAgreementControlRecord,
  MerchantOAuthClientConfig,
  OAuthGrantType,
} from '../models/merchantAgreement.model';

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

// Real PSP `verb:resource` scope convention (enforced by merchantBeneficiary/merchantPortal/
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
  // v18 (Item 2): server-to-server merchant charge scope. Machine grant (client_credentials) only —
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
  if (merchant.merchantOAuthClient?.oauthClientStatus === 'active') {
    throw Object.assign(new Error('OAuth client already active — revoke existing client first'), { statusCode: 409 });
  }

  const clientId = uuidv4();
  const plainSecret = uuidv4();
  const secretHash = await bcrypt.hash(plainSecret, 12);
  const secretPrefix = plainSecret.slice(0, 8);

  const cfg: MerchantOAuthClientConfig = {
    oauthClientId: clientId,
    oauthClientSecretHash: secretHash,
    oauthClientSecretPrefix: secretPrefix,
    oauthRedirectUris: input.redirect_uris,
    oauthGrantTypes: input.grant_types,
    oauthScopes: input.scopes,
    oauthClientStatus: 'active',
    oauthClientCreatedDateTime: new Date(),
    oauthTokenLifetimeSeconds: input.token_lifetime_seconds ?? 3600,
    oauthRefreshTokenLifetimeDays: input.refresh_token_lifetime_days ?? 30,
    oauthRequirePkce: input.require_pkce ?? true,
  };

  await col.updateOne(
    { merchantAgreementInstanceReference },
    { $set: { merchantOAuthClient: cfg, recordUpdatedDateTime: new Date() } },
  );

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
  const col = db.collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION);
  const result = await col.updateOne(
    { merchantAgreementInstanceReference, 'merchantOAuthClient.oauthClientStatus': { $ne: 'revoked' } },
    { $set: { 'merchantOAuthClient.oauthClientStatus': 'revoked', recordUpdatedDateTime: new Date() } },
  );
  if (result.matchedCount === 0) {
    throw Object.assign(new Error('Merchant not found or OAuth client already revoked'), { statusCode: 404 });
  }
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
  // Full credential management from the admin UI. Changing client_id ROTATES the client identity:
  // existing access tokens (aud) and consent grants that reference the old id are orphaned and the
  // relying party's configured client_id must be updated too. Setting client_secret re-hashes it and
  // re-derives the display prefix. Omit either to leave it unchanged.
  client_id?: string;
  client_secret?: string;
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

export type MerchantOAuthClientConfigPublic = Omit<MerchantOAuthClientConfig, 'oauthClientSecretHash'>;

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
  if (!merchant.merchantOAuthClient) {
    throw Object.assign(new Error('No OAuth client configured for this merchant — issue one first'), { statusCode: 400 });
  }

  assertHttpsOrEmpty(patch.logo_uri, 'logo_uri');
  assertHttpsOrEmpty(patch.client_uri, 'client_uri');

  // Credential rotation from the admin UI.
  let credentialPatch: Partial<MerchantOAuthClientConfig> = {};
  if (patch.client_id !== undefined) {
    const newId = patch.client_id.trim();
    if (!newId) throw Object.assign(new Error('client_id cannot be empty'), { statusCode: 400 });
    if (newId !== merchant.merchantOAuthClient.oauthClientId) {
      // Enforce global uniqueness — the client_id is the OAuth identity used to resolve the merchant.
      const clash = await col.findOne({
        'merchantOAuthClient.oauthClientId': newId,
        merchantAgreementInstanceReference: { $ne: merchantId },
      }, { projection: { _id: 1 } });
      if (clash) throw Object.assign(new Error('client_id already in use by another merchant'), { statusCode: 409 });
    }
    credentialPatch.oauthClientId = newId;
  }
  if (patch.client_secret !== undefined && patch.client_secret !== '') {
    if (patch.client_secret.length < 8) {
      throw Object.assign(new Error('client_secret must be at least 8 characters'), { statusCode: 400 });
    }
    credentialPatch.oauthClientSecretHash = await bcrypt.hash(patch.client_secret, 12);
    credentialPatch.oauthClientSecretPrefix = patch.client_secret.slice(0, 8); // display prefix, re-derived
  }

  const existing = merchant.merchantOAuthClient;
  const updated: MerchantOAuthClientConfig = {
    ...existing,
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
  };

  await col.updateOne(
    { merchantAgreementInstanceReference: merchantId },
    { $set: { merchantOAuthClient: updated, recordUpdatedDateTime: new Date() } },
  );

  const { oauthClientSecretHash: _omit, ...publicConfig } = updated;
  return publicConfig;
}

export async function rotateMerchantOAuthClientSecret(
  db: Db,
  merchantAgreementInstanceReference: string,
): Promise<{ client_id: string; client_secret: string; client_secret_prefix: string }> {
  const col = db.collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION);
  const merchant = await col.findOne({ merchantAgreementInstanceReference });

  if (!merchant?.merchantOAuthClient || merchant.merchantOAuthClient.oauthClientStatus !== 'active') {
    throw Object.assign(new Error('No active OAuth client found for this merchant'), { statusCode: 404 });
  }

  const plainSecret = uuidv4();
  const secretHash = await bcrypt.hash(plainSecret, 12);
  const secretPrefix = plainSecret.slice(0, 8);

  await col.updateOne(
    { merchantAgreementInstanceReference },
    {
      $set: {
        'merchantOAuthClient.oauthClientSecretHash': secretHash,
        'merchantOAuthClient.oauthClientSecretPrefix': secretPrefix,
        recordUpdatedDateTime: new Date(),
      },
    },
  );

  return {
    client_id: merchant.merchantOAuthClient.oauthClientId,
    client_secret: plainSecret,
    client_secret_prefix: secretPrefix,
  };
}
