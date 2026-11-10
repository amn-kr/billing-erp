// Draws the app's icon (resources/icon.png, 512 × 512): the sign-in page's logo — the app's first letter,
// white on the brand green, rounded square. Run again after renaming the app:  pnpm --filter @billing/desktop icon
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import { BRAND } from '@billing/shared';

const require = createRequire(import.meta.url);
const { routeFonts } = require('../../../tools/design-baseline/common.cjs');
const letter = BRAND.name.charAt(0).toUpperCase();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await routeFonts(page);
await page.setContent(`<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@800&display=block">
<style>html,body{margin:0;background:transparent}
.logo{width:512px;height:512px;border-radius:148px;background:linear-gradient(135deg,#0f766e,#0b5f58);color:#fff;
display:grid;place-items:center;font:800 300px/1 'Plus Jakarta Sans',sans-serif}</style></head>
<body><div class="logo">${letter}</div></body></html>`);
await page.evaluate(() => document.fonts.ready);
await page.locator('.logo').screenshot({ path: 'resources/icon.png', omitBackground: true });
await browser.close();
console.log(`resources/icon.png: "${letter}" for ${BRAND.name}`);
