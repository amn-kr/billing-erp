/* Shared settings for screenshot runs (baseline capture and comparison tests). */
const fs = require('fs');
const path = require('path');

/* The prototype's sample data is dated around 1 Oct 2026 (GSTR-1 "10 days left"). */
const FROZEN_TIME = '2026-10-01T14:00:00+05:30';
const WIDTHS = [1280, 1366, 1920];
const HEIGHTS = { 1280: 800, 1366: 768, 1920: 1080 };

/* Google Fonts are served from a local copy (fonts/), fetched once with
   fetch-fonts.sh. Screenshots then never depend on the network, and the
   prototype and the rebuild get byte-identical fonts. */
const FONT_DIR = path.join(__dirname, 'fonts');
const CSS_FOR = { 'Plus Jakarta Sans': 'jakarta.css', Inter: 'inter.css' };

async function routeFonts(target) {
  await target.route('https://fonts.googleapis.com/**', (route) => {
    const url = decodeURIComponent(route.request().url());
    const fam = Object.keys(CSS_FOR).find((f) => url.includes('family=' + f.replace(/ /g, '+')));
    if (!fam) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'text/css', body: fs.readFileSync(path.join(FONT_DIR, CSS_FOR[fam]), 'utf8') });
  });
  await target.route('https://fonts.gstatic.com/**', (route) => {
    const file = path.join(FONT_DIR, new URL(route.request().url()).pathname.slice(1).replace(/\//g, '_'));
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(file) });
  });
}

async function newPage(browser, width) {
  const ctx = await browser.newContext({
    viewport: { width, height: HEIGHTS[width] || 800 },
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
  });
  await routeFonts(ctx);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(FROZEN_TIME));
  return page;
}

module.exports = { FROZEN_TIME, WIDTHS, HEIGHTS, routeFonts, newPage };
