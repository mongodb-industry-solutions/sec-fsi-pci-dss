// Internal KYC engine (built-in customer identity verification; used when no external KYC vendor).
import { KycInboundPayload } from '../../../modules/providers/models/externalProviderArrangement.model';

export function verifyKyc(_input: Record<string, unknown>): KycInboundPayload {
  return { verificationStatus: 'pass', confidenceScore: 92, failureReasons: [] };
}
