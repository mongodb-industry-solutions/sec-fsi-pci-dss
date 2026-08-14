import { CheckCircle2, XCircle, Clock, AlertTriangle, MinusCircle, RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Presentation metadata for a movement lifecycle state, shared by the history views.
export type StatusMeta = { label: string; color: string; Icon: LucideIcon };

// Every state a card transaction, a payment execution or an RTP can reach.
export const PAYMENT_STATUS: Record<string, StatusMeta> = {
  authorized: { label: 'Authorized',  color: 'bg-green-100 text-green-800',        Icon: CheckCircle2 },
  settled:    { label: 'Settled',     color: 'bg-emerald-100 text-emerald-800 font-semibold', Icon: CheckCircle2 },
  captured:   { label: 'Captured',    color: 'bg-teal-100 text-teal-800',          Icon: CheckCircle2 },
  pending:    { label: 'Pending',     color: 'bg-amber-100 text-amber-800',        Icon: Clock },
  declined:   { label: 'Declined',    color: 'bg-red-100 text-red-800',            Icon: XCircle },
  voided:     { label: 'Voided',      color: 'bg-gray-100 text-gray-500',          Icon: MinusCircle },
  refunded:   { label: 'Refunded',    color: 'bg-purple-100 text-purple-700',      Icon: RotateCcw },
  failed:     { label: 'Failed',      color: 'bg-red-100 text-red-800',            Icon: XCircle },
  expired:    { label: 'Expired',     color: 'bg-gray-100 text-gray-500',          Icon: MinusCircle },
  completed:  { label: 'Completed',   color: 'bg-emerald-100 text-emerald-800 font-semibold', Icon: CheckCircle2 },
  disputed:   { label: 'Disputed',    color: 'bg-orange-100 text-orange-800',      Icon: AlertTriangle },
  reversed:   { label: 'Reversed',    color: 'bg-red-100 text-red-800',            Icon: XCircle },
  rejected:   { label: 'Rejected',    color: 'bg-red-100 text-red-800',            Icon: XCircle },
  cancelled:  { label: 'Cancelled',   color: 'bg-gray-100 text-gray-500',          Icon: MinusCircle },
};

// An unmapped state still needs an Icon: `<undefined />` throws React #130 and blanks the page.
export function paymentStatusMeta(status?: string | null): StatusMeta {
  const value = (status ?? '').trim();
  return PAYMENT_STATUS[value]
    ?? { label: value ? value.replace(/_/g, ' ') : 'unknown', color: 'bg-gray-100 text-gray-700', Icon: Clock };
}
