/**
 * Writes examples/maths.json: bills with their exact totals and amounts in words, worked out by the
 * shared maths (src/invoice.ts). The web, the server and the phone (Kotlin) must all give these same
 * answers; test/maths-examples.test.ts checks the shared code still does (step 8.1d, owner 18 Nov 2026).
 *
 * Run after a deliberate change to the maths, then look at what changed in the file:
 *   pnpm --filter @billing/shared build && node packages/shared/scripts/maths-examples.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { amountInWords, purchaseTotals, saleTotals } from '../dist/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '../examples/maths.json');

const L = (qty, price, gst = '18', disc = '0') => ({ qty, price, gst, disc });
const base = { mode: 'gst', incl: false, inter: false, roundOff: true };

/** [name, sale or purchase, bill] */
const BILLS = [
  ['One item, GST 18%, same state', 'sale', { ...base, lines: [L('1', '1890')] }],
  ['Two items, two GST rates, line discount', 'sale', { ...base, lines: [L('3', '1890', '18', '5'), L('12', '95', '12')] }],
  ['Other state: IGST instead of CGST and SGST', 'sale', { ...base, inter: true, lines: [L('2', '1890'), L('5', '62.5', '5')] }],
  ['Prices include GST', 'sale', { ...base, incl: true, lines: [L('1', '2230.20'), L('4', '112.10')] }],
  ['Bill discount in %', 'sale', { ...base, bdiscP: '5', lines: [L('3', '1890'), L('2', '95')] }],
  ['Bill discount as an amount', 'sale', { ...base, bdisc: '293', lines: [L('3', '1890'), L('2', '95')] }],
  ['Bill discount larger than the bill stops at the bill', 'sale', { ...base, bdisc: '99999', lines: [L('1', '100')] }],
  ['Transport, labour and bank charges', 'sale', { ...base, chTr: '150', chLab: '75.50', chBank: '20', lines: [L('3', '1890'), L('2', '95')] }],
  ['TCS 0.1%', 'sale', { ...base, tcsRate: '0.1', lines: [L('40', '13999')] }],
  ['Round off off: paise kept', 'sale', { ...base, roundOff: false, lines: [L('3', '33.33')] }],
  ['Round off: 50 paise goes up', 'sale', { ...base, lines: [L('1', '100.4237288135593220339', '18')] }],
  ['Half paisa in CGST: SGST takes the rest', 'sale', { ...base, lines: [L('1', '0.05')] }],
  ['Quantity with decimals (metres, kg)', 'sale', { ...base, lines: [L('2.75', '48.40'), L('0.5', '312')] }],
  ['GST 0%, 5%, 12%, 18% and 28% together', 'sale', { ...base, lines: [L('1', '100', '0'), L('1', '100', '5'), L('1', '100', '12'), L('1', '100', '18'), L('1', '100', '28')] }],
  ['Blank row does not count', 'sale', { ...base, lines: [L('2', '1890'), { qty: '0', price: '0', gst: '18', counted: false }] }],
  ['Bill of supply (composition dealer): no GST', 'sale', { ...base, mode: 'bos', lines: [L('3', '1890'), L('2', '95')] }],
  ['GST switched off', 'sale', { ...base, mode: 'none', lines: [L('3', '1890', '18', '10')] }],
  ['Large bill (lakhs)', 'sale', { ...base, lines: [L('250', '4599.99', '28', '2.5'), L('1000', '89.90', '18')] }],
  ['Purchase: one item, GST 18%', 'purchase', { ...base, lines: [L('10', '58')] }],
  ['Purchase: other state, line discount', 'purchase', { ...base, inter: true, lines: [L('24', '1560', '18', '7.5'), L('100', '41.25', '12')] }],
  ['Purchase: rates include GST', 'purchase', { ...base, incl: true, lines: [L('6', '1840.80'), L('10', '105', '5')] }],
  ['Purchase: bill discount and charges', 'purchase', { ...base, bdiscP: '2', chTr: '250', chLab: '40', lines: [L('10', '58'), L('5', '1560')] }],
  ['Purchase: round off off', 'purchase', { ...base, roundOff: false, lines: [L('7', '13.37')] }],
  ['Purchase: GST switched off', 'purchase', { ...base, mode: 'none', lines: [L('10', '58')] }],
];

const WORDS = ['0', '1', '15', '100', '105.50', '1000', '5717', '19999.99', '100000', '1234567.89', '10000000', '999999999.99'];

const f = (v) => v.toFixed(2);
const shown = (t) => ({
  rows: t.rows.map((r) => ({ taxable: f(r.tv), tax: f(r.tx), amount: f(r.amt) })),
  items: f(t.items), billDiscount: f(t.bdisc), taxable: f(t.taxable), tax: f(t.tax),
  cgst: f(t.cgst), sgst: f(t.sgst), igst: f(t.igst), tcs: f(t.tcs), roundOff: f(t.round), total: f(t.total),
  byRate: Object.fromEntries(Object.entries(t.byRate).map(([k, b]) => [k, { taxable: f(b.tv), tax: f(b.tx) }])),
});

export function build() {
  return {
    about: 'Bills with their exact totals and amounts in words. The web, the server and the phone app must all give these answers. Made by packages/shared/scripts/maths-examples.mjs; do not edit by hand.',
    bills: BILLS.map(([name, kind, bill]) => ({ name, kind, bill, expect: shown((kind === 'sale' ? saleTotals : purchaseTotals)(bill)) })),
    words: WORDS.map((amount) => ({ amount, expect: amountInWords(amount) })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(OUT, JSON.stringify(build(), null, 2) + '\n');
  console.log('wrote', path.relative(process.cwd(), OUT));
}
