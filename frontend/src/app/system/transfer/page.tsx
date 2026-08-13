'use client';
import Link from 'next/link';
import { ArrowLeftRight, SendHorizonal, Landmark, QrCode, ChevronRight, HandCoins, CreditCard } from 'lucide-react';
import { SectionHeader } from '../../../components/SectionHeader';
import { Breadcrumb } from '../../../components/Breadcrumb';
import { useEffect, useState } from 'react';
import { getToken, decodeToken } from '../../../lib/auth';

function MethodCard({ icon, title, description, href }: {
  icon: React.ReactNode; title: string; description: string; href: string;
}) {
  return (
    <Link
      href={href}
      className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-[#00ED64]/60 hover:shadow-sm transition-all group flex items-center gap-4"
    >
      <div className="w-11 h-11 rounded-lg bg-[#001E2B]/5 flex items-center justify-center shrink-0 group-hover:bg-[#001E2B]/10 transition-colors">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 text-sm">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5 truncate">{description}</p>
      </div>
      <ChevronRight size={16} className="text-gray-400 shrink-0 group-hover:text-gray-600 transition-colors" />
    </Link>
  );
}

export default function TransferPage() {
  const [role, setRole] = useState('');

  useEffect(() => {
    const t = getToken() ?? '';
    if (t) setRole(decodeToken(t)?.role ?? '');
  }, []);

  if (role && role !== 'customer') {
    return (
      <div className="w-full px-5 sm:px-8 py-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          Access denied. This page is available to customers only.
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Transfer' }]} />
      <SectionHeader
        icon={ArrowLeftRight}
        title="Transfer"
        description="Send, receive or request money"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <MethodCard
          icon={<SendHorizonal size={20} className="text-[#001E2B]" />}
          title="Send to contact"
          description="P2P transfer to a saved beneficiary instantly"
          href="/system/transfer/send"
        />
        <MethodCard
          icon={<Landmark size={20} className="text-[#001E2B]" />}
          title="Bank transfer"
          description="Send to a saved recipient or new bank account"
          href="/system/transfer/bank"
        />
        <MethodCard
          icon={<QrCode size={20} className="text-[#001E2B]" />}
          title="Request payment"
          description="Create a shareable payment link for any amount"
          href="/system/transfer/request"
        />
        <MethodCard
          icon={<HandCoins size={20} className="text-[#001E2B]" />}
          title="Request to Pay"
          description="Request money from someone; they approve to pay"
          href="/system/transfer/rtp"
        />
        <MethodCard
          icon={<CreditCard size={20} className="text-[#001E2B]" />}
          title="New merchant payment"
          description="Pay a merchant with one of your cards"
          href="/system/payment"
        />
      </div>

      {/* Transfer is a simplified menu of methods only. Pending RTP approvals live in
          /system/payment/history (filter "Pending approval"); each opens its detail to approve/reject. */}
    </div>
  );
}
