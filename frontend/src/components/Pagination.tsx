'use client';

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

  function pageNumbers(): (number | 'ellipsis')[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | 'ellipsis')[] = [1];
    const left  = Math.max(2, page - 1);
    const right = Math.min(totalPages - 1, page + 1);
    if (left > 2)              pages.push('ellipsis');
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < totalPages - 1) pages.push('ellipsis');
    pages.push(totalPages);
    return pages;
  }

  const btnBase     = 'min-w-[32px] h-8 px-1.5 flex items-center justify-center rounded-lg text-sm font-medium transition-colors select-none';
  const btnActive   = 'bg-[#001E2B] text-[#00ED64] border border-[#001E2B]';
  const btnDefault  = 'border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300';
  const btnDisabled = 'border border-gray-100 text-gray-300 cursor-not-allowed';

  return (
    <div className="flex flex-col gap-3 pt-2">
      {/* Top row: item count + page size selector */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          {total === 0
            ? `No ${noun}`
            : <>Showing <span className="font-medium text-gray-700">{from}</span>{' '}&ndash;{' '}<span className="font-medium text-gray-700">{to}</span> of <span className="font-medium text-gray-700">{total}</span> {noun}</>
          }
        </span>
        {onLimitChange && (
          <label className="flex items-center gap-1.5">
            <span>Per page:</span>
            <select
              value={limit}
              onChange={(e) => { onLimitChange(Number(e.target.value)); onPageChange(1); }}
              className="border border-gray-200 rounded px-1.5 py-0.5 text-xs text-gray-700 bg-white hover:border-gray-300 focus:outline-none focus:border-[#001E2B] cursor-pointer"
            >
              {limitOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* Bottom row: navigation controls (only when >1 page) */}
      {totalPages > 1 && (
        <nav className="flex items-center gap-1 flex-wrap">
          {/* First */}
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={page === 1}
            aria-label="First page"
            title="First page"
            className={`${btnBase} ${page === 1 ? btnDisabled : btnDefault}`}
          >
            &#171;
          </button>

          {/* Previous */}
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            aria-label="Previous page"
            title="Previous page"
            className={`${btnBase} ${page === 1 ? btnDisabled : btnDefault}`}
          >
            &#8249;
          </button>

          {/* Page numbers */}
          {pageNumbers().map((p, i) =>
            p === 'ellipsis' ? (
              <span key={`e${i}`} className="px-1 text-gray-400 text-sm select-none">…</span>
            ) : (
              <button
                type="button"
                key={p}
                onClick={() => onPageChange(p)}
                aria-current={p === page ? 'page' : undefined}
                className={`${btnBase} ${p === page ? btnActive : btnDefault}`}
              >
                {p}
              </button>
            )
          )}

          {/* Next */}
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalPages}
            aria-label="Next page"
            title="Next page"
            className={`${btnBase} ${page === totalPages ? btnDisabled : btnDefault}`}
          >
            &#8250;
          </button>

          {/* Last */}
          <button
            type="button"
            onClick={() => onPageChange(totalPages)}
            disabled={page === totalPages}
            aria-label="Last page"
            title="Last page"
            className={`${btnBase} ${page === totalPages ? btnDisabled : btnDefault}`}
          >
            &#187;
          </button>

          {/* Jump to page */}
          <span className="ml-2 flex items-center gap-1.5 text-xs text-gray-500">
            Go to
            <input
              type="number"
              min={1}
              max={totalPages}
              defaultValue={page}
              key={page}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = parseInt((e.target as HTMLInputElement).value, 10);
                  if (v >= 1 && v <= totalPages) onPageChange(v);
                }
              }}
              onBlur={(e) => {
                const v = parseInt(e.target.value, 10);
                if (v >= 1 && v <= totalPages) onPageChange(v);
              }}
              className="w-12 border border-gray-200 rounded px-1.5 py-0.5 text-xs text-center text-gray-700 bg-white hover:border-gray-300 focus:outline-none focus:border-[#001E2B]"
            />
            <span>of {totalPages}</span>
          </span>
        </nav>
      )}
    </div>
  );
}
