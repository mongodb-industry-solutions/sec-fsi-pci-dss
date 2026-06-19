'use client';
import type { SimulatorScenario } from '../../types/simulator';

const OUTCOME_STYLES: Record<string, string> = {
  fraud: 'bg-red-50 border-red-200 text-red-700',
  legit: 'bg-green-50 border-green-200 text-green-700',
  borderline: 'bg-amber-50 border-amber-200 text-amber-700',
};

interface Props {
  scenarios: SimulatorScenario[];
  selected: string | null;
  onSelect: (id: string) => void;
}

export function ScenarioSelector({ scenarios, selected, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {scenarios.map((s) => {
        const active = selected === s.id;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={[
              'flex items-start gap-4 rounded-xl border-2 p-4 text-left transition-all w-full',
              active
                ? 'border-[#00ED64] bg-[#001E2B] text-white shadow-lg'
                : 'border-gray-200 bg-white hover:border-[#00ED64]/60 hover:shadow-md cursor-pointer',
            ].join(' ')}
          >
            <div className="mt-0.5">
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${active ? 'border-[#00ED64] bg-[#00ED64]' : 'border-gray-400'}`}>
                {active && <div className="w-1.5 h-1.5 rounded-full bg-[#001E2B]" />}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{s.label}</div>
              <div className={`text-xs mt-0.5 ${active ? 'text-gray-300' : 'text-gray-500'}`}>{s.description}</div>
              <span className={`inline-block mt-2 text-[11px] font-medium border rounded px-2 py-0.5 ${active ? 'border-[#00ED64]/40 bg-[#00ED64]/10 text-[#00ED64]' : OUTCOME_STYLES[s.expectedOutcome]}`}>
                {s.outcomeLabel}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
