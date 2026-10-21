import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Owner's rule (Oct 2026): every stock value comes from the one lot calculation (packages/shared
 * stockByPurchaseRate, read through apps/api/src/modules/stock/stock-value.ts). This fails when a
 * file works out a stock value on its own by multiplying a quantity by the purchase price. The same
 * goes for profit: the cost of what was sold comes from the same lots (owner's rule, Oct 2026).
 */
const ROOT = path.resolve(__dirname, '../../..');
const DIRS = ['apps/api/src', 'apps/web/src', 'packages/shared/src', 'packages/importer/src'];
/** lines that multiply a quantity by the purchase price for something that is not stock value */
const ALLOWED: { file: string; why: string; has: string }[] = [
  // none: since Oct 2026 the cost of goods sold also comes from the lots (costOfGoods, read through goodsCosts / draftSaleCosts)
];

const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : files(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });

const PURCHASE = /purchasePrice|\.purchase\b|\.purch\b/;
const MULTIPLY = /\.times\(|\.mul\(|[^*/]\*[^*/=]/;
const QUANTITY = /stock|qty|quantity/i;

describe('one stock value calculation', () => {
  it('no file multiplies a stock quantity by the purchase price on its own', () => {
    const hits: string[] = [];
    for (const d of DIRS)
      for (const f of files(path.join(ROOT, d))) {
        const rel = path.relative(ROOT, f).split(path.sep).join('/');
        fs.readFileSync(f, 'utf8').split('\n').forEach((line, k) => {
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
          if (!(PURCHASE.test(line) && MULTIPLY.test(line) && QUANTITY.test(line))) return;
          if (ALLOWED.some((a) => a.file === rel && line.includes(a.has))) return;
          hits.push(`${rel}:${k + 1}: ${line.trim().slice(0, 140)}`);
        });
      }
    expect(hits, 'use rateTables() / the RateTable value instead').toEqual([]);
  });

  it('would catch the old way of working it out', () => {
    const old = "const val = prods.reduce((a, i) => a.plus(money(Math.max(0, n(i.stock ?? '0'))).times(i.purchase)), money(0));";
    expect(PURCHASE.test(old) && MULTIPLY.test(old) && QUANTITY.test(old)).toBe(true);
  });
});
