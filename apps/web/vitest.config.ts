import { defineConfig } from 'vitest/config';
import { BRAND } from '../../packages/shared/src/brand';
import { brand } from './vite.config';

export default defineConfig({ plugins: [brand(BRAND)], test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], environment: 'node' } });
