import { defineConfig } from 'vitest/config';

// Integration tests need a live Postgres and are excluded from the default
// run, which CI executes with no database available (Phase 0 build order,
// step 9, wires Testcontainers for these). Run them locally with
// `pnpm run test:integration` against `docker compose up -d postgres`.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
});
