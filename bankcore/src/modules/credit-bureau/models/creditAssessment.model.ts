// The bank's credit assessment of a party it banks.
//
// A bank IS a credit bureau for its own customers: it holds the accounts, the balances and the payment
// history, which is the evidence an assessment is made of. That is why this moved here in v37 P7's wake,
// and why the score is derived rather than declared.
//
// The PSP keeps its own `customerCreditRatingState`, which despite the name holds transaction-monitoring
// risk FLAGS rather than any credit score. Those belong to fraud investigation, which stays at the PSP.
export const CREDIT_ASSESSMENT_COLLECTION = 'creditAssessmentState';

export type CreditRating = 'A' | 'B' | 'C' | 'D' | 'E';

export interface CreditAssessmentFactor {
  // What the factor looked at, in words a person reviewing a decline can act on.
  assessmentFactorName: string;
  // Signed contribution to the score, so the total is explainable rather than asserted.
  assessmentFactorPoints: number;
  assessmentFactorObservation: string;
}

export interface CreditAssessmentRecord {
  creditAssessmentInstanceReference: string;
  // Whose assessment this is, as this bank knows them.
  accountHolderInstanceReference: string;
  creditScore: number;
  creditRating: CreditRating;
  defaultProbability: number;
  // The evidence, kept with the decision: an assessment nobody can explain cannot be contested, and
  // an assessment that cannot be contested is not one a regulator accepts.
  assessmentFactors: CreditAssessmentFactor[];
  assessmentAsOfDateTime: string;
  bianServiceDomain: string;
  bianControlRecordType: 'CustomerCreditRatingState';
  recordCreatedDateTime: string;
  recordUpdatedDateTime?: string;
  schemaVersion: number;
}
