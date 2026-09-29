'use client';
import { useState } from 'react';
import { admin } from '../../lib/adminClient';
import { FormShell, NumberField, TextField } from '../form/Fields';

// The ceiling an authorisation on this card is judged against.
//
// Only a per-transaction limit is offered, and that is deliberate rather than unfinished: a daily limit needs a
// running tally of the day's authorisations per card, which this bank does not keep. Offering the field anyway
// would produce a limit that silently does nothing, which is worse than an absent one because an operator would
// believe it was in force.

export function CardLimits({
  cardToken, initial, onSaved,
}: {
  cardToken: string;
  initial?: { perTransactionAmount?: number; limitCurrency?: string };
  onSaved?: () => void;
}) {
  const [amount, setAmount] = useState<number | ''>(initial?.perTransactionAmount ?? '');
  const [currency, setCurrency] = useState(initial?.limitCurrency ?? '');

  const dirty = amount !== (initial?.perTransactionAmount ?? '')
    || currency !== (initial?.limitCurrency ?? '');

  return (
    <FormShell
      dirty={dirty}
      submitLabel="Set the limit"
      onReset={() => {
        setAmount(initial?.perTransactionAmount ?? '');
        setCurrency(initial?.limitCurrency ?? '');
      }}
      onSubmit={async () => {
        await admin.put(`cards/${encodeURIComponent(cardToken)}/limits`, {
          ...(amount === '' ? {} : { perTransactionAmount: amount }),
          ...(currency ? { limitCurrency: currency.toUpperCase() } : {}),
        });
        onSaved?.();
      }}
      note="A limit takes effect on the next authorisation. The engine reads it per call, so nothing restarts."
    >
      <NumberField
        label="Per transaction"
        value={amount}
        onChange={setAmount}
        min={0}
        step={0.01}
        hint="The largest single authorisation this card may receive. Leave empty for no ceiling."
      />
      <TextField
        label="Currency"
        value={currency}
        onChange={setCurrency}
        maxLength={3}
        mono
        placeholder="EUR"
        hint="The currency the ceiling is expressed in. A limit with no currency is a number that means nothing."
      />
    </FormShell>
  );
}
