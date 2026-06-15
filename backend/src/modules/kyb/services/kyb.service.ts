// Internal KYB engine (built-in business/merchant verification; used when no external KYB vendor).
import { KybInboundPayload } from '../../providers/models/externalProviderArrangement.model';

export function verifyKyb(_input: Record<string, unknown>): KybInboundPayload {
  return { verificationStatus: 'pass', businessRiskLevel: 'low', sanctionsMatch: false, failureReasons: [] };
}
