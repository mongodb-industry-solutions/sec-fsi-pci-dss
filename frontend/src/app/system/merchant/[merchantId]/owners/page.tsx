'use client';
// v31 (§7): beneficial owners / shareholders on the merchant administration shell. Any owner or staff
// can view; owner CRUD requires merchants:manage (staff). Bound to GET /merchants/:id/kyb/owners.
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Users } from 'lucide-react';
import { useMerchant } from '../../../../../lib/merchantContext';
import { OwnersPanel } from '../../../../../components/merchant/OwnersPanel';
import { useEffectivePermissions } from '../../../../../lib/permissions';

export default function MerchantOwnersPage() {
  const { token, merchant } = useMerchant();
  const { can } = useEffectivePermissions();
  const merchantId = (merchant as unknown as Record<string, unknown> | null)?.merchantAgreementInstanceReference as string | undefined;
  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <SectionHeader icon={Users} title="Owners & Shareholders" description="Beneficial owners (UBO), ownership participation and controlling persons." debugInfo=" + FATF/4th AMLD" />
      {merchantId && token ? <OwnersPanel merchantId={merchantId} token={token} canManage={can('merchants', 'manage')} /> : <div className="text-sm text-gray-500">Loading…</div>}
    </div>
  );
}
