// BIAN SD-89: Merchant Relations  -  prototype stub service
// Full implementation scheduled for v5. Returns typed stub data.

import { v4 as uuidv4 } from 'uuid';
import { MerchantAgreementControlRecord, MerchantAgreementStatus } from '../models/merchantAgreement.model';

export interface CreateMerchantInput {
  merchantName: string;
  merchantLegalEntityReference: string;
  merchantCategoryCode: string;
  merchantCountryCode: string;
  merchantTier?: 'standard' | 'enterprise';
  merchantAllowedCurrencies?: string[];
  merchantTransactionLimitAmount?: number;
  merchantWebhookEndpoint?: string;
  merchantSettlementSchedule?: 'T+1' | 'T+2' | 'T+3';
}

const STUB_MERCHANTS: Omit<MerchantAgreementControlRecord, 'merchantApiKeyHash'>[] = [
  {
    merchantAgreementInstanceReference: 'mrch-5732-001',
    merchantName: 'TechStore Online',
    merchantLegalEntityReference: 'TSO-TAX-001',
    merchantCategoryCode: '5732',
    merchantCountryCode: 'US',
    merchantAgreementStatus: 'active',
    merchantTier: 'standard',
    merchantAllowedCurrencies: ['USD', 'EUR'],
    merchantTransactionLimitAmount: 5000,
    merchantWebhookEndpoint: 'https://techstore.example.com/webhooks/payments',
    merchantSettlementSchedule: 'T+2',
    merchantAverageTransactionAmount: 45.50,
    merchantTransactionCount30d: 1240,
    merchantRiskCategory: 'medium',
    bianServiceDomain: 'MerchantRelations',
    bianControlRecordType: 'MerchantAgreement',
    recordCreatedDateTime: new Date('2026-01-01'),
    recordUpdatedDateTime: new Date('2026-05-01'),
    schemaVersion: 1,
  },
  {
    merchantAgreementInstanceReference: 'mrch-5812-002',
    merchantName: 'Coffee Shop Beta',
    merchantLegalEntityReference: 'CSB-TAX-002',
    merchantCategoryCode: '5812',
    merchantCountryCode: 'US',
    merchantAgreementStatus: 'active',
    merchantTier: 'standard',
    merchantAllowedCurrencies: ['USD'],
    merchantTransactionLimitAmount: 500,
    merchantSettlementSchedule: 'T+1',
    merchantAverageTransactionAmount: 12.00,
    merchantTransactionCount30d: 890,
    merchantRiskCategory: 'high',
    bianServiceDomain: 'MerchantRelations',
    bianControlRecordType: 'MerchantAgreement',
    recordCreatedDateTime: new Date('2026-01-15'),
    recordUpdatedDateTime: new Date('2026-05-01'),
    schemaVersion: 1,
  },
];

export async function getMerchants(filters: { status?: MerchantAgreementStatus; mcc?: string }) {
  let results = [...STUB_MERCHANTS];
  if (filters.status) results = results.filter((m) => m.merchantAgreementStatus === filters.status);
  if (filters.mcc) results = results.filter((m) => m.merchantCategoryCode === filters.mcc);
  return { results, total: results.length };
}

export async function getMerchantById(id: string) {
  return STUB_MERCHANTS.find((m) => m.merchantAgreementInstanceReference === id) ?? null;
}

export async function createMerchant(input: CreateMerchantInput) {
  const id = uuidv4();
  return {
    merchantAgreementInstanceReference: id,
    merchantName: input.merchantName,
    merchantCategoryCode: input.merchantCategoryCode,
    merchantAgreementStatus: 'active' as MerchantAgreementStatus,
    merchantRiskCategory: 'low' as const,
    // API key returned ONCE on creation; never stored in plaintext after this
    merchantApiKey: `mk_live_${uuidv4().replace(/-/g, '')}`,
    _stub: true,
    _note: 'v5: this will persist to merchantAgreement collection with merchantApiKeyHash as QE:none',
  };
}

export async function updateMerchant(id: string, patch: Partial<CreateMerchantInput>) {
  const existing = await getMerchantById(id);
  if (!existing) return null;
  return { ...existing, ...patch, recordUpdatedDateTime: new Date(), _stub: true };
}

export async function registerWebhook(merchantId: string, url: string) {
  const existing = await getMerchantById(merchantId);
  if (!existing) return null;
  return { merchantAgreementInstanceReference: merchantId, merchantWebhookEndpoint: url, _stub: true };
}
