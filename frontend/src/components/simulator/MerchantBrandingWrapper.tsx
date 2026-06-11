'use client';

interface Props {
  merchantName: string;
  amount: number;
  currency: string;
  description: string;
  children: React.ReactNode;
}

export function MerchantBrandingWrapper({ merchantName, amount, currency, description, children }: Props) {
  const formatted = new Intl.NumberFormat('en-EU', { style: 'currency', currency }).format(amount);
  return (
    <div className="max-w-2xl mx-auto">
      {/* Simulated merchant site header */}
      <div className="bg-white border rounded-t-xl shadow-sm px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Merchant site</div>
          <div className="font-bold text-[#001E2B] text-lg">{merchantName}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500 mb-0.5">{description}</div>
          <div className="text-2xl font-bold text-[#001E2B]">{formatted}</div>
        </div>
      </div>

      {/* "Browser address bar" label */}
      <div className="bg-gray-100 border-x border-b px-4 py-1.5 flex items-center gap-2">
        <span className="text-gray-400">🔒</span>
        <span className="text-xs text-gray-500 font-mono truncate">https://merchant.example.com/checkout</span>
        <span className="ml-auto text-[10px] bg-amber-100 text-amber-700 border border-amber-300 rounded px-1.5">
          merchant site
        </span>
      </div>

      {/* Checkout section, iframe lives here */}
      <div className="bg-gray-50 border-x border-b rounded-b-xl px-6 py-5">
        <div className="mb-3 flex items-center gap-2 text-xs text-gray-500">
          <span>↓ Embedded payment form (hosted by payment gateway)</span>
          <span className="bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5">iframe</span>
        </div>
        {children}
      </div>
    </div>
  );
}
