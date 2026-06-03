import { Db } from 'mongodb';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { PARTY_AUTHENTICATION_COLLECTION, PartyAuthenticationControlRecord } from '../models/partyAuthentication.model';

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

export async function getDemoUsers(db: Db) {
  const users = await db
    .collection<PartyAuthenticationControlRecord>(PARTY_AUTHENTICATION_COLLECTION)
    .find({}, { projection: { partyAuthenticationUserName: 1, partyAuthenticationUserEmailAddress: 1, partyAuthenticationUserRole: 1 } })
    .toArray();

  return users.map((u) => ({
    email: u.partyAuthenticationUserEmailAddress,
    name: u.partyAuthenticationUserName,
    role: u.partyAuthenticationUserRole,
  }));
}
