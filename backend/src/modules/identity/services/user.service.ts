import { Db, MongoCryptError } from 'mongodb';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import {
  CUSTOMER_AUTHENTICATION_COLLECTION, CustomerAuthenticationAssessmentRecord, CustomerAuthRole,
} from '../models/customerAuthentication.model';
import { PARTY_COLLECTION, PartyControlRecord } from '../models/party.model';
import { getSensitiveTierDb, getEncryptionWriteDb } from '../../../vendors/encryption/roleClients';
import { phoneDigest } from '../../../vendors/encryption/digest';
import { resolveAuthDomainName, PLATFORM_AUTH_DOMAIN } from '../models/authenticationDomain.model';

// Account status includes `pending` for self-registered accounts awaiting manager approval
// (see registration flow). Pending and suspended accounts cannot log in.
export type ManagedUserStatus = 'active' | 'suspended' | 'pending';

// Contact PII (email/phone/name) is Party data, not credentials. Phone is
// QE:equality-encrypted with a blind-index digest for uniqueness. Reads/writes go through the
// QE-enabled role client. This helper creates or updates the linked party's contact fields and
// keeps the phone digest in sync, rejecting a phone already owned by another party.
async function writePartyContact(
  partyRef: string,
  patch: { name?: string; email?: string; phone?: string },
): Promise<void> {
  const roleDb = await getEncryptionWriteDb('user.partyContact.update');
  const col = roleDb.collection<PartyControlRecord>(PARTY_COLLECTION);
  const existing = await col.findOne({ partyInstanceReference: partyRef });

  const set: Record<string, unknown> = {};
  if (typeof patch.name === 'string') set.partyName = patch.name.trim();
  if (typeof patch.email === 'string') set.partyEmailAddress = patch.email.trim().toLowerCase();
  if (typeof patch.phone === 'string' && patch.phone.trim()) {
    const digest = phoneDigest(patch.phone);
    const clash = await col.findOne(
      { partyMobilePhoneNumberDigest: digest, partyInstanceReference: { $ne: partyRef } },
      { projection: { partyInstanceReference: 1 } },
    );
    if (clash) throw Object.assign(new Error('Phone number already in use by another party'), { statusCode: 409 });
    set.partyMobilePhoneNumber = patch.phone.trim();
    set.partyMobilePhoneNumberDigest = digest;
  }
  if (Object.keys(set).length === 0) return;

  if (existing) {
    set.recordUpdatedDateTime = new Date();
    await col.updateOne({ partyInstanceReference: partyRef }, { $set: set });
    return;
  }
  // No party yet (e.g. an admin-created account): create the minimal identity record.
  const now = new Date();
  await col.insertOne({
    partyInstanceReference: partyRef,
    partyEmailAddress: (set.partyEmailAddress as string) ?? '',
    // Omit the phone (and its digest) entirely when none was given, so a phone-less party leaves the
    // field ABSENT (matches the model + partial unique index) rather than storing an empty string.
    ...(set.partyMobilePhoneNumber
      ? { partyMobilePhoneNumber: set.partyMobilePhoneNumber as string, partyMobilePhoneNumberDigest: set.partyMobilePhoneNumberDigest as string }
      : {}),
    partyName: (set.partyName as string) ?? '',
    partyType: 'customer',
    bianServiceDomain: 'Party Data Management',
    bianControlRecordType: 'Party',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 2,
  } as PartyControlRecord);
}

/** Reads the linked party's phone (QE:equality) for the detail view. Returns undefined if absent. */
async function readPartyPhone(partyRef: string): Promise<string | undefined> {
  if (!partyRef) return undefined;
  try {
    const roleDb = await getSensitiveTierDb('user.detail.contactRead');
    const party = await roleDb.collection<PartyControlRecord>(PARTY_COLLECTION)
      .findOne({ partyInstanceReference: partyRef }, { projection: { partyMobilePhoneNumber: 1 } });
    return party?.partyMobilePhoneNumber || undefined;
  } catch (err) {
    // Graceful degradation, QE-only: a QE read can fail if the deployed crypt_shared lib does not
    // support a configured queryType (e.g. substringPreview on <8.2). The phone is a non-critical
    // detail field, so on a crypto/QE error we omit it and still render the rest of the user record
    // rather than 500 the page. Any OTHER error (auth, network, driver bug) is unexpected and MUST
    // propagate so it is not silently hidden (it then reaches pino + the admin log panel onError hook).
    if (!(err instanceof MongoCryptError)) throw err;
    console.warn(`[users] party phone read degraded (QE) for ${partyRef}: ${err.message}`);
    return undefined;
  }
}

// ADR-030 / local-domain user administration (manager-managed). Role assignment references
// the global `role` collection (any builtin or custom role name). Passwords are bcrypt-hashed
// (12 rounds) and never returned. Remote (OIDC/SAML) domains manage role MAPPINGS instead, not users.

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  domain: string;
  status: ManagedUserStatus;
  featured?: boolean;
  // Read-only detail fields (surfaced on the single-user view, stripped from the lean list response).
  partyReference?: string;
  lastLoginAt?: string;
  createdAt?: string;
  // Contact PII from the linked party ; only populated on the single-user detail read.
  phone?: string;
}

const BCRYPT_ROUNDS = 12;

// Seed records store dates as ISO strings ($set of raw JSON), while records written at runtime
// store real Date objects. Normalize both to an ISO string without assuming the type.
function toIso(v: unknown): string | undefined {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v) return v;
  return undefined;
}

function toManaged(u: CustomerAuthenticationAssessmentRecord): ManagedUser {
  return {
    id: u.customerAuthenticationInstanceReference,
    email: u.customerAuthenticationEmailAddress,
    name: u.customerAuthenticationUserName,
    role: u.customerAuthenticationUserRole,
    domain: u.customerAuthenticationLoginDomain,
    status: u.customerAuthenticationAccountStatus,
    featured: u.customerAuthenticationDemoFeatured,
    partyReference: u.partyInstanceReference,
    lastLoginAt: toIso(u.customerAuthenticationLastLoginDateTime),
    createdAt: toIso(u.recordCreatedDateTime),
  };
}

export async function getManagedUser(db: Db, id: string): Promise<ManagedUser | null> {
  const doc = await db.collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION)
    .findOne({ customerAuthenticationInstanceReference: id });
  if (!doc) return null;
  const managed = toManaged(doc);
  managed.phone = await readPartyPhone(doc.partyInstanceReference);
  return managed;
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
  email: string; name: string; role: string; domain?: string; password: string;
  status?: ManagedUserStatus; phone?: string;
}): Promise<ManagedUser> {
  const col = db.collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION);
  const email = input.email.trim().toLowerCase();
  const existing = await col.findOne({ customerAuthenticationEmailAddress: email });
  if (existing) throw Object.assign(new Error(`A user with email '${email}' already exists.`), { statusCode: 409 });

  const partyRef = randomUUID();
  // Contact PII lives in the party. Create it up-front (name/email always; phone when given)
  // so the account is a proper BIAN identity and is discoverable (e.g. beneficiary lookup by phone).
  await writePartyContact(partyRef, { name: input.name, email, phone: input.phone });

  const record: CustomerAuthenticationAssessmentRecord = {
    customerAuthenticationInstanceReference: randomUUID(),
    partyInstanceReference: partyRef,
    customerAuthenticationEmailAddress: email,
    customerAuthenticationCredentialHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
    customerAuthenticationUserRole: input.role as CustomerAuthRole,
    customerAuthenticationUserName: input.name.trim(),
    customerAuthenticationLoginDomain: (resolveAuthDomainName(input.domain) ?? PLATFORM_AUTH_DOMAIN) as 'leafypay' | 'msentra',
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
  name?: string; role?: string; status?: ManagedUserStatus; password?: string; phone?: string;
}): Promise<ManagedUser | null> {
  const col = db.collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION);

  const current = await col.findOne({ customerAuthenticationInstanceReference: id });
  if (!current) return null;

  // Contact PII (name/phone) is mirrored to the linked party. Phone throws 409 on a clash.
  // Pass the account email too so that, if the party has to be created (missing doc), it is complete.
  if (typeof patch.phone === 'string' || (typeof patch.name === 'string' && current.partyInstanceReference)) {
    await writePartyContact(current.partyInstanceReference, {
      name: patch.name,
      phone: patch.phone,
      email: current.customerAuthenticationEmailAddress,
    });
  }

  const set: Partial<CustomerAuthenticationAssessmentRecord> = {};
  if (typeof patch.name === 'string') set.customerAuthenticationUserName = patch.name.trim();
  if (typeof patch.role === 'string') set.customerAuthenticationUserRole = patch.role as CustomerAuthRole;
  if (patch.status === 'active' || patch.status === 'suspended' || patch.status === 'pending') set.customerAuthenticationAccountStatus = patch.status;
  if (patch.password) set.customerAuthenticationCredentialHash = await bcrypt.hash(patch.password, BCRYPT_ROUNDS);
  if (Object.keys(set).length === 0) return toManaged(current);

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
