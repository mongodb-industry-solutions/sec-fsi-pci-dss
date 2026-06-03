import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { PARTY_AUTHENTICATION_COLLECTION, PartyAuthenticationControlRecord } from '../models/partyAuthentication.model';
import { AUTHENTICATION_DOMAIN_COLLECTION, AuthenticationDomainRecord } from '../models/authenticationDomain.model';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  name: string;
  domain: string;
}

export async function loginUser(
  db: Db,
  email: string,
  password: string,
  domain: string
): Promise<{ token: string; user: Omit<JwtPayload, 'iat' | 'exp'> }> {
  const user = await db
    .collection<PartyAuthenticationControlRecord>(PARTY_AUTHENTICATION_COLLECTION)
    .findOne({ partyAuthenticationUserEmailAddress: email } as Partial<PartyAuthenticationControlRecord>);

  if (!user) {
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  const valid = await bcrypt.compare(password, user.partyAuthenticationCredentialHash);
  if (!valid) {
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  const payload: JwtPayload = {
    sub: user.partyAuthenticationInstanceReference,
    email: user.partyAuthenticationUserEmailAddress,
    role: user.partyAuthenticationUserRole,
    name: user.partyAuthenticationUserName,
    domain: user.partyAuthenticationLoginDomain,
  };

  const secret = process.env.JWT_SECRET!;
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
    },
  };
}

/**
 * Returns demo users for the local domain by reading directly from the seed file.
 * This avoids QE-decryption complexity for a UI helper endpoint: the seed file
 * already contains plaintext emails and names (passwords are bcrypt-hashed and
 * are NOT returned). This is safe for demo purposes only.
 */
export async function getDemoUsers(_db: Db) {
  const filePath = path.join(__dirname, '../../../data/users.json');
  const records: PartyAuthenticationControlRecord[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  return records
    .filter((u) => u.partyAuthenticationAccountStatus === 'active')
    .map((u) => ({
      email: u.partyAuthenticationUserEmailAddress,
      name: u.partyAuthenticationUserName,
      role: u.partyAuthenticationUserRole,
    }));
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
