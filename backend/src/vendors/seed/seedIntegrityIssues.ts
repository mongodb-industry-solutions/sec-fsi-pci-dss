import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';

// Deliberate duplicate plan — each entry creates N additional documents that share
// the same fraudDiagnosisCaseReference as an existing canonical seed record.
// The duplicates have divergent status/score to make the audit demo interesting.
const DUPLICATE_PLAN: Array<{
  ref: string;
  copies: Array<{ statusOverride: string; scoreOffset: number; delaySeconds: number }>;
}> = [
  { ref: 'FD-2026-000005', copies: [{ statusOverride: 'under_review', scoreOffset: +8,  delaySeconds: 37  }] },
  { ref: 'FD-2026-000007', copies: [{ statusOverride: 'open',         scoreOffset: -15, delaySeconds: 12  },
                                     { statusOverride: 'escalated',    scoreOffset: +5,  delaySeconds: 120 }] },
  { ref: 'FD-2026-000011', copies: [{ statusOverride: 'open',         scoreOffset: -20, delaySeconds: 8   }] },
  { ref: 'FD-2026-000016', copies: [{ statusOverride: 'open',         scoreOffset: -30, delaySeconds: 55  },
                                     { statusOverride: 'under_review', scoreOffset: -10, delaySeconds: 180 }] },
  { ref: 'FD-2026-000010', copies: [{ statusOverride: 'open',         scoreOffset: -5,  delaySeconds: 22  }] },
];

export async function seedIntegrityIssues(client: MongoClient): Promise<{
  duplicatesInserted: number;
  refsAffected: number;
  skippedRefs: string[];
}> {
  const dbName = process.env.MONGODB_DB_NAME ?? 'fsi_pci_dss';
  const db = client.db(dbName);
  const col = db.collection('fraudDiagnosisCase');

  // Drop the unique index so we can insert duplicates past the constraint.
  // setup:db recreates it and triggers the self-healing dedup path.
  await col.dropIndex('fraudDiagnosisCaseReference_1').catch(() => { /* already absent */ });

  let duplicatesInserted = 0;
  const skippedRefs: string[] = [];

  for (const plan of DUPLICATE_PLAN) {
    const canonical = await col.findOne({ fraudDiagnosisCaseReference: plan.ref });
    if (!canonical) {
      skippedRefs.push(plan.ref);
      continue;
    }

    for (const copy of plan.copies) {
      const baseDateTime = new Date(canonical.recordCreatedDateTime ?? canonical.fraudDiagnosisRequestDateTime ?? Date.now());
      const copyDateTime = new Date(baseDateTime.getTime() + copy.delaySeconds * 1000);

      const duplicate = {
        ...canonical,
        _id: undefined, // let MongoDB assign a new ObjectId
        fraudDiagnosisInstanceReference: uuidv4(),
        fraudDiagnosisCaseStatus: copy.statusOverride,
        'fraudDiagnosisAssessment.fraudDiagnosisScore':
          Math.max(0, Math.min(100, ((canonical.fraudDiagnosisAssessment?.fraudDiagnosisScore ?? 50) + copy.scoreOffset))),
        recordCreatedDateTime: copyDateTime.toISOString(),
      };
      delete duplicate._id;

      await col.insertOne(duplicate);
      duplicatesInserted++;
    }
  }

  console.log(
    `  seedIntegrityIssues: inserted ${duplicatesInserted} duplicate(s) across ${DUPLICATE_PLAN.length - skippedRefs.length} case reference(s)`,
  );
  if (skippedRefs.length) {
    console.log(`  skipped (not found in collection): ${skippedRefs.join(', ')}`);
  }

  return { duplicatesInserted, refsAffected: DUPLICATE_PLAN.length - skippedRefs.length, skippedRefs };
}
