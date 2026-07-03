import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config';

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
  const dbName = config.mongodb.dbName;
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

  // Card duplicated by ERROR (SD-88): the same customer ends up holding the same physical card
  // (same masked PAN + network) under TWO different tokens — exactly what inconsistent/non-
  // deterministic tokenization would produce. The auditor's Data Integrity tool surfaces this as a
  // `tokenizationDuplicate`. (Deterministic tokens prevent it going forward; this is legacy bad data.)
  const cardCol = db.collection('paymentCardManagement');
  const sampleCard = await cardCol.findOne({ paymentCardStatus: 'active' });
  let cardDuplicatesInserted = 0;
  if (sampleCard) {
    const dup = {
      ...sampleCard,
      _id: undefined,
      paymentCardInstanceReference: uuidv4(),
      paymentCardReference: `pm_dupERR${uuidv4().replace(/-/g, '').slice(0, 10)}`, // different token
      paymentCardAlias: 'Duplicate (data error)',
      recordCreatedDateTime: new Date().toISOString(),
    };
    delete dup._id;
    await cardCol.insertOne(dup);
    cardDuplicatesInserted++;
  }

  console.log(
    `  seedIntegrityIssues: inserted ${duplicatesInserted} duplicate case(s) across ${DUPLICATE_PLAN.length - skippedRefs.length} reference(s); ${cardDuplicatesInserted} duplicate card(s)`,
  );
  if (skippedRefs.length) {
    console.log(`  skipped (not found in collection): ${skippedRefs.join(', ')}`);
  }

  return { duplicatesInserted, refsAffected: DUPLICATE_PLAN.length - skippedRefs.length, skippedRefs };
}
