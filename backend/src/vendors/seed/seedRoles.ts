import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { ROLE_COLLECTION, BUILTIN_ROLES, RoleRecord } from '../../shared/models/acl.model';

// ADR-030: seed the 6 builtin roles (plan §13.2 matrix) into the `role` collection.
// Source of truth = backend/data/role.json. Falls back to BUILTIN_ROLES in code.
//
// Merge strategy for existing builtin roles:
//   - $setOnInsert: metadata fields (label, description, scope, bianServiceDomain, createdAt)
//     — preserves manager edits to those fields.
//   - $set rolePermissions: always overwritten from seed so new resources added to code
//     (e.g. 'accounts' in v17) propagate on re-seed without needing a manual DB patch.
//     A manager who customised permissions will see them reset; that is acceptable for builtin
//     roles because the seed is the authoritative permission matrix (ADR-030 §3).
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
    await db.collection<RoleRecord>(ROLE_COLLECTION).updateOne(
      { roleName: role.roleName },
      {
        $setOnInsert: { recordCreatedDateTime: now },
        $set: {
          roleLabel:              role.roleLabel,
          roleDescription:        role.roleDescription,
          rolePermissions:        role.rolePermissions,
          roleScope:              role.roleScope,
          roleIsBuiltin:          role.roleIsBuiltin,
          bianServiceDomain:      role.bianServiceDomain,
          bianControlRecordType:  role.bianControlRecordType,
          recordUpdatedDateTime:  now,
        },
      },
      { upsert: true }
    );
    upserted++;
  }
  console.log(`  roles: ${upserted} builtin synced`);
}
