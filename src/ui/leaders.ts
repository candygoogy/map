// Leader lists in a narrow column (the panel): a value too long for its row wraps, flush
// right, and its first line can end up shorter than the value's box, so the dotted leader,
// which ends at the box, would stop short of the words (owner, 2026-10-18: leaders run
// right up to their values). This measures each row's first line and lets the leader reach
// it: --reach on the row is how far the line starts inside the box, and styles.css takes it
// off the leader's end margin. The label keeps the width it had, so reaching never moves
// the columns (and so never rewraps the value it was measured from).

/** Fits the leaders of every list in `root`. Reads all, then writes all. */
export function reachLeaders(root: ParentNode): void {
  const rows = [...root.querySelectorAll<HTMLElement>('dl.leaders > div')];
  for (const row of rows) clearReach(row);
  const range = document.createRange();
  const fits = rows.map((row) => {
    const dt = row.querySelector('dt');
    const dd = row.querySelector('dd');
    const text = dd?.firstChild;
    if (!dt || !dd || !text) return null;
    range.selectNodeContents(text);
    const first = range.getClientRects()[0];
    const reach = first ? first.left - dd.getBoundingClientRect().left : 0;
    return reach > 0.5 ? { dt, reach, width: dt.getBoundingClientRect().width } : null;
  });
  rows.forEach((row, i) => {
    const fit = fits[i];
    if (!fit) return;
    fit.dt.style.minWidth = `${fit.width}px`;
    row.style.setProperty('--reach', `${fit.reach}px`);
  });
}

/** Back to the list as styles.css lays it out. */
export function clearReach(row: HTMLElement): void {
  row.style.removeProperty('--reach');
  row.querySelector('dt')?.style.removeProperty('min-width');
}
