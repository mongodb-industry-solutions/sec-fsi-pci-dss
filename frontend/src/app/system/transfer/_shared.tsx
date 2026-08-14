'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { formatAmount } from '../../../lib/money';

export interface Beneficiary {
  counterpartyArrangementReference: string;
  counterpartyLabel: string;
  counterpartyLookupType: 'phone' | 'email';
  counterpartyLookupHint: string;
  counterpartyArrangementStatus: 'active' | 'removed';
}

export interface PayoutAccountOption {
  payoutAccountInstanceReference: string;
  payoutAccountAlias?: string;
  payoutAccountBankName?: string;
  payoutAccountCurrency: string;
  payoutAccountIsDefault: boolean;
  payoutAccountBalance?: { availableAmount: number };
}

export function fmtAmount(n: number, currency: string) {
  return formatAmount(n, currency, { locale: 'en-GB' });
}

export function useAccountsAndBeneficiaries(partyRef: string, token: string) {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [bLoaded, setBLoaded] = useState(false);
  const [accounts, setAccounts] = useState<PayoutAccountOption[]>([]);
  const [aLoaded, setALoaded] = useState(false);
  const [fromAccountRef, setFromAccountRef] = useState('');
  const [beneficiaryRef, setBeneficiaryRef] = useState('');

  useEffect(() => {
    api.beneficiaries.list(token, { ownerRef: partyRef })
      .then(r => {
        const list = (r.results ?? []) as unknown as Beneficiary[];
        const active = list.filter(b => b.counterpartyArrangementStatus !== 'removed');
        setBeneficiaries(active);
        setBLoaded(true);
        if (active.length > 0) setBeneficiaryRef(active[0].counterpartyArrangementReference);
      })
      .catch(() => setBLoaded(true));
    api.accounts.list(partyRef, token, { status: 'active' })
      .then(r => {
        const accts = r.results as unknown as PayoutAccountOption[];
        setAccounts(accts);
        setALoaded(true);
        const primary = accts.find(a => a.payoutAccountIsDefault) ?? accts[0];
        if (primary) setFromAccountRef(primary.payoutAccountInstanceReference);
      })
      .catch(() => setALoaded(true));
  }, [partyRef, token]);

  return { beneficiaries, bLoaded, accounts, aLoaded, fromAccountRef, setFromAccountRef, beneficiaryRef, setBeneficiaryRef };
}
