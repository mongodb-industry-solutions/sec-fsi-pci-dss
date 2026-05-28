import { Db } from 'mongodb';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { PARTY_AUTHENTICATION_COLLECTION, PartyAuthenticationControlRecord } from '../models';

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
    .findOne({ authenticationUserEmailAddress: email } as Partial<PartyAuthenticationControlRecord>);

  if (!user) {
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  const valid = await bcrypt.compare(password, user.authenticationPasswordHash);
  if (!valid) {
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  const payload: JwtPayload = {
    sub: user.partyAuthenticationInstanceReference,
    email: user.authenticationUserEmailAddress,
    role: user.authenticationUserRole,
    name: user.authenticationUserName,
    domain: user.authenticationDomain,
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
    .find({}, { projection: { authenticationUserName: 1, authenticationUserEmailAddress: 1, authenticationUserRole: 1 } })
    .toArray();

  return users.map((u) => ({
    email: u.authenticationUserEmailAddress,
    name: u.authenticationUserName,
    role: u.authenticationUserRole,
  }));
}
