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
      NEXT_PUBLIC_NETWORK: 'testnet',
      NEXT_PUBLIC_CONTRACT_ID: 'review-registry.omniswarm.testnet',
      NEXT_PUBLIC_INTAKE_RECIPIENT: 'omniswarm.testnet',
      NEXT_PUBLIC_RPC_URL: 'https://rpc.mock.invalid',
      NEXT_PUBLIC_EXPLORER_URL: 'https://explorer.mock.invalid',
      NEXT_PUBLIC_WALLET: 'mock',
      NEXT_PUBLIC_API_MOCK: '1',
    },
  },
});
