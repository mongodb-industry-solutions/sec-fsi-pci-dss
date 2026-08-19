import { Db } from 'mongodb';
import { randomUUID } from 'node:crypto';
import {
  CREDIT_ASSESSMENT_COLLECTION, CreditAssessmentRecord, CreditAssessmentFactor, CreditRating,
} from '../models/creditAssessment.model';
import { ACCOUNT_ARRANGEMENT_COLLECTION, AccountArrangementControlRecord } from '../../aspsp/models/accountArrangement.model';
import { ACCOUNT_MOVEMENT_COLLECTION, AccountMovementRecord } from '../../aspsp/models/accountMovement.model';
import { resolveModuleConfig } from '../../admin/services/bankModuleConfiguration.service';

// The assessment, derived from what this bank actually knows about the party: how long the relationship has
// run, what it holds, whether payments have been returned. That is the point of the bureau being the bank.
//
// It replaces a constant. The PSP's engine returned 720/A/0.02 for everyone, which made the capability a
// placeholder: nothing about the customer changed the answer, so nothing about the answer meant anything.

export interface CreditBureauConfig {
  baseScore: number;
  minimumScore: number;
  maximumScore: number;
  // Rating boundaries, highest band first. Read from configuration so an operator can retune the demo.
  ratingBands: Array<{ rating: CreditRating; minimumScore: number }>;
  // Points awarded per full year of relationship, capped.
  pointsPerRelationshipYear: number;
  maximumRelationshipPoints: number;
  // Points for holding a balance, per band.
  balanceBands: Array<{ minimumBalance: number; points: number }>;
  // Deducted per returned payment, which is the strongest negative signal a bank has on its own books.
  pointsPerReturnedPayment: number;
  // How far back the payment history is read.
  historyDays: number;
}

export const DEFAULT_CREDIT_BUREAU_CONFIG: CreditBureauConfig = {
  baseScore: 600,
  minimumScore: 300,
  maximumScore: 850,
  ratingBands: [
    { rating: 'A', minimumScore: 760 },
    { rating: 'B', minimumScore: 700 },
    { rating: 'C', minimumScore: 640 },
    { rating: 'D', minimumScore: 560 },
    { rating: 'E', minimumScore: 0 },
  ],
  pointsPerRelationshipYear: 12,
  maximumRelationshipPoints: 60,
  balanceBands: [
    { minimumBalance: 10_000, points: 90 },
    { minimumBalance: 5_000, points: 60 },
    { minimumBalance: 1_000, points: 35 },
    { minimumBalance: 100, points: 10 },
    { minimumBalance: 0, points: 0 },
  ],
  pointsPerReturnedPayment: 45,
  historyDays: 365,
};

/** Reads the live configuration per call, so a retune takes effect without a restart. */
export async function creditBureauConfig(db: Db): Promise<CreditBureauConfig> {
  const merged = await resolveModuleConfig(
    db, 'credit-bureau', DEFAULT_CREDIT_BUREAU_CONFIG as unknown as Record<string, unknown>,
  );
  return merged as unknown as CreditBureauConfig;
}

export interface AssessmentEvidence {
  relationshipYears: number;
  totalAvailableBalance: number;
  currency?: string;
  returnedPaymentCount: number;
  accountCount: number;
}

function ratingFor(score: number, bands: CreditBureauConfig['ratingBands']): CreditRating {
  // Highest band whose floor the score reaches. Sorted here rather than trusting the configuration order,
  // since a mis-ordered band list would otherwise silently hand out the wrong rating.
  const sorted = [...bands].sort((a, b) => b.minimumScore - a.minimumScore);
  return sorted.find((band) => score >= band.minimumScore)?.rating ?? 'E';
}

/**
 * Turns the evidence into a score, a rating and a default probability, with the factors that produced it.
 *
 * Pure, so the scoring can be tested without a database, and explainable, because an assessment nobody can
 * account for cannot be contested by the person it is about.
 */
export function assess(evidence: AssessmentEvidence, config: CreditBureauConfig): {
  creditScore: number;
  creditRating: CreditRating;
  defaultProbability: number;
  assessmentFactors: CreditAssessmentFactor[];
} {
  const factors: CreditAssessmentFactor[] = [];

  const relationshipPoints = Math.min(
    config.maximumRelationshipPoints,
    Math.floor(evidence.relationshipYears) * config.pointsPerRelationshipYear,
  );
  factors.push({
    assessmentFactorName: 'relationship_length',
    assessmentFactorPoints: relationshipPoints,
    assessmentFactorObservation: `${Math.floor(evidence.relationshipYears)} full year(s) of banking history`,
  });

  const balanceBand = [...config.balanceBands]
    .sort((a, b) => b.minimumBalance - a.minimumBalance)
    .find((band) => evidence.totalAvailableBalance >= band.minimumBalance);
  const balancePoints = balanceBand?.points ?? 0;
  factors.push({
    assessmentFactorName: 'available_balance',
    assessmentFactorPoints: balancePoints,
    assessmentFactorObservation: `${evidence.totalAvailableBalance.toFixed(2)} available across ${evidence.accountCount} account(s)`,
  });

  // Guarded against negative zero, which no returned payments would otherwise produce and which reads
  // wrongly wherever the factor is displayed.
  const returnPenalty = evidence.returnedPaymentCount === 0
    ? 0
    : -(evidence.returnedPaymentCount * config.pointsPerReturnedPayment);
  factors.push({
    assessmentFactorName: 'returned_payments',
    assessmentFactorPoints: returnPenalty,
    assessmentFactorObservation: evidence.returnedPaymentCount === 0
      ? 'no returned payments on this bank\'s books'
      : `${evidence.returnedPaymentCount} returned payment(s) in the reviewed period`,
  });

  const raw = config.baseScore + relationshipPoints + balancePoints + returnPenalty;
  const creditScore = Math.max(config.minimumScore, Math.min(config.maximumScore, raw));
  const creditRating = ratingFor(creditScore, config.ratingBands);

  // Mapped from the score across the usable range rather than tabulated per rating, so two scores in the
  // same band do not report an identical probability.
  const span = Math.max(1, config.maximumScore - config.minimumScore);
  const position = (creditScore - config.minimumScore) / span;
  const defaultProbability = Number((0.25 * (1 - position) ** 2).toFixed(4));

  return { creditScore, creditRating, defaultProbability, assessmentFactors: factors };
}

// ── Evidence, from this bank's own records ───────────────────────────────────────────────────────

export async function gatherEvidence(
  db: Db, accountHolderReference: string, historyDays: number, now = new Date(),
): Promise<AssessmentEvidence | null> {
  const accounts = await db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION)
    .find(
      { accountHolderInstanceReference: accountHolderReference },
      { projection: { _id: 0, accountArrangementInstanceReference: 1, accountBalance: 1, accountOpenedDateTime: 1, accountStatus: 1 } },
    )
    .toArray();
  // Not a party this bank banks. Refused rather than scored on nothing: an assessment of an unknown party
  // would be a number with no evidence behind it.
  if (accounts.length === 0) return null;

  const active = accounts.filter((account) => account.accountStatus === 'active');
  const totalAvailableBalance = active.reduce((sum, account) => sum + (account.accountBalance?.availableAmount ?? 0), 0);

  const opened = accounts
    .map((account) => new Date(account.accountOpenedDateTime).getTime())
    .filter((time) => Number.isFinite(time));
  const earliest = opened.length > 0 ? Math.min(...opened) : now.getTime();
  const relationshipYears = (now.getTime() - earliest) / (365.25 * 24 * 60 * 60 * 1000);

  const since = new Date(now.getTime() - historyDays * 24 * 60 * 60 * 1000).toISOString();
  const returnedPaymentCount = await db.collection<AccountMovementRecord>(ACCOUNT_MOVEMENT_COLLECTION)
    .countDocuments({
      accountArrangementInstanceReference: { $in: accounts.map((a) => a.accountArrangementInstanceReference) },
      movementKind: 'return',
      movementValueDateTime: { $gte: since },
    });

  return {
    relationshipYears: Math.max(0, relationshipYears),
    totalAvailableBalance,
    currency: active[0]?.accountBalance?.currency,
    returnedPaymentCount,
    accountCount: active.length,
  };
}

export type AssessmentRefusal = 'unknown_party';

/** Assesses and records. The record is kept so a decision can be reviewed as it stood, not re-derived. */
export async function assessAndRecord(
  db: Db, accountHolderReference: string, now = new Date(),
): Promise<
  | { ok: true; assessment: CreditAssessmentRecord; evidence: AssessmentEvidence }
  | { ok: false; refusal: AssessmentRefusal }
> {
  const config = await creditBureauConfig(db);
  const evidence = await gatherEvidence(db, accountHolderReference, config.historyDays, now);
  if (!evidence) return { ok: false, refusal: 'unknown_party' };

  const scored = assess(evidence, config);
  const timestamp = now.toISOString();
  const assessment: CreditAssessmentRecord = {
    creditAssessmentInstanceReference: `cas_${randomUUID()}`,
    accountHolderInstanceReference: accountHolderReference,
    ...scored,
    assessmentAsOfDateTime: timestamp,
    bianServiceDomain: 'Customer Credit Rating',
    bianControlRecordType: 'CustomerCreditRatingState',
    recordCreatedDateTime: timestamp,
    schemaVersion: 1,
  };

  // One current assessment per party, replaced in place: a bureau answers with its present view, and the
  // history that matters is in the movements the assessment was derived from.
  const { creditAssessmentInstanceReference, recordCreatedDateTime, ...mutable } = assessment;
  await db.collection<CreditAssessmentRecord>(CREDIT_ASSESSMENT_COLLECTION).updateOne(
    { accountHolderInstanceReference: accountHolderReference },
    {
      $set: { ...mutable, recordUpdatedDateTime: timestamp },
      // The reference and the creation date belong to the record, not to this reassessment of it. Setting
      // them on both sides would also be a conflicting update, which Mongo rejects outright.
      $setOnInsert: { creditAssessmentInstanceReference, recordCreatedDateTime },
    },
    { upsert: true },
  );
  return { ok: true, assessment, evidence };
}

export async function findAssessment(db: Db, accountHolderReference: string): Promise<CreditAssessmentRecord | null> {
  return db.collection<CreditAssessmentRecord>(CREDIT_ASSESSMENT_COLLECTION)
    .findOne({ accountHolderInstanceReference: accountHolderReference }, { projection: { _id: 0 } });
}
