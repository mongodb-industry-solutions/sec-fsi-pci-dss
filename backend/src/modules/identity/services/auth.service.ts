import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { CUSTOMER_AUTHENTICATION_COLLECTION, CustomerAuthenticationAssessmentRecord } from '../models/customerAuthentication.model';
import { AUTHENTICATION_DOMAIN_COLLECTION, AuthenticationDomainRecord } from '../models/authenticationDomain.model';

export interface JwtPayload {
  sub: string;       // customerAuthenticationInstanceReference
  email: string;
  role: string;
  name: string;
  domain: string;
  partyRef?: string; // Ch-05: partyInstanceReference (SD-13) — present for all users with a Party record
}

export async function loginUser(
  db: Db,
  email: string,
  password: string,
  domain: string
): Promise<{ token: string; user: Omit<JwtPayload, 'iat' | 'exp'> }> {
  const user = await db
    .collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION)
    .findOne({ customerAuthenticationEmailAddress: email } as Partial<CustomerAuthenticationAssessmentRecord>);

  if (!user) {
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  if (user.customerAuthenticationLoginDomain !== domain) {
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  const valid = await bcrypt.compare(password, user.customerAuthenticationCredentialHash);
  if (!valid) {
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  const payload: JwtPayload = {
    sub: user.customerAuthenticationInstanceReference,
    email: user.customerAuthenticationEmailAddress,
    role: user.customerAuthenticationUserRole,
    name: user.customerAuthenticationUserName,
    domain: user.customerAuthenticationLoginDomain,
    ...(user.partyInstanceReference && { partyRef: user.partyInstanceReference }),
  };

  const secret = process.env.JWT_SECRET ?? 'demo-local-secret-change-in-production';
  const expiresIn = process.env.JWT_EXPIRES_IN ?? '24h';
  const token = jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);

  return {
    token,
    user: {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      name: payload.name,
      domain: payload.domain,
      ...(payload.partyRef && { partyRef: payload.partyRef }),
    },
  };
}

/**
 * Returns demo users for the local domain by reading directly from the seed file.
 * This avoids QE-decryption complexity for a UI helper endpoint: the seed file
 * already contains plaintext emails and names (passwords are bcrypt-hashed and
 * are NOT returned). This is safe for demo purposes only.
 */
export async function getDemoUsers(_db: Db, opts?: { featured?: boolean }) {
  const dataDir = process.env.SEED_DATA_DIR ?? path.join(__dirname, '../../../../data');
  const filePath = path.join(dataDir, 'customerAuthentications.json');
  const records: CustomerAuthenticationAssessmentRecord[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  return records
    .filter((u) => u.customerAuthenticationAccountStatus === 'active')
    // featured=true → only the curated demo roster (debug-mode picker + simulator).
    // Non-featured users stay available for ad-hoc login/testing.
    .filter((u) => (opts?.featured ? u.customerAuthenticationDemoFeatured === true : true))
    .map((u) => ({
      email: u.customerAuthenticationEmailAddress,
      name: u.customerAuthenticationUserName,
      role: u.customerAuthenticationUserRole,
      featured: u.customerAuthenticationDemoFeatured === true,
    }));
}

/**
 * Update display name for any authenticated user (non-customer roles).
 * Writes only to the plaintext customerAuthenticationUserName field.
 */
export async function updateAuthProfile(
  db: Db,
  sub: string,
  name: string,
): Promise<boolean> {
  const res = await db
    .collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION)
    .updateOne(
      { customerAuthenticationInstanceReference: sub },
      { $set: { customerAuthenticationUserName: name } }
    );
  return res.matchedCount > 0;
}

/** Returns only enabled authentication domains, sorted by display name. */
export async function getEnabledDomains(db: Db) {
  const domains = await db
    .collection<AuthenticationDomainRecord>(AUTHENTICATION_DOMAIN_COLLECTION)
    .find({ partyAuthenticationDomainEnabled: true })
    .sort({ partyAuthenticationDomainDisplayName: 1 })
    .toArray();

  return domains.map((d) => ({
    name: d.partyAuthenticationDomainName,
    displayName: d.partyAuthenticationDomainDisplayName,
    type: d.partyAuthenticationDomainType,
    flowType: d.partyAuthenticationDomainFlowType
      ?? (d.partyAuthenticationDomainType === 'local' ? 'client_credentials' : d.partyAuthenticationDomainType),
    alertMessage: d.partyAuthenticationDomainAlertMessage,
  }));
}
