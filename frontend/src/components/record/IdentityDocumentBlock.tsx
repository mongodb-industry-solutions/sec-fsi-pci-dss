'use client';
// The identity document (SD-53) from customerAgreementGovernmentID. All leaves are lookup tier:
// number QE:suffix, type and issuing country QE:equality, expiry QE:range, tax ID QE:prefix.
import { IdCard } from 'lucide-react';
import { RecordGroup } from './RecordGroup';
import { RecordField } from './RecordField';
import { humanize, fmtDate } from './format';

export interface GovernmentIdView {
  type?: unknown;
  number?: unknown;
  issuingCountry?: unknown;
  expiryDate?: unknown;
}

export const IDENTITY_DOCUMENT_INFO =
  'The government-issued identity document verified at KYC (SD-53). Each leaf is QE-encrypted at rest: '
  + 'number by suffix search, type and issuing country by equality, expiry by range. The tax ID is a '
  + 'separate QE:prefix field.';

/** Field help, declared once so every surface explains the datum identically (P3). */
export const IDENTITY_FIELD_INFO = {
  type: 'Kind of identity document (passport, national ID, driver licence and so on). QE:equality encrypted at rest.',
  number: 'Identity document number. QE:suffix encrypted, so it stays searchable by suffix (for example the last 4) while encrypted at rest.',
  issuingCountry: 'Country that issued the document (ISO 3166-1 alpha-2). QE:equality encrypted at rest.',
  expiryDate: 'Document expiry date. QE:range encrypted, searchable by range (for example expiring soon) without exposing the value.',
  taxId: 'Taxpayer identification number. QE:prefix encrypted, so it stays searchable by prefix while encrypted at rest.',
} as const;

export function IdentityDocumentBlock({
  governmentId,
  taxIdNumber,
  showTaxId = true,
  asGroup = true,
}: {
  governmentId?: GovernmentIdView | null;
  taxIdNumber?: unknown;
  showTaxId?: boolean;
  /** false renders only the rows, for embedding in an existing group. */
  asGroup?: boolean;
}) {
  const gov = governmentId ?? {};
  const rows = (
    <>
      <RecordField label="Document type" tier="lookup" value={humanize(gov.type)} info={IDENTITY_FIELD_INFO.type} />
      <RecordField label="Document number" tier="lookup" mono value={gov.number ? String(gov.number) : ''} info={IDENTITY_FIELD_INFO.number} />
      <RecordField label="Issuing country" tier="lookup" value={humanize(gov.issuingCountry)} info={IDENTITY_FIELD_INFO.issuingCountry} />
      <RecordField label="Expiry date" tier="lookup" value={fmtDate(gov.expiryDate)} info={IDENTITY_FIELD_INFO.expiryDate} />
      {showTaxId && (
        <RecordField label="Tax ID" tier="lookup" mono value={taxIdNumber ? String(taxIdNumber) : ''} info={IDENTITY_FIELD_INFO.taxId} />
      )}
    </>
  );

  if (!asGroup) return rows;
  return (
    <RecordGroup icon={IdCard} title="Identity document" info={IDENTITY_DOCUMENT_INFO}>
      {rows}
    </RecordGroup>
  );
}
