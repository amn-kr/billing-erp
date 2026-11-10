// Single-PC mode works without internet, so its copy of the web app's pages (dist/web) must not load
// fonts from Google: the screens would show another font and no longer match the prototype.
// This downloads each Google font the pages ask for once (kept in .cache/fonts) and points the pages
// at those copies (dist/web/_fonts). The live web app is not changed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CACHE = path.resolve('.cache/fonts');
// Google sends .woff2 files only to a browser it knows
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const LINK = /<link\s+href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"\s+rel="stylesheet"\s*\/?>/g;
const PRECONNECT = /<link\s+rel="preconnect"\s+href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>/g;

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

async function get(url, binary) {
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`Could not download ${url}: ${r.status}`);
  return binary ? Buffer.from(await r.arrayBuffer()) : r.text();
}

/** the font's stylesheet, with its files next to it: returns the stylesheet's name in _fonts/ */
async function fetchFont(cssUrl) {
  const name = `${hash(cssUrl.replaceAll('&amp;', '&'))}.css`;
  const css = path.join(CACHE, name);
  if (!fs.existsSync(css)) {
    fs.mkdirSync(CACHE, { recursive: true });
    let text = await get(cssUrl.replaceAll('&amp;', '&'));
    for (const [, url] of text.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)) {
      const file = `${hash(url)}${path.extname(new URL(url).pathname) || '.woff2'}`;
      if (!fs.existsSync(path.join(CACHE, file))) fs.writeFileSync(path.join(CACHE, file), await get(url, true));
      text = text.replaceAll(url, file);
    }
    if (/https?:\/\//.test(text)) throw new Error(`A font file was left online in ${cssUrl}`);
    fs.writeFileSync(css + '.tmp', text);
    fs.renameSync(css + '.tmp', css);
  }
  return name;
}

/** rewrite every .html page in `webDir` to use the fonts kept in webDir/_fonts */
export async function offlineFonts(webDir) {
  const out = path.join(webDir, '_fonts');
  const used = new Set();
  for (const page of fs.readdirSync(webDir).filter((f) => f.endsWith('.html'))) {
    const file = path.join(webDir, page);
    let html = fs.readFileSync(file, 'utf8');
    if (!LINK.test(html)) continue;
    LINK.lastIndex = 0;
    for (const [tag, url] of [...html.matchAll(LINK)]) {
      const name = await fetchFont(url);
      used.add(name);
      html = html.replace(tag, `<link href="/_fonts/${name}" rel="stylesheet">`);
    }
    html = html.replace(PRECONNECT, '');
    if (/fonts\.(googleapis|gstatic)\.com/.test(html)) throw new Error(`${page} still loads a font from Google`);
    fs.writeFileSync(file, html);
  }
  fs.mkdirSync(out, { recursive: true });
  for (const css of used) {
    fs.copyFileSync(path.join(CACHE, css), path.join(out, css));
    for (const [, f] of fs.readFileSync(path.join(CACHE, css), 'utf8').matchAll(/url\(([^)]+)\)/g)) fs.copyFileSync(path.join(CACHE, f), path.join(out, f));
  }
  return used.size;
}
