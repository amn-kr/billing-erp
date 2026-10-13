import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

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

const api = { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: false } };

export default defineConfig({
  plugins: [react(), loginRoute()],
  appType: 'spa',
  // the public Privacy policy and Terms pages (no sign-in) are plain pages with the sign-in page's styles
  build: { rollupOptions: { input: { main: 'index.html', login: 'login.html', privacy: 'privacy.html', terms: 'terms.html' } } },
  server: { port: 5173, proxy: api },
  preview: { port: 4173, proxy: api },
});
