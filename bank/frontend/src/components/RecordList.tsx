// A record set, rendered as the shape the screen can actually hold.
//
// A table is right on a desktop and wrong on a phone: eight columns at 380px is either an unreadable squeeze
// or a horizontal scroll that hides the columns that matter. So the same rows render as a table from `md` and
// as one card per row below it, which is the layout a phone can read without pinching.
//
// The columns are whatever the records carry. A fixed set per resource would need editing every time the bank
// adds a field, and would hide the new one until someone did.

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function RecordList({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 8);

  return (
    <>
      {/* Phones and small tablets: one card per record, label above value, nothing truncated away. */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row, index) => (
          <li key={String(row.id ?? index)} className="rounded-xl border border-line bg-surface p-4">
            <dl className="space-y-2">
              {columns.map((column) => (
                <div key={column} className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2">
                  <dt className="truncate text-[11px] uppercase tracking-wide text-ink-soft">{column}</dt>
                  <dd className="min-w-0 break-words text-xs">{cell(row[column])}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {/* From `md`: the table, scrolling inside its own container so the PAGE never scrolls sideways. */}
      <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface md:block">
        <table className="min-w-full text-xs">
          <thead className="bg-surface-alt">
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-ink-soft">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={String(row.id ?? index)} className="border-t border-line align-top">
                {columns.map((column) => (
                  <td key={column} className="max-w-[20rem] truncate px-3 py-2" title={cell(row[column])}>
                    {cell(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
