import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { '@': path.join(here, 'src') } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
    env: {
      NEXT_PUBLIC_WALLET: 'mock',
      NEXT_PUBLIC_API_MOCK: '1',
    },
  },
});
