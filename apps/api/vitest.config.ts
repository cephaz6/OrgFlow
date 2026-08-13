import { defineConfig } from 'vitest/config';

// /ready needs live Postgres and Mongo; excluded from the default run,
// which CI executes with no database available (Phase 0 build order,
// step 9, wires Testcontainers). Run locally with `pnpm run test:integration`.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
});
