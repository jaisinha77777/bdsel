// Single Vitest run across every workspace package. Tests never touch the network:
// they use fixture JSON/HTML from fixtures/ through an in-memory fetcher.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['config/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
