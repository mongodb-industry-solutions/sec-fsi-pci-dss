import { Db } from 'mongodb';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import {
  CUSTOMER_AUTHENTICATION_COLLECTION, CustomerAuthenticationAssessmentRecord, CustomerAuthRole,
} from '../models/customerAuthentication.model';

// ADR-030 / SD-91: local-domain user administration (manager-managed). Role assignment references
// the global `role` collection (any builtin or custom role name). Passwords are bcrypt-hashed
// (12 rounds) and never returned. Remote (OIDC/SAML) domains manage role MAPPINGS instead, not users.

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  domain: string;
  status: 'active' | 'suspended';
  featured?: boolean;
}

const BCRYPT_ROUNDS = 12;

function toManaged(u: CustomerAuthenticationAssessmentRecord): ManagedUser {
  return {
    id: u.customerAuthenticationInstanceReference,
    email: u.customerAuthenticationEmailAddress,
    name: u.customerAuthenticationUserName,
    role: u.customerAuthenticationUserRole,
    domain: u.customerAuthenticationLoginDomain,
    status: u.customerAuthenticationAccountStatus,
    featured: u.customerAuthenticationDemoFeatured,
  };
}

export async function listManagedUsers(db: Db, opts?: { domain?: string; q?: string }): Promise<ManagedUser[]> {
  const query: Record<string, unknown> = {};
  if (opts?.domain) query.customerAuthenticationLoginDomain = opts.domain;
  if (opts?.q?.trim()) {
    const rx = new RegExp(opts.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ customerAuthenticationUserName: rx }, { customerAuthenticationEmailAddress: rx }];
  }
  const users = await db.collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION)
    .find(query).sort({ customerAuthenticationUserName: 1 }).toArray();
  return users.map(toManaged);
}

export async function createUser(db: Db, input: {
  email: string; name: string; role: string; domain?: string; password: string; status?: 'active' | 'suspended';
}): Promise<ManagedUser> {
  const col = db.collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION);
  const email = input.email.trim().toLowerCase();
  const existing = await col.findOne({ customerAuthenticationEmailAddress: email });
  if (existing) throw new Error(`A user with email '${email}' already exists.`);

  const record: CustomerAuthenticationAssessmentRecord = {
    customerAuthenticationInstanceReference: randomUUID(),
    partyInstanceReference: randomUUID(),
    customerAuthenticationEmailAddress: email,
    customerAuthenticationCredentialHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
    customerAuthenticationUserRole: input.role as CustomerAuthRole,
    customerAuthenticationUserName: input.name.trim(),
    customerAuthenticationLoginDomain: (input.domain ?? 'local') as 'local' | 'msentra',
    customerAuthenticationAccountStatus: input.status ?? 'active',
    bianServiceDomain: 'Customer Authentication',
    bianControlRecordType: 'CustomerAuthenticationAssessment',
    recordCreatedDateTime: new Date(),
    schemaVersion: 2,
  };
  await col.insertOne(record);
  return toManaged(record);
}

export async function updateUser(db: Db, id: string, patch: {
  name?: string; role?: string; status?: 'active' | 'suspended'; password?: string;
}): Promise<ManagedUser | null> {
  const col = db.collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION);
  const set: Partial<CustomerAuthenticationAssessmentRecord> = {};
  if (typeof patch.name === 'string') set.customerAuthenticationUserName = patch.name.trim();
  if (typeof patch.role === 'string') set.customerAuthenticationUserRole = patch.role as CustomerAuthRole;
  if (patch.status === 'active' || patch.status === 'suspended') set.customerAuthenticationAccountStatus = patch.status;
  if (patch.password) set.customerAuthenticationCredentialHash = await bcrypt.hash(patch.password, BCRYPT_ROUNDS);
  if (Object.keys(set).length === 0) {
    const cur = await col.findOne({ customerAuthenticationInstanceReference: id });
    return cur ? toManaged(cur) : null;
  }
  // QE-encrypted collection: findOneAndUpdate with returnDocument:'after' is rejected
  // ("findAndModify with encryption only supports new: false"). Update, then read back.
  const upd = await col.updateOne(
    { customerAuthenticationInstanceReference: id },
    { $set: set },
  );
  if (upd.matchedCount === 0) return null;
  const doc = await col.findOne({ customerAuthenticationInstanceReference: id });
  return doc ? toManaged(doc) : null;
}

export async function deleteUser(db: Db, id: string): Promise<boolean> {
  const res = await db.collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION)
    .deleteOne({ customerAuthenticationInstanceReference: id });
  return res.deletedCount > 0;
}
