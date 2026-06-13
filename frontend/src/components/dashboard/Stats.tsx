'use client';
import type { ReactNode } from 'react';

// Lightweight, dependency-free stat primitives shared by role dashboards and the
// merchant overview. SVG/CSS only — no charting library.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function StatCard({ icon, label, value, sub, accent }: {
  icon: ReactNode; label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 text-gray-400">{icon}<span className="text-xs uppercase tracking-wide">{label}</span></div>
      <p className={`text-2xl font-bold mt-1 ${accent ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

/** Vertical bar chart of a monthly series. */
export function MonthlyBars({ title, data, color = 'bg-[#00ED64]' }: {
  title: string;
  data: Array<{ year: number; month: number; count: number }>;
  color?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="font-semibold text-gray-800 text-sm mb-4">{title}</h2>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400">No data yet.</p>
      ) : (
        <div className="flex items-end gap-3 h-40">
          {data.slice(-12).map((d) => (
            <div key={`${d.year}-${d.month}`} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <span className="text-xs text-gray-500">{d.count}</span>
              <div className={`w-full ${color} rounded-t ring-1 ring-inset ring-black/20`} style={{ height: `${Math.max(4, (d.count / max) * 120)}px` }} title={`${d.count}`} />
              <span className="text-[10px] text-gray-400 whitespace-nowrap">{MONTHS[d.month - 1]} {String(d.year).slice(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Horizontal breakdown bars (e.g. by status / severity). */
export function BreakdownBars({ title, items, total }: {
  title: string;
  items: Array<{ label: string; value: number; colorClass: string }>;
  total: number;
}) {
  const denom = Math.max(1, total);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="font-semibold text-gray-800 text-sm mb-3">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">No data yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.label} className="flex items-center gap-2">
              <span className="w-28 text-xs text-gray-500 capitalize shrink-0 truncate">{it.label}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden ring-1 ring-black/10">
                <div className={`h-2 ${it.colorClass}`} style={{ width: `${(it.value / denom) * 100}%` }} />
              </div>
              <span className="w-8 text-xs text-gray-600 text-right">{it.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
