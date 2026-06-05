'use client';

interface Props {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  noun?: string;
}

export function Pagination({ page, totalPages, total, limit, onPageChange, noun = 'cases' }: Props) {
  if (totalPages <= 1) return null;

  const from = (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);

  // Build the page number list with smart ellipsis
  function pageNumbers(): (number | 'ellipsis')[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

    const pages: (number | 'ellipsis')[] = [1];
    const left  = Math.max(2, page - 1);
    const right = Math.min(totalPages - 1, page + 1);

    if (left > 2)             pages.push('ellipsis');
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < totalPages - 1) pages.push('ellipsis');
    pages.push(totalPages);
    return pages;
  }

  const btnBase =
    'min-w-[36px] h-9 px-2 flex items-center justify-center rounded-lg text-sm font-medium transition-colors select-none';
  const btnActive  = 'bg-[#001E2B] text-[#00ED64] border border-[#001E2B]';
  const btnDefault = 'border border-gray-200 text-gray-700 hover:bg-gray-50';
  const btnDisabled = 'border border-gray-100 text-gray-300 cursor-not-allowed';

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
      <span className="text-xs text-gray-500 order-2 sm:order-1">
        Showing <span className="font-medium text-gray-700">{from}</span>
        {' '}&ndash;{' '}
        <span className="font-medium text-gray-700">{to}</span>
        {' '}of{' '}
        <span className="font-medium text-gray-700">{total}</span> {noun}
      </span>

      <nav className="flex items-center gap-1 order-1 sm:order-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
          className={`${btnBase} ${page === 1 ? btnDisabled : btnDefault}`}
        >
          &#8249;
        </button>

        {pageNumbers().map((p, i) =>
          p === 'ellipsis' ? (
            <span key={`e${i}`} className="px-1 text-gray-400 text-sm">…</span>
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

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          aria-label="Next page"
          className={`${btnBase} ${page === totalPages ? btnDisabled : btnDefault}`}
        >
          &#8250;
        </button>
      </nav>
    </div>
  );
}
