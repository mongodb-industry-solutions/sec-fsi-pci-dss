'use client';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface Props {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  limitOptions?: number[];
  noun?: string;
}

export function Pagination({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  onLimitChange,
  limitOptions = [10, 20, 50],
  noun = 'cases',
}: Props) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);
  const [jumpValue, setJumpValue] = useState('');

  function pageNumbers(): (number | 'ellipsis')[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | 'ellipsis')[] = [1];
    const left  = Math.max(2, page - 1);
    const right = Math.min(totalPages - 1, page + 1);
    if (left > 2)               pages.push('ellipsis');
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < totalPages - 1) pages.push('ellipsis');
    pages.push(totalPages);
    return pages;
  }

  function commitJump() {
    const v = parseInt(jumpValue, 10);
    if (v >= 1 && v <= totalPages) onPageChange(v);
    setJumpValue('');
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-2 select-none">

      {/* Left — count */}
      <p className="text-xs text-gray-400 shrink-0 order-last sm:order-first">
        {total === 0
          ? <span>No {noun}</span>
          : <>
              <span className="font-semibold text-gray-700">{from}</span>
              <span className="mx-0.5">–</span>
              <span className="font-semibold text-gray-700">{to}</span>
              <span className="mx-1.5 text-gray-200">|</span>
              <span className="font-semibold text-gray-700">{total}</span>
              <span className="ml-1">{noun}</span>
            </>
        }
      </p>

      {/* Center — navigation */}
      {totalPages > 1 && (
        <nav className="flex items-center gap-0.5 order-first sm:order-none" aria-label="Pagination">
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={page === 1}
            aria-label="First page"
            className={navBtn(page === 1)}
          >
            <ChevronsLeft size={13} />
          </button>

          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            aria-label="Previous page"
            className={navBtn(page === 1)}
          >
            <ChevronLeft size={13} />
          </button>

          <div className="flex items-center gap-0.5 mx-1">
            {pageNumbers().map((p, i) =>
              p === 'ellipsis' ? (
                <span
                  key={`e${i}`}
                  className="w-8 h-8 flex items-center justify-center text-gray-300 text-sm tracking-widest"
                >
                  ···
                </span>
              ) : (
                <button
                  type="button"
                  key={p}
                  onClick={() => onPageChange(p)}
                  aria-current={p === page ? 'page' : undefined}
                  className={pageBtn(p === page)}
                >
                  {p}
                </button>
              )
            )}
          </div>

          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalPages}
            aria-label="Next page"
            className={navBtn(page === totalPages)}
          >
            <ChevronRight size={13} />
          </button>

          <button
            type="button"
            onClick={() => onPageChange(totalPages)}
            disabled={page === totalPages}
            aria-label="Last page"
            className={navBtn(page === totalPages)}
          >
            <ChevronsRight size={13} />
          </button>

          {/* Jump-to-page */}
          <div className="flex items-center gap-1.5 ml-2 pl-3 border-l border-gray-100">
            <span className="text-xs text-gray-300 hidden sm:block">Go to</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commitJump()}
              onBlur={commitJump}
              placeholder={String(page)}
              className="w-10 h-8 rounded-lg border border-gray-200 text-xs text-center text-gray-700 bg-white hover:border-gray-300 focus:outline-none focus:border-[#001E2B] focus:ring-2 focus:ring-[#001E2B]/10 placeholder-gray-300 transition-colors"
            />
          </div>
        </nav>
      )}

      {/* Right — per-page toggle */}
      {onLimitChange && (
        <div className="flex items-center gap-2 shrink-0 order-first sm:order-last">
          <span className="text-xs text-gray-400">Per page</span>
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
            {limitOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onLimitChange(opt)}
                className={`h-6 min-w-[30px] px-2 text-xs font-medium rounded-md transition-all duration-150 ${
                  opt === limit
                    ? 'bg-[#001E2B] text-[#00ED64] shadow-sm'
                    : 'text-gray-500 hover:text-gray-800 hover:bg-white/60'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

function navBtn(disabled: boolean) {
  return `w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-150 ${
    disabled
      ? 'text-gray-200 cursor-not-allowed'
      : 'text-gray-400 hover:bg-[#001E2B] hover:text-[#00ED64] hover:shadow-sm'
  }`;
}

function pageBtn(active: boolean) {
  return `min-w-[32px] h-8 px-1.5 flex items-center justify-center rounded-lg text-sm font-medium transition-all duration-150 ${
    active
      ? 'bg-[#001E2B] text-[#00ED64] shadow-sm'
      : 'text-gray-500 hover:bg-[#001E2B]/6 hover:text-[#001E2B]'
  }`;
}
