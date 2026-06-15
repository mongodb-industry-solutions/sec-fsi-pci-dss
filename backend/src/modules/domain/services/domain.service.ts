// Auth Domains internal module — full CRUD over the authenticationDomain collection (BIAN SD-16).
// A Module with NO Provider counterpart (ADR-029): the PSP's own authentication-domain registry.
import { Db, Filter, Document } from 'mongodb';
import { randomUUID } from 'crypto';
import {
  AUTHENTICATION_DOMAIN_COLLECTION,
  AuthenticationDomainRecord,
} from '../../identity/models/authenticationDomain.model';

export interface ListParams { q?: string; page?: number; limit?: number }
export interface ListResult {
  items: AuthenticationDomainRecord[];
  total: number;
  page: number;
  limit: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function listAuthDomains(db: Db, params: ListParams): Promise<ListResult> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 10)); // default 10/page (§5.4)
  const filter: Filter<Document> = {};
  if (params.q && params.q.trim()) {
    const rx = new RegExp(escapeRegex(params.q.trim()), 'i');
    filter.$or = [
      { partyAuthenticationDomainName: rx },
      { partyAuthenticationDomainDisplayName: rx },
      { partyAuthenticationDomainType: rx },
    ];
  }
  const col = db.collection(AUTHENTICATION_DOMAIN_COLLECTION);
  const total = await col.countDocuments(filter);
  const docs = await col
    .find(filter)
    .sort({ partyAuthenticationDomainName: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();
  return { items: docs as unknown as AuthenticationDomainRecord[], total, page, limit };
}

export async function getAuthDomain(db: Db, ref: string): Promise<AuthenticationDomainRecord | null> {
  const doc = await db
    .collection(AUTHENTICATION_DOMAIN_COLLECTION)
    .findOne({ partyAuthenticationDomainInstanceReference: ref });
  return (doc as unknown as AuthenticationDomainRecord) ?? null;
}

export async function createAuthDomain(
  db: Db,
  input: Partial<AuthenticationDomainRecord>,
): Promise<AuthenticationDomainRecord> {
  const record: AuthenticationDomainRecord = {
    partyAuthenticationDomainInstanceReference: input.partyAuthenticationDomainInstanceReference ?? `authdom-${randomUUID()}`,
    partyAuthenticationDomainName: (input.partyAuthenticationDomainName ?? 'local') as AuthenticationDomainRecord['partyAuthenticationDomainName'],
    partyAuthenticationDomainDisplayName: input.partyAuthenticationDomainDisplayName ?? '',
    partyAuthenticationDomainType: (input.partyAuthenticationDomainType ?? 'local') as AuthenticationDomainRecord['partyAuthenticationDomainType'],
    partyAuthenticationDomainFlowType: input.partyAuthenticationDomainFlowType,
    partyAuthenticationDomainEnabled: input.partyAuthenticationDomainEnabled ?? true,
    partyAuthenticationDomainAlertMessage: input.partyAuthenticationDomainAlertMessage,
    partyAuthenticationDomainConfiguration: input.partyAuthenticationDomainConfiguration ?? {},
    bianServiceDomain: 'PartyAuthentication',
    bianControlRecordType: 'AuthenticationDomain',
    recordCreatedDateTime: new Date(),
    schemaVersion: 1,
  };
  await db.collection(AUTHENTICATION_DOMAIN_COLLECTION).insertOne(record as unknown as Document);
  return record;
}

export async function updateAuthDomain(
  db: Db,
  ref: string,
  patch: Partial<AuthenticationDomainRecord>,
): Promise<AuthenticationDomainRecord | null> {
  const { partyAuthenticationDomainInstanceReference: _ignore, ...rest } = patch;
  await db.collection(AUTHENTICATION_DOMAIN_COLLECTION).updateOne(
    { partyAuthenticationDomainInstanceReference: ref },
    { $set: rest as Document },
  );
  return getAuthDomain(db, ref);
}

export async function deleteAuthDomain(db: Db, ref: string): Promise<boolean> {
  const res = await db
    .collection(AUTHENTICATION_DOMAIN_COLLECTION)
    .deleteOne({ partyAuthenticationDomainInstanceReference: ref });
  return res.deletedCount === 1;
}
