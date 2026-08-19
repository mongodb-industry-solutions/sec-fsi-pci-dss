import { Db } from 'mongodb';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { CUSTOMER_AUTHENTICATION_COLLECTION, CustomerAuthenticationAssessmentRecord } from '../models/customerAuthentication.model';
import { AUTHENTICATION_DOMAIN_COLLECTION, AuthenticationDomainRecord } from '../models/authenticationDomain.model';
import { MERCHANT_AGREEMENT_COLLECTION, MerchantAgreementControlRecord } from '../../gateway/models/merchantAgreement.model';
import { createUser } from './user.service';
import { emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';
import { resolveAuthDomainName, PLATFORM_AUTH_DOMAIN } from '../models/authenticationDomain.model';

// Deterministic role ordering for the demo roster (login picker + simulator share this order).
const ROLE_RANK: Record<string, number> = {
  customer: 0,
  merchant_officer: 1,
  level1_analyst: 2,
  level2_investigator: 3,
  security_auditor: 4,
  operations_officer: 5,
  manager: 6,
};

export interface JwtPayload {
  sub: string;       // customerAuthenticationInstanceReference
  email: string;
  role: string;
  name: string;
  domain: string;
  partyRef?: string; // Ch-05: partyInstanceReference , present for all users with a Party record
  epoch?: number;    // session validity epoch current at sign time (server-side logout invalidation)
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

  // BOTH sides are resolved through the alias, not just the request. A caller integrated before the rename
  // may send `local`, and a record written before it may STORE `local`; normalising one side only would tell
  // one of the two that its correct password was wrong.
  if (resolveAuthDomainName(user.customerAuthenticationLoginDomain) !== resolveAuthDomainName(domain)) {
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  const valid = await bcrypt.compare(password, user.customerAuthenticationCredentialHash);
  if (!valid) {
    // Wrong password for a known account. Identify the user so an auditor/manager can see WHO failed.
    emitComplianceEvent(db, {
      entityType: 'customer',
      entityId: user.customerAuthenticationInstanceReference,
      processType: 'authentication',
      processAction: 'auth.login.failed',
      processOutcome: 'rejected',
      performedByPartyReference: user.partyInstanceReference ?? user.customerAuthenticationInstanceReference,
      performedByRole: user.customerAuthenticationUserRole ?? 'customer',
      eventSummary: { domain, failureCause: 'invalid_password', accountStatus: user.customerAuthenticationAccountStatus ?? 'active' },
      bianServiceDomain: 'PartyAuthentication',
      bianControlRecordType: 'CustomerAuthenticationAssessment',
    });
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  // Block non-active accounts with a distinct 403 so the UI can explain why (not a wrong-password
  // case). Only `pending` (self-registered, awaiting approval) and `suspended` are rejected; an
  // absent status is treated as active for backward compatibility with legacy records.
  if (user.customerAuthenticationAccountStatus === 'pending' || user.customerAuthenticationAccountStatus === 'suspended') {
    const reason = user.customerAuthenticationAccountStatus === 'pending'
      ? 'Account pending approval'
      : 'Account suspended';
    // Blocked-user case (distinct from wrong password), clearly labelled for the audit trail.
    emitComplianceEvent(db, {
      entityType: 'customer',
      entityId: user.customerAuthenticationInstanceReference,
      processType: 'authentication',
      processAction: 'auth.login.blocked',
      processOutcome: 'rejected',
      performedByPartyReference: user.partyInstanceReference ?? user.customerAuthenticationInstanceReference,
      performedByRole: user.customerAuthenticationUserRole ?? 'customer',
      eventSummary: { domain, failureCause: `account_${user.customerAuthenticationAccountStatus}`, reason },
      bianServiceDomain: 'PartyAuthentication',
      bianControlRecordType: 'CustomerAuthenticationAssessment',
    });
    throw Object.assign(new Error(reason), { statusCode: 403 });
  }

  const payload: JwtPayload = {
    sub: user.customerAuthenticationInstanceReference,
    email: user.customerAuthenticationEmailAddress,
    role: user.customerAuthenticationUserRole,
    name: user.customerAuthenticationUserName,
    domain: user.customerAuthenticationLoginDomain,
    ...(user.partyInstanceReference && { partyRef: user.partyInstanceReference }),
    // Stamp the current session epoch so logout can invalidate this token server-side.
    epoch: user.customerAuthenticationSessionEpoch ?? 0,
  };

  const secret = process.env.PSP_JWT_SECRET ?? 'demo-local-secret-change-in-production';
  const expiresIn = process.env.PSP_JWT_EXPIRES_IN ?? '24h';
  const token = jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);

  // Successful authentication: identify the user + role/domain (no PII) so the full login flow is
  // trackable, and the correct-login case is distinguishable from failed/blocked in the audit trail.
  emitComplianceEvent(db, {
    entityType: 'customer',
    entityId: user.customerAuthenticationInstanceReference,
    processType: 'authentication',
    processAction: 'auth.login',
    processOutcome: 'verified',
    performedByPartyReference: user.partyInstanceReference ?? user.customerAuthenticationInstanceReference,
    performedByRole: user.customerAuthenticationUserRole ?? 'customer',
    eventSummary: { domain, role: user.customerAuthenticationUserRole },
    bianServiceDomain: 'PartyAuthentication',
    bianControlRecordType: 'CustomerAuthenticationAssessment',
  });

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
 * Current session epoch for a user (by customerAuthenticationInstanceReference == JWT `sub`).
 * Absent record or field means epoch 0. Read on each authenticated request by the auth middleware
 * to reject tokens issued before the last logout. Projection touches no QE-encrypted fields.
 */
export async function getCurrentSessionEpoch(db: Db, sub: string): Promise<number> {
  const rec = await db
    .collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION)
    .findOne(
      { customerAuthenticationInstanceReference: sub },
      { projection: { customerAuthenticationSessionEpoch: 1 } },
    );
  return rec?.customerAuthenticationSessionEpoch ?? 0;
}

/**
 * Server-side logout: bump the user's session epoch so every outstanding session JWT they hold is
 * immediately rejected by the middleware (stateless invalidation, no token store). Returns the new
 * epoch. Idempotent-safe: a user with no prior field goes 0 -> 1.
 */
export async function bumpSessionEpoch(db: Db, sub: string): Promise<number> {
  // Queryable Encryption rejects findAndModify with a projection/fields option on an encrypted
  // collection ("findAndModify fields must be empty") but not returnDocument itself, so this stays
  // atomic (single findOneAndUpdate) by reading the full pre-update document instead of a projection.
  const before = await db
    .collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION)
    .findOneAndUpdate(
      { customerAuthenticationInstanceReference: sub },
      { $inc: { customerAuthenticationSessionEpoch: 1 } },
      { returnDocument: 'before' },
    );
  if (!before) return 0; // no matching user, nothing incremented
  return (before.customerAuthenticationSessionEpoch ?? 0) + 1;
}

/**
 * Change the caller's own password. Verifies the current password, enforces the password policy on
 * the new one, rejects a no-op change, then rehashes (12-round bcrypt) and advances the session epoch
 * so every OTHER outstanding token is invalidated. A fresh token (stamped with the new epoch) is
 * returned so the current session stays valid. Only `local` accounts have a password to change.
 */
export async function changeOwnPassword(
  db: Db,
  sub: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ token: string }> {
  const col = db.collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION);
  const user = await col.findOne({ customerAuthenticationInstanceReference: sub } as Partial<CustomerAuthenticationAssessmentRecord>);
  if (!user) {
    throw Object.assign(new Error('Account not found'), { statusCode: 404 });
  }
  if (resolveAuthDomainName(user.customerAuthenticationLoginDomain) !== PLATFORM_AUTH_DOMAIN) {
    throw Object.assign(new Error('Password is managed by your identity provider and cannot be changed here'), { statusCode: 400 });
  }

  const currentValid = await bcrypt.compare(currentPassword, user.customerAuthenticationCredentialHash);
  if (!currentValid) {
    emitComplianceEvent(db, {
      entityType: 'customer',
      entityId: user.customerAuthenticationInstanceReference,
      processType: 'authentication',
      processAction: 'auth.password.change.failed',
      processOutcome: 'rejected',
      performedByPartyReference: user.partyInstanceReference ?? user.customerAuthenticationInstanceReference,
      performedByRole: user.customerAuthenticationUserRole ?? 'customer',
      eventSummary: { failureCause: 'invalid_current_password' },
      bianServiceDomain: 'PartyAuthentication',
      bianControlRecordType: 'CustomerAuthenticationAssessment',
    });
    throw Object.assign(new Error('Current password is incorrect'), { statusCode: 401 });
  }

  assertPasswordPolicy(newPassword);
  if (await bcrypt.compare(newPassword, user.customerAuthenticationCredentialHash)) {
    throw Object.assign(new Error('New password must be different from the current password'), { statusCode: 400 });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  const nextEpoch = (user.customerAuthenticationSessionEpoch ?? 0) + 1;
  await col.updateOne(
    { customerAuthenticationInstanceReference: sub } as Partial<CustomerAuthenticationAssessmentRecord>,
    { $set: { customerAuthenticationCredentialHash: newHash, customerAuthenticationSessionEpoch: nextEpoch } },
  );

  emitComplianceEvent(db, {
    entityType: 'customer',
    entityId: user.customerAuthenticationInstanceReference,
    processType: 'authentication',
    processAction: 'auth.password.change',
    processOutcome: 'verified',
    performedByPartyReference: user.partyInstanceReference ?? user.customerAuthenticationInstanceReference,
    performedByRole: user.customerAuthenticationUserRole ?? 'customer',
    eventSummary: { sessionsInvalidated: true }, // no PII, no secrets
    bianServiceDomain: 'PartyAuthentication',
    bianControlRecordType: 'CustomerAuthenticationAssessment',
  });

  // Reissue a token stamped with the new epoch so the current session survives the invalidation.
  const payload: JwtPayload = {
    sub: user.customerAuthenticationInstanceReference,
    email: user.customerAuthenticationEmailAddress,
    role: user.customerAuthenticationUserRole,
    name: user.customerAuthenticationUserName,
    domain: user.customerAuthenticationLoginDomain,
    ...(user.partyInstanceReference && { partyRef: user.partyInstanceReference }),
    epoch: nextEpoch,
  };
  const secret = process.env.PSP_JWT_SECRET ?? 'demo-local-secret-change-in-production';
  const expiresIn = process.env.PSP_JWT_EXPIRES_IN ?? '24h';
  const token = jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
  return { token };
}

/**
 * Returns demo users for the local domain by reading directly from the seed file.
 * This avoids QE-decryption complexity for a UI helper endpoint: the seed file
 * already contains plaintext emails and names (passwords are bcrypt-hashed and
 * are NOT returned). This is safe for demo purposes only.
 */
export interface DemoUserFilter {
  featured?: boolean;
  role?: string[];       // restrict to these roles
  q?: string;            // case-insensitive substring on name or email
  isMerchant?: boolean;  // only customers who own a merchant (merchantOwnerPartyReference)
}

export interface DemoUser {
  email: string;
  name: string;
  role: string;
  featured: boolean;
  partyRef: string;
  // Present when this user owns a merchant (customer + merchant). { id, name, mcc }.
  merchant?: { id: string; name: string; mcc?: string };
}

/**
 * Curated demo roster: the single, DB-backed, NON-hardcoded source shared by the /system login
 * picker (debug mode) and the /simulator. Reads the live `customerAuthentication` collection (the
 * seeder guarantees these users exist), resolves the merchant a customer owns via
 * `merchantOwnerPartyReference`, and returns a deterministic order so every load is identical when
 * the DB is unchanged. Callers pass declarative filters (see frontend `demoRoster.json`) so login
 * and simulator always draw from the same set.
 */
export async function getDemoUsers(db: Db, opts?: DemoUserFilter): Promise<DemoUser[]> {
  const query: Record<string, unknown> = { customerAuthenticationAccountStatus: 'active' };
  if (opts?.featured) query.customerAuthenticationDemoFeatured = true;
  if (opts?.role?.length) query.customerAuthenticationUserRole = { $in: opts.role };
  if (opts?.q) {
    const rx = { $regex: opts.q, $options: 'i' };
    query.$or = [{ customerAuthenticationUserName: rx }, { customerAuthenticationEmailAddress: rx }];
  }

  const records = await db
    .collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION)
    .find(query)
    .toArray();

  // Map merchant-owner party → { id, name }. One query; covers the whole roster.
  const ownerToMerchant = new Map<string, { id: string; name: string; mcc?: string }>();
  try {
    const merchants = await db
      .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
      .find({ merchantOwnerPartyReference: { $exists: true } } as Record<string, unknown>,
            { projection: { merchantOwnerPartyReference: 1, merchantAgreementInstanceReference: 1, merchantName: 1, merchantCategoryCode: 1 } })
      .toArray();
    for (const m of merchants) {
      const owner = (m as { merchantOwnerPartyReference?: string }).merchantOwnerPartyReference;
      if (owner) ownerToMerchant.set(owner, {
        id: m.merchantAgreementInstanceReference as string,
        name: m.merchantName as string,
        mcc: (m as { merchantCategoryCode?: string }).merchantCategoryCode,
      });
    }
  } catch { /* merchant collection optional, no merchant flag then */ }

  let users: DemoUser[] = records.map((u) => {
    // Ownership applies to the customer role only: staff are never merchant owners.
    const merchant = u.customerAuthenticationUserRole === 'customer'
      ? ownerToMerchant.get(u.partyInstanceReference)
      : undefined;
    return {
      email: u.customerAuthenticationEmailAddress,
      name: u.customerAuthenticationUserName,
      role: u.customerAuthenticationUserRole,
      featured: u.customerAuthenticationDemoFeatured === true,
      partyRef: u.partyInstanceReference,
      ...(merchant ? { merchant } : {}),
    };
  });

  if (opts?.isMerchant) users = users.filter((u) => !!u.merchant);

  // Deterministic order: role rank, then name, then email, identical on every load.
  users.sort((a, b) =>
    (ROLE_RANK[a.role] ?? 99) - (ROLE_RANK[b.role] ?? 99)
    || a.name.localeCompare(b.name)
    || a.email.localeCompare(b.email));

  return users;
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
    // Self-registration is only meaningful for local domains (remote users come from the IdP).
    selfRegistration: d.partyAuthenticationDomainType === 'local' && d.partyAuthenticationDomainSelfRegistrationEnabled === true,
  }));
}

/**
 * Validates that a domain accepts self-registration and returns its auto-approve policy.
 * Throws 400 if the domain is unknown, not local, disabled, or has self-registration off.
 */
export async function resolveSelfRegistrationDomain(db: Db, name: string): Promise<{ autoApprove: boolean }> {
  const d = await db.collection<AuthenticationDomainRecord>(AUTHENTICATION_DOMAIN_COLLECTION)
    .findOne({ partyAuthenticationDomainName: name as AuthenticationDomainRecord['partyAuthenticationDomainName'] });
  const ok = d
    && d.partyAuthenticationDomainEnabled
    && d.partyAuthenticationDomainType === 'local'
    && d.partyAuthenticationDomainSelfRegistrationEnabled === true;
  if (!ok) throw Object.assign(new Error('Self-registration is not available for this domain'), { statusCode: 400 });
  return { autoApprove: d.partyAuthenticationDomainSelfRegistrationAutoApprove === true };
}

/**
 * Self-service account registration (public). Domain logic lives here (Hexagonal): validate the
 * domain policy, force the lowest-privilege role, derive status from the auto-approve policy, create
 * the account + linked party (reuses createUser), then publish a compliance event so the
 * onboarding is auditable (EDA / PCI DSS). No PII is placed in the event summary.
 */
// Server-side password policy (mirrors the frontend PasswordFields checklist) so a direct API
// caller cannot bypass the UI and create a weak account. Shared by self-service registration
// and admin-created local users.
export function assertPasswordPolicy(password: string): void {
  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw Object.assign(
      new Error('Password must be at least 8 characters and include a letter and a number'),
      { statusCode: 400 },
    );
  }
}

export async function registerSelfServiceUser(
  db: Db,
  input: { name: string; email: string; password: string; phone?: string; domain: string },
): Promise<{ status: 'active' | 'pending' }> {
  assertPasswordPolicy(input.password);
  const { autoApprove } = await resolveSelfRegistrationDomain(db, input.domain);
  const status: 'active' | 'pending' = autoApprove ? 'active' : 'pending';

  const user = await createUser(db, {
    email: input.email,
    name: input.name,
    password: input.password,
    phone: input.phone,
    domain: input.domain,
    role: 'customer', // enforced: never client-selectable
    status,
  });

  emitComplianceEvent(db, {
    entityType: 'customer',
    entityId: user.id,
    processType: 'authentication',
    processAction: 'auth.register',
    processOutcome: autoApprove ? 'approved' : 'pending',
    performedByPartyReference: user.partyReference ?? user.id,
    performedByRole: 'customer',
    eventSummary: { domain: input.domain, selfRegistered: true, autoApprove }, // no PII
    bianServiceDomain: 'PartyAuthentication',
    bianControlRecordType: 'CustomerAuthenticationAssessment',
  });

  return { status };
}
