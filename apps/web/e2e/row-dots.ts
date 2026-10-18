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
  const rows = await app.locator(`${tbody} > tr`).evaluateAll((rs) => rs.map((r) => {
    const last = r.lastElementChild as HTMLTableCellElement | null;
    const span = (r.querySelector('td[colspan]') as HTMLTableCellElement | null)?.colSpan ?? 0;
    return { empty: last?.classList.contains('slact') && !last.querySelector('[data-slm]') ? last.outerHTML : '', span: r.children.length === 1 ? span : 0 };
  }));
  await proto.evaluate(({ tbody, rows }) => {
    [...document.querySelector(tbody)!.children].forEach((r, k) => {
      const c = rows[k];
      if (!c) return;
      if (c.empty && !r.lastElementChild?.classList.contains('slact')) r.insertAdjacentHTML('beforeend', c.empty);
      if (c.span) { const td = r.querySelector('td[colspan]') as HTMLTableCellElement | null; if (td) td.colSpan = c.span; }
    });
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
