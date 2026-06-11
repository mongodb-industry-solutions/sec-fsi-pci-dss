import { getToken, decodeToken } from './auth';

export interface SimulatorHistoryEntry {
  txnId: string;
  amount: number;
  currency: string;
  merchant: string;
  mcc: string;
  channel: string;
  cardTransactionType: string;
  maskedPan: string;
  status: string;
  fraudCaseCreated: boolean;
  caseId?: string | null;
  createdAt: string;
  paymentReference?: string | null;
}

export function writeSimulatorTransactionToHistory(entry: SimulatorHistoryEntry): void {
  try {
    const token = getToken();
    const user = token ? decodeToken(token) : null;
    if (!user?.sub) return;

    const key = `demo_transactions_${user.sub}`;
    const stored: SimulatorHistoryEntry[] = JSON.parse(localStorage.getItem(key) ?? '[]');
    const deduplicated = stored.filter((t) => t.txnId !== entry.txnId);
    deduplicated.unshift(entry);
    localStorage.setItem(key, JSON.stringify(deduplicated.slice(0, 50)));
  } catch { /* ignore storage errors */ }
}
