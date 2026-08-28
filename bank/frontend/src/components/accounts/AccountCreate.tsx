'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { admin } from '../../lib/adminClient';
import { FormShell, SelectField, TextField } from '../form/Fields';
import { ReferencePicker } from '../form/ReferencePicker';
import { Panel } from '../Reveal';

// Opening an account.
//
// The IBAN is not entered, and could not be: the bank builds it from its OWN declared bank code with a check
// digit, so the account it opens is one that routes back to it. An IBAN typed in by hand would either belong to
// another institution or fail the first validator that saw it.
//
// It lands waiting for approval, never active. Opening and approving are two acts by two people, which is the
// whole point of having an approval step.

interface HolderRow extends Record<string, unknown> {
  accountHolderInstanceReference: string;
  accountHolderNameMasked: string;
  accountHolderCountryCode: string;
}

export function AccountCreate() {
  const router = useRouter();
  const [holder, setHolder] = useState('');
  const [kind, setKind] = useState('current');
  const [currency, setCurrency] = useState('EUR');
  const [country, setCountry] = useState('ES');
  const [alias, setAlias] = useState('');

  return (
    <Panel
      title="A new account"
      description="The bank derives the IBAN itself, from a bank code it has declared. What is chosen here is who it belongs to and what it is for."
    >
      <FormShell
        dirty={holder !== ''}
        submitLabel="Open the account"
        note="The account opens waiting for approval and holds nothing until an operator accepts it. The IBAN is not shown here: it is encrypted, and reading it is a separate recorded act on the account's own page."
        onSubmit={async () => {
          const created = await admin.create<{ accountArrangementInstanceReference?: string }>('accounts', {
            accountHolderReference: holder,
            accountKind: kind,
            accountCurrency: currency.toUpperCase(),
            accountCountryCode: country.toUpperCase(),
            ...(alias ? { accountAlias: alias } : {}),
          });
          const reference = created.accountArrangementInstanceReference;
          router.push(reference ? `/accounts/${encodeURIComponent(reference)}` : '/accounts');
        }}
      >
        <ReferencePicker<HolderRow>
          label="Owner"
          resource="holders"
          value={holder}
          onChange={setHolder}
          required
          optionLabel={(row) => `${row.accountHolderNameMasked} (${row.accountHolderCountryCode})`}
          optionValue={(row) => row.accountHolderInstanceReference}
          hint="An account with no owner is not an account. Names are masked because they are encrypted at rest."
        />
        <SelectField
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'current', label: 'Current, for day-to-day payments' },
            { value: 'savings', label: 'Savings' },
          ]}
        />
        <TextField
          label="Currency"
          value={currency}
          onChange={setCurrency}
          maxLength={3}
          mono
          required
          hint="The currency the balance is held in. It cannot change afterwards."
        />
        <TextField
          label="Country"
          value={country}
          onChange={setCountry}
          maxLength={2}
          mono
          required
          hint="The two letters the IBAN starts with, which decide how it is validated."
        />
        <TextField
          label="Alias"
          value={alias}
          onChange={setAlias}
          maxLength={60}
          placeholder="Household account"
          hint="Optional, and searchable. It is the only name on the account a list can show without decrypting anything."
        />
      </FormShell>
    </Panel>
  );
}
