// On phones, `table.data` rows render as stacked cards (see data-views.css).
// Each card cell shows its column name, which lives in the <thead> — this
// copies every header's text onto the matching <td> as `data-label`, for
// every data table currently on the page and any rendered later. One
// global observer instead of touching every table in every page.

function labelTable(table: HTMLTableElement) {
  const headers = Array.from(table.tHead?.rows[0]?.cells ?? []).map((th) => th.textContent?.trim() ?? '');
  if (headers.length === 0) return;
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let col = 0;
      for (const cell of Array.from(row.cells)) {
        const label = cell.colSpan > 1 ? '' : headers[col] ?? '';
        if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
        col += cell.colSpan;
      }
    }
  }
}

let installed = false;

export function installResponsiveTables() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  let scheduled = false;
  const run = () => {
    scheduled = false;
    document.querySelectorAll<HTMLTableElement>('table.data').forEach(labelTable);
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(run);
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
}
