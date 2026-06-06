'use client';
import { useState } from 'react';

interface Section {
  label: string;
  data: unknown;
}

export function DebugRawJson({ sections }: { sections: Section[] }) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  function toggle(i: number) {
    setExpanded(prev => ({ ...prev, [i]: !prev[i] }));
  }

  return (
    <div className="rounded-xl overflow-hidden border border-[#00ED64]/20">
      <div className="bg-[#001E2B] px-4 py-2 flex items-center gap-2">
        <span className="text-[#00ED64] text-xs font-semibold">⚙ Debug - Raw JSON</span>
        <span className="text-gray-500 text-xs">Click a section to expand</span>
      </div>
      {sections.map((section, i) => (
        <div key={i} className="border-t border-[#00ED64]/10">
          <button
            onClick={() => toggle(i)}
            className="w-full flex items-center justify-between px-4 py-2 bg-[#001E2B]/90 hover:bg-[#001E2B] transition-colors text-left"
          >
            <span className="text-xs text-gray-300 font-mono">{section.label}</span>
            <span className="text-[#00ED64] text-xs ml-2">{expanded[i] ? '▲' : '▼'}</span>
          </button>
          {expanded[i] && (
            <pre className={[
              'bg-[#001E2B] text-green-300 text-xs font-mono px-4 py-3',
              'whitespace-pre break-all max-h-64 overflow-auto',
              '[scrollbar-width:thin] [scrollbar-color:#00ED64_#001E2B]',
              '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5',
              '[&::-webkit-scrollbar-track]:bg-[#001020] [&::-webkit-scrollbar-track]:rounded-full',
              '[&::-webkit-scrollbar-thumb]:bg-[#00ED64]/40 [&::-webkit-scrollbar-thumb]:rounded-full',
              '[&::-webkit-scrollbar-thumb:hover]:bg-[#00ED64]/70',
              '[&::-webkit-scrollbar-corner]:bg-[#001020]',
            ].join(' ')}>
              {section.data == null
                ? 'null - data not yet loaded'
                : JSON.stringify(section.data, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
