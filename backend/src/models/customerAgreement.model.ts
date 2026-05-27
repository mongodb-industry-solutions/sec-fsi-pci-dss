// BIAN SD-53: Customer Agreement

export const CUSTOMER_AGREEMENT_COLLECTION = 'customerAgreementQE';
export const CUSTOMER_AGREEMENT_SENSITIVE_COLLECTION = 'customerAgreementSensitiveQE';

export interface CustomerAgreementControlRecord {
  customerAgreementInstanceReference: string;
  // QE equality: searchable encrypted fields
  customerEmailAddress: string;
  customerMobilePhoneNumber: string;
  customerAgreementReference: string;
  // Plaintext fields (customerName becomes QE equality in v2)
  customerName: string;
  customerSegment: CustomerSegment;
  agreementStatus: AgreementStatus;
  enrollmentDateTime: Date;
  preferredLanguage: string;
  // v4: recurring payment mandate
  preferredPaymentCardReference?: string;
  bianServiceDomain: 'CustomerAgreement';
  bianControlRecordType: 'CustomerAgreement';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
}

export interface CustomerAgreementSensitiveRecord {
  customerAgreementInstanceReference: string;
  // QE none: retrieval only under Level 2 escalation
  residentialAddressFull: ResidentialAddress;
  governmentIdentificationReference: string;
  internalRiskProfileNotes: string;
}

export interface ResidentialAddress {
  streetAddress: string;
  city: string;
  postalCode: string;
  countryCode: string;
}

export type CustomerSegment = 'retail' | 'premium' | 'corporate' | 'sme';
export type AgreementStatus = 'active' | 'suspended' | 'closed';
