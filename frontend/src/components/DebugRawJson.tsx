'use client';
import { useState } from 'react';
import { JsonView } from './json/JsonView';

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
            section.data == null ? (
              <pre className="bg-[#001E2B] text-gray-500 text-xs font-mono px-4 py-3 italic">null - data not yet loaded</pre>
            ) : (
              <div className="bg-[#001E2B] px-2 py-2">
                <JsonView data={section.data} theme="dark" maxHeight="16rem" />
              </div>
            )
          )}
        </div>
      ))}
    </div>
  );
}
