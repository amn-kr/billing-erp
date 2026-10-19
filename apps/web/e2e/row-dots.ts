/**
 * Group 3 additions to withDots (shots.ts) for the lists that got the ⋮ actions column on 18 Oct 2026:
 * Expenses, the bank and cash books, Stock adjustments and Recent transfers. Like withDots, they copy
 * only the rebuild's ⋮ column into the prototype, so everything else is still compared pixel for pixel.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { withDots } from './shots';

/**
 * withDots, plus the rows it leaves alone: a row's empty ⋮ cell (the book's "Opening balance" line has
 * no menu) and an empty-list message, which spans one more column in the rebuild.
 */
export async function withDotsAll(proto: Page, app: Page, tbody: string) {
  await withDots(proto, app, tbody);
  // each rebuild row, known by its text (the ⋮ cell left out): its ⋮ cell, an empty ⋮ cell, or the column span of an empty-list message
  const rows = await app.locator(`${tbody} > tr`).evaluateAll((rs) => rs.map((r) => {
    const last = r.lastElementChild as HTMLTableCellElement | null;
    const td = r.querySelector('td[colspan]') as HTMLTableCellElement | null;
    return {
      key: [...r.children].filter((c) => !c.classList.contains('slact')).map((c) => c.textContent).join('|'),
      cell: r.querySelector('[data-slm]')?.closest('td')?.outerHTML ?? '',
      empty: last?.classList.contains('slact') && !last.querySelector('[data-slm]') ? last.outerHTML : '',
      span: r.children.length === 1 && td ? td.colSpan : 0,
    };
  }));
  await proto.evaluate(({ tbody, rows }) => {
    const b = document.querySelector(tbody)!;
    // the prototype may draw the same rows again a moment later (seen on CI): put the ⋮ column back each time, on the same rows only
    const apply = () => [...b.children].forEach((r) => {
      const c = rows.find((x) => x.key === [...r.children].filter((y) => !y.classList.contains('slact')).map((y) => y.textContent).join('|'));
      if (!c) return;
      if (c.cell && !r.querySelector('[data-slm]')) r.insertAdjacentHTML('beforeend', c.cell);
      if (c.empty && !r.lastElementChild?.classList.contains('slact')) r.insertAdjacentHTML('beforeend', c.empty);
      if (c.span) { const td = r.querySelector('td[colspan]') as HTMLTableCellElement | null; if (td && td.colSpan !== c.span) td.colSpan = c.span; }
    });
    const w = window as unknown as Record<string, MutationObserver | undefined>;
    w['dots:' + tbody]?.disconnect();
    apply();
    (w['dots:' + tbody] = new MutationObserver(apply)).observe(b, { childList: true });
    window.dispatchEvent(new Event('resize'));
  }, { tbody, rows });
}

/** Recent transfers (#trRows): its rows are lines, the ⋮ sits after the quantity. */
export async function withLineDots(proto: Page, app: Page) {
  const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/features/shell/row-menu.css'), 'utf8');
  const html = await app.locator('#trRows .trr').evaluateAll((rs) => rs.map((r) => r.querySelector('[data-slm]')?.outerHTML ?? ''));
  await proto.evaluate(({ html, css }) => {
    [...document.querySelectorAll('#trRows .trr')].forEach((r, k) => { const b = html[k]; if (b && !r.querySelector('[data-slm]')) r.children[2]!.insertAdjacentHTML('beforeend', ' ' + b); });
    if (!document.getElementById('rowMenuCss')) { const st = document.createElement('style'); st.id = 'rowMenuCss'; st.textContent = css; document.head.appendChild(st); }
  }, { html, css });
}
