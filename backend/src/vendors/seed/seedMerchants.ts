// Ch-05: Seed merchantAgreementProcedure (SD-89) with demo merchant records.
// Includes: 1 active (dual-role owner), 1 under_review (pending approval), 1 active (standalone).

import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { MERCHANT_AGREEMENT_COLLECTION } from '../../modules/gateway/models/merchantAgreement.model';

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
  const records = JSON.parse(raw);

  let upserted = 0;
  for (const record of records) {
    await db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
      { merchantAgreementInstanceReference: record.merchantAgreementInstanceReference },
      { $set: record },
      { upsert: true }
    );
    upserted++;
  }
  console.log(`  ${MERCHANT_AGREEMENT_COLLECTION}: ${upserted} upserted`);
}
