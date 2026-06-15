import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { ROLE_COLLECTION, BUILTIN_ROLES, RoleRecord } from '../../shared/models/acl.model';

// ADR-030: seed the 6 builtin roles (plan §13.2 matrix) into the `role` collection.
// Source of truth = backend/data/role.json (same pattern as the other seeds). If the file is
// missing, falls back to BUILTIN_ROLES in code — which is ALSO the runtime enforcement fallback,
// so the DB can never diverge from what the ACL guard expects.
// Uses $setOnInsert so a manager's later edits to a builtin role's permissions survive re-seeds.
type SeedRole = Omit<RoleRecord, 'recordCreatedDateTime' | 'recordUpdatedDateTime'>;

function loadSeedRoles(): SeedRole[] {
  const filePath = path.join(__dirname, '../../../data/role.json');
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SeedRole[];
  } catch {
    /* fall through to the in-code matrix */
  }
  return BUILTIN_ROLES;
}

export async function seedRoles(db: Db) {
  const now = new Date();
  let upserted = 0;
  for (const role of loadSeedRoles()) {
    const doc: RoleRecord = { ...role, recordCreatedDateTime: now, recordUpdatedDateTime: now };
    await db.collection<RoleRecord>(ROLE_COLLECTION).updateOne(
      { roleName: role.roleName },
      { $setOnInsert: doc },
      { upsert: true }
    );
    upserted++;
  }
  console.log(`  roles: ${upserted} builtin upserted`);
}
