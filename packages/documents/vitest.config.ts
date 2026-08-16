import { defineConfig } from 'vitest/config';

// The default run must not need infrastructure: integration tests start
// their own Mongo container and run under vitest.integration.config.ts via
// `pnpm run test:integration`. Same split as packages/db and apps/api.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
});
