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

  const existing = merchant.merchantOAuthClient;
  const updated: MerchantOAuthClientConfig = {
    ...existing,
    ...(patch.redirect_uris !== undefined && { oauthRedirectUris: patch.redirect_uris }),
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
