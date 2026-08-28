'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { admin } from '../../lib/adminClient';
import { FormShell, NumberField, SelectField, TextField } from '../form/Fields';
import { ReferencePicker } from '../form/ReferencePicker';
import { Panel } from '../Reveal';

// Issuing a card.
//
// The number is NOT entered here, and cannot be: the bank mints it inside one of its own declared ranges, so
// the card it hands out is one it can recognise later and one whose check digit is right. A form that accepted
// a typed number would be a form for entering a card that belongs to a different issuer.
//
// It lands `issued`, not active. The gap is the approval: a card becomes usable when an operator accepts it,
// and collapsing the two would make that step decorative.

const NETWORKS = [
  { value: 'VISA', label: 'Visa' },
  { value: 'MASTERCARD', label: 'Mastercard' },
  { value: 'AMEX', label: 'American Express' },
];

const MONTHS = Array.from({ length: 12 }, (_, index) => {
  const month = String(index + 1).padStart(2, '0');
  return { value: month, label: month };
});

interface HolderRow extends Record<string, unknown> {
  accountHolderInstanceReference: string;
  accountHolderNameMasked: string;
}

interface AccountRow extends Record<string, unknown> {
  accountArrangementInstanceReference: string;
  accountMaskedIban: string;
  accountCurrency: string;
}

export function CardCreate() {
  const router = useRouter();
  const currentYear = new Date().getFullYear();

  const [network, setNetwork] = useState('VISA');
  const [expiryMonth, setExpiryMonth] = useState('12');
  const [expiryYear, setExpiryYear] = useState(String(currentYear + 3));
  const [holder, setHolder] = useState('');
  const [account, setAccount] = useState('');
  const [limit, setLimit] = useState<number | ''>('');
  const [currency, setCurrency] = useState('EUR');

  return (
    <Panel
      title="A new card"
      description="Every card this bank issues today is a debit card: it draws on a funding account, and an authorisation is a hold against that account's balance."
    >
      <FormShell
        dirty
        submitLabel="Issue the card"
        note="The card number and its verification value are minted by the bank and never leave the vault. The card lands issued, and an operator activates it once the holder has it."
        onSubmit={async () => {
          const created = await admin.create<{ cardToken?: string; paymentCardReference?: string }>('cards', {
            network,
            expiryMonth,
            expiryYear,
            ...(holder ? { accountHolderReference: holder } : {}),
            ...(account ? { fundingAccountReference: account } : {}),
            ...(limit === '' ? {} : { limits: { perTransactionAmount: limit, limitCurrency: currency.toUpperCase() } }),
          });
          const token = created.cardToken ?? created.paymentCardReference;
          // Straight to the card that was just made: the next thing an operator does is look at it, and
          // returning to a list means finding it again.
          router.push(token ? `/cards/${encodeURIComponent(token)}` : '/cards');
        }}
      >
        <SelectField
          label="Network"
          value={network}
          onChange={setNetwork}
          options={NETWORKS}
          hint="Decides the range the number is minted from and how long the verification value is."
        />
        <SelectField
          label="Expiry month"
          value={expiryMonth}
          onChange={setExpiryMonth}
          options={MONTHS}
        />
        <SelectField
          label="Expiry year"
          value={expiryYear}
          onChange={setExpiryYear}
          options={Array.from({ length: 8 }, (_, index) => {
            const year = String(currentYear + index);
            return { value: year, label: year };
          })}
          hint="The verification value is derived from the expiry, so changing it later changes that value too."
        />
        <ReferencePicker<HolderRow>
          label="Owner"
          resource="holders"
          value={holder}
          onChange={setHolder}
          optionLabel={(row) => `${row.accountHolderNameMasked} (${row.accountHolderInstanceReference.slice(0, 8)})`}
          optionValue={(row) => row.accountHolderInstanceReference}
          hint="Whose card it is. Names are shown masked because they are encrypted at rest."
        />
        <ReferencePicker<AccountRow>
          label="Funding account"
          resource="accounts"
          value={account}
          onChange={setAccount}
          query={{ status: 'active', ...(holder ? { holder } : {}) }}
          optionLabel={(row) => `${row.accountMaskedIban} ${row.accountCurrency}`}
          optionValue={(row) => row.accountArrangementInstanceReference}
          hint="The account an authorisation holds against. Only active accounts are offered, and only the chosen owner's once one is picked."
        />
        <NumberField
          label="Per-transaction limit"
          value={limit}
          onChange={setLimit}
          min={0}
          step={0.01}
          hint="Optional. The largest single authorisation this card may receive."
        />
        <TextField
          label="Limit currency"
          value={currency}
          onChange={setCurrency}
          maxLength={3}
          mono
          hint="Only used when a limit is set."
        />
      </FormShell>
    </Panel>
  );
}
