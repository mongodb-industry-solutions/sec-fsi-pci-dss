// Ch-05: Seed merchantAgreementProcedure with demo merchant records.
// Includes: 1 active (dual-role owner), 1 under_review (pending approval), 1 active (standalone).

import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { MERCHANT_AGREEMENT_COLLECTION } from '../../modules/gateway/models/merchantAgreement.model';
import { OAUTH_CLIENT_COLLECTION, OAuthClientRecord } from '../../modules/gateway/models/oauthClient.model';
import { API_KEY_COLLECTION, ApiKeyRecord } from '../../modules/gateway/models/apiKey.model';

// v39 P2: the fixture still carries the OAuth client and the API keys inside the merchant record,
// because that is where they were authored. The seeder is what splits them out into their own
// collections, so the fixture stays one file per business concept while the DATABASE no longer
// embeds a credential inside a commercial record. The fixture follows in the phase that moves the
// registry to the identity authority.
interface MerchantFixture extends Record<string, unknown> {
  merchantAgreementInstanceReference: string;
  merchantName: string;
  merchantOAuthClient?: Record<string, unknown>;
  merchantApiKeys?: Array<Record<string, unknown>>;
}

export async function seedMerchants(db: Db) {
  const filePath = path.join(__dirname, '../../../data/merchants.json');
  // The merchant's public base URL differs per environment (localhost / staging / prod), so the
  // single-value OIDC branding fields (logo_uri / client_uri) are tokenised as {{MERCHANT_BASE_URL}}
  // and resolved here from PSP_MERCHANT_BASE_URL (default localhost:8082). Redirect / post-logout
  // URIs stay hardcoded as multi-env arrays. This keeps staging/prod from shipping localhost branding
  // (broken image + https mixed-content). Set PSP_MERCHANT_BASE_URL in the backend env per deploy.
  const merchantBaseUrl = (process.env.PSP_MERCHANT_BASE_URL || 'http://localhost:8082').replace(/\/+$/, '');
  // The OIDC logo is rendered on PSP pages (consent + authorized-apps). Serving it from the PSP
  // FRONTEND origin (same origin as those pages, always browser-reachable) avoids depending on the
  // merchant host being reachable from wherever the PSP UI runs, so the icon loads in every env.
  const frontendBaseUrl = (process.env.PSP_URL_FRONTEND || 'http://localhost:8080').replace(/\/+$/, '');
  const raw = fs.readFileSync(filePath, 'utf-8')
    .replaceAll('{{FRONTEND_BASE_URL}}', frontendBaseUrl)
    .replaceAll('{{MERCHANT_BASE_URL}}', merchantBaseUrl);
  const records = JSON.parse(raw) as MerchantFixture[];

  const now = new Date();
  let upserted = 0;
  let clients = 0;
  let keys = 0;

  for (const record of records) {
    const { merchantOAuthClient, merchantApiKeys, ...agreement } = record;
    const owner = record.merchantAgreementInstanceReference;

    await db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
      { merchantAgreementInstanceReference: owner },
      {
        $set: agreement,
        // Leftovers from a database seeded before the split. Without this a reseed leaves a stale
        // copy of the credential inside the commercial record, and two sources of truth for a client
        // is exactly what this phase exists to remove.
        $unset: { merchantOAuthClient: '', merchantApiKeys: '' },
      },
      { upsert: true },
    );
    upserted++;

    if (merchantOAuthClient) {
      const client = merchantOAuthClient as unknown as OAuthClientRecord;
      await db.collection<OAuthClientRecord>(OAUTH_CLIENT_COLLECTION).updateOne(
        { oauthClientId: client.oauthClientId },
        {
          $set: {
            ...client,
            merchantAgreementInstanceReference: owner,
            // Denormalized so the audit trail names the owner without reading a commercial record.
            merchantName: record.merchantName,
            recordUpdatedDateTime: now,
          },
          $setOnInsert: { recordCreatedDateTime: now, schemaVersion: 1 },
        },
        { upsert: true },
      );
      clients++;
    }

    for (const key of merchantApiKeys ?? []) {
      const apiKey = key as unknown as ApiKeyRecord;
      await db.collection<ApiKeyRecord>(API_KEY_COLLECTION).updateOne(
        { keyId: apiKey.keyId },
        {
          $set: { ...apiKey, merchantAgreementInstanceReference: owner, recordUpdatedDateTime: now },
          $setOnInsert: { recordCreatedDateTime: now, schemaVersion: 1 },
        },
        { upsert: true },
      );
      keys++;
    }
  }

  console.log(`  ${MERCHANT_AGREEMENT_COLLECTION}: ${upserted} upserted`);
  console.log(`  ${OAUTH_CLIENT_COLLECTION}: ${clients} upserted`);
  console.log(`  ${API_KEY_COLLECTION}: ${keys} upserted`);
}
