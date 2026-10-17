import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { BRAND, OLD_APP, type Brand } from '../../packages/shared/src/brand';

/** The app (index.html) and the sign-in page (login.html), served at /login. */
const loginRoute = (): Plugin => ({
  name: 'login-route',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/login' || req.url?.startsWith('/login?')) req.url = req.url.replace('/login', '/login.html');
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/login' || req.url?.startsWith('/login?')) req.url = req.url.replace('/login', '/login.html');
      next();
    });
  },
});

const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The app's name (packages/shared/src/brand.ts) in every page: {{APP_NAME}}, {{APP_LETTER}} (the logo) and
 * {{BACKUP_FOLDER}} in the .html files, and __APP_NAME__ in the code (src/lib/brand.ts).
 */
export const brand = (b: Brand): Plugin => ({
  name: 'brand',
  config: () => ({ define: { __APP_NAME__: JSON.stringify(b.name) } }),
  transformIndexHtml(page) {
    const fill: Record<string, string> = { APP_NAME: b.name, APP_LETTER: b.name.charAt(0).toUpperCase(), BACKUP_FOLDER: b.backupFolder };
    return page.replace(/\{\{(\w+)\}\}/g, (m, k: string) => {
      if (!(k in fill)) throw new Error(`Unknown marker ${m} in a page (known: ${Object.keys(fill).join(', ')})`);
      return html(fill[k]!);
    });
  },
});

// the public Privacy policy and Terms pages (no sign-in) are plain pages with the sign-in page's styles
export const PAGES = { main: 'index.html', login: 'login.html', privacy: 'privacy.html', terms: 'terms.html' };

const api = { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: false } };

export default defineConfig(({ command }) => {
  /*
   * TEST MODE, for the picture tests and the prototype's flows only: they compare with the prototype, which
   * shows the old name. Playwright turns it on (BRAND_TEST_MODE=old-name, playwright.config.ts). It works
   * only on the dev server: the live app is always a `vite build`, which ignores it.
   */
  const testMode = command === 'serve' && process.env.BRAND_TEST_MODE === 'old-name';
  return {
    plugins: [react(), loginRoute(), brand(testMode ? OLD_APP : BRAND)],
    appType: 'spa',
    build: { rollupOptions: { input: PAGES } },
    server: { port: 5173, proxy: api },
    preview: { port: 4173, proxy: api },
  };
});
