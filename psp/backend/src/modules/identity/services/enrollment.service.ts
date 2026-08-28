/**
 * Passwordless credential enrollment (WebAuthn/FIDO2-style registration ceremony).
 * Session-gated: the caller is an already-authenticated user (sub = customerAuthenticationInstanceReference).
 * Stores PUBLIC key material only (PCI DSS). Emits compliance events .
 *
 * Registration challenge is STATELESS: an HMAC-signed, expiring token binding the ceremony to the
 * owner's sub. No extra collection is needed; the device signs the exact challenge string, and
 * registerCredential re-derives + validates the HMAC before trusting it.
 */
import { Db } from 'mongodb';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  PARTY_ENROLLED_CREDENTIAL_COLLECTION,
  PartyEnrolledCredentialRecord,
  EnrolledCredentialAlg,
  EnrolledCredentialAuthenticatorMetadata,
} from '../models/partyEnrolledCredential.model';
import { emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';
import { verifySignature } from './signatureVerifier';
import { oauth401, oauthError } from './oauth.service';
import { enrollmentSecret } from '../../../vendors/security/secrets';

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

// Reuse the shared JWT secret helper so the default + "change in production" messaging stays
// consistent app-wide (avoids a second hardcoded fallback secret).
function challengeSecret(): string {
  return enrollmentSecret();
}

// Compact stateless challenge: base64url(JSON payload).base64url(HMAC-SHA256(payload)).
function signChallenge(payload: { sub: string; nonce: string; exp: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', challengeSecret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verifyChallenge(challenge: string): { sub: string; nonce: string; exp: number } {
  const [body, mac] = challenge.split('.');
  if (!body || !mac) throw oauthError(400, 'invalid_request', 'Malformed enrollment challenge');
  const expected = crypto.createHmac('sha256', challengeSecret()).update(body).digest('base64url');
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expected);
  // timingSafeEqual throws on unequal buffer lengths, so length-check first (a wrong-length MAC is a
  // signature mismatch anyway) to keep a malformed challenge a clean 400 rather than a 500.
  if (macBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(macBuf, expectedBuf)) {
    throw oauthError(400, 'invalid_request', 'Enrollment challenge signature invalid');
  }
  let payload: { sub: string; nonce: string; exp: number };
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    throw oauthError(400, 'invalid_request', 'Malformed enrollment challenge');
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
    throw oauthError(400, 'invalid_request', 'Enrollment challenge expired');
  }
  return payload;
}

export interface RegistrationChallenge {
  challenge: string;
  expiresIn: number;
}

export function issueRegistrationChallenge(sub: string): RegistrationChallenge {
  if (!sub) throw oauth401('invalid_token', 'Authenticated session required');
  const exp = Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS;
  const challenge = signChallenge({ sub, nonce: uuidv4(), exp });
  return { challenge, expiresIn: CHALLENGE_TTL_SECONDS };
}

export interface RegisterCredentialInput {
  challenge: string;
  publicKeyPem: string;
  alg: EnrolledCredentialAlg;
  signature: string;      // base64url signature over the challenge string
  credentialId?: string;  // client-supplied opaque id (defaults to a generated one)
  authenticatorMetadata?: EnrolledCredentialAuthenticatorMetadata;
}

export interface EnrolledCredentialView {
  credentialId: string;
  partyEnrolledCredentialInstanceReference: string;
  alg: EnrolledCredentialAlg;
  deviceName?: string;
  status: string;
  createdAt: Date;
  lastUsedAt?: Date;
}

function toView(r: PartyEnrolledCredentialRecord): EnrolledCredentialView {
  return {
    credentialId: r.credentialId,
    partyEnrolledCredentialInstanceReference: r.partyEnrolledCredentialInstanceReference,
    alg: r.alg,
    deviceName: r.authenticatorMetadata?.deviceName,
    status: r.status,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
  };
}

export async function registerCredential(
  db: Db,
  sub: string,
  input: RegisterCredentialInput,
): Promise<EnrolledCredentialView> {
  if (!sub) throw oauth401('invalid_token', 'Authenticated session required');
  if (input.alg !== 'RS256' && input.alg !== 'ES256') {
    throw oauthError(400, 'invalid_request', 'Unsupported alg (RS256 or ES256)');
  }
  const claims = verifyChallenge(input.challenge);
  if (claims.sub !== sub) {
    throw oauth401('invalid_grant', 'Enrollment challenge does not belong to this user');
  }
  // Proof of possession: the device must sign the challenge with the private key it is registering.
  const ok = verifySignature(input.alg, input.publicKeyPem, input.challenge, input.signature);
  if (!ok) {
    emitEnrollmentEvent(db, sub, 'auth.enrollment.registered', 'rejected', {});
    throw oauth401('invalid_grant', 'Registration signature invalid');
  }

  const credentialId = input.credentialId ?? uuidv4();
  const existing = await db
    .collection<PartyEnrolledCredentialRecord>(PARTY_ENROLLED_CREDENTIAL_COLLECTION)
    .findOne({ credentialId });
  if (existing) throw oauthError(409, 'invalid_request', 'credentialId already registered');

  const now = new Date();
  const record: PartyEnrolledCredentialRecord = {
    partyEnrolledCredentialInstanceReference: uuidv4(),
    customerAuthenticationInstanceReference: sub,
    credentialId,
    publicKeyPem: input.publicKeyPem,
    alg: input.alg,
    signCount: 0,
    authenticatorMetadata: {
      deviceName: input.authenticatorMetadata?.deviceName,
      aaguid: input.authenticatorMetadata?.aaguid,
      transports: input.authenticatorMetadata?.transports,
      createdVia: input.authenticatorMetadata?.createdVia ?? 'psp-portal',
    },
    status: 'active',
    createdAt: now,
    bianServiceDomain: 'PartyAuthentication',
    bianControlRecordType: 'EnrolledCredential',
    schemaVersion: 1,
  };
  await db.collection<PartyEnrolledCredentialRecord>(PARTY_ENROLLED_CREDENTIAL_COLLECTION).insertOne(record);
  emitEnrollmentEvent(db, sub, 'auth.enrollment.registered', 'approved', { credentialId, alg: input.alg });
  return toView(record);
}

export async function listCredentials(db: Db, sub: string): Promise<EnrolledCredentialView[]> {
  if (!sub) throw oauth401('invalid_token', 'Authenticated session required');
  const rows = await db
    .collection<PartyEnrolledCredentialRecord>(PARTY_ENROLLED_CREDENTIAL_COLLECTION)
    .find({ customerAuthenticationInstanceReference: sub })
    .sort({ createdAt: -1 })
    .toArray();
  return rows.map(toView);
}

export async function revokeCredential(db: Db, sub: string, credentialId: string): Promise<void> {
  if (!sub) throw oauth401('invalid_token', 'Authenticated session required');
  const col = db.collection<PartyEnrolledCredentialRecord>(PARTY_ENROLLED_CREDENTIAL_COLLECTION);
  // Owner-scoped: a foreign credentialId does not match and yields a 404.
  const res = await col.updateOne(
    { credentialId, customerAuthenticationInstanceReference: sub, status: 'active' },
    { $set: { status: 'revoked', revokedAt: new Date() } },
  );
  if (res.matchedCount === 0) {
    throw oauthError(404, 'invalid_request', 'Credential not found');
  }
  emitEnrollmentEvent(db, sub, 'auth.enrollment.revoked', 'approved', { credentialId });
}

export async function rotateCredential(
  db: Db,
  sub: string,
  credentialId: string,
  input: RegisterCredentialInput,
): Promise<EnrolledCredentialView> {
  // Verify the credential being rotated exists, is active and belongs to the caller BEFORE creating a
  // replacement, so a wrong/already-revoked credentialId cannot leave an orphaned new credential.
  const existing = await db.collection<PartyEnrolledCredentialRecord>(PARTY_ENROLLED_CREDENTIAL_COLLECTION)
    .findOne({ credentialId, customerAuthenticationInstanceReference: sub, status: 'active' });
  if (!existing) throw oauthError(404, 'invalid_request', 'Credential not found');
  // Register the replacement (validates possession), then revoke the old one.
  const replacement = await registerCredential(db, sub, input);
  await revokeCredential(db, sub, credentialId);
  emitEnrollmentEvent(db, sub, 'auth.enrollment.rotated', 'approved', {
    oldCredentialId: credentialId,
    newCredentialId: replacement.credentialId,
  });
  return replacement;
}

function emitEnrollmentEvent(
  db: Db,
  sub: string,
  action: string,
  outcome: 'approved' | 'rejected',
  summary: Record<string, unknown>,
): void {
  emitComplianceEvent(db, {
    entityType: 'customer',
    entityId: sub,
    processType: 'authentication',
    processAction: action,
    processOutcome: outcome,
    performedByPartyReference: sub,
    performedByRole: 'customer',
    eventSummary: summary,
    bianServiceDomain: 'PartyAuthentication',
    bianControlRecordType: 'EnrolledCredential',
  });
}
