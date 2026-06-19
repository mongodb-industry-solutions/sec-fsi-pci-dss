'use client';
import type { PaymentMethod, PaymentMethodId } from '../../types/simulator';

interface Props {
  methods: PaymentMethod[];
  selected: PaymentMethodId | null;
  onSelect: (id: PaymentMethodId) => void;
}

export function PaymentMethodSelector({ methods, selected, onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {methods.map((m) => {
        const active = selected === m.id;
        const disabled = !m.enabled;
        return (
          <button
            key={m.id}
            disabled={disabled}
            onClick={() => !disabled && onSelect(m.id)}
            className={[
              'relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-left transition-all',
              active
                ? 'border-[#00ED64] bg-[#001E2B] text-white shadow-lg'
                : disabled
                ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                : 'border-gray-200 bg-white hover:border-[#00ED64]/60 hover:shadow-md cursor-pointer',
            ].join(' ')}
          >
            {m.comingSoon && (
              <span className="absolute top-2 right-2 text-[10px] bg-amber-100 text-amber-700 border border-amber-300 rounded px-1">
                Soon
              </span>
            )}
            <span className="text-2xl">{m.icon}</span>
            <span className={`text-xs font-semibold text-center leading-tight ${active ? 'text-[#00ED64]' : 'text-gray-800'}`}>
              {m.label}
            </span>
            <span className={`text-[10px] text-center leading-tight ${active ? 'text-gray-300' : 'text-gray-500'}`}>
              {m.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
