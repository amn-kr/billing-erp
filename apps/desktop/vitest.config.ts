import { defineConfig } from 'vitest/config';

// unit tests only; e2e/ is Playwright (Electron), run by `pnpm e2e`
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
