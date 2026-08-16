import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Its own Testcontainers Postgres, as every other package's integration
    // suite has: CI has Docker but never runs docker compose.
    globalSetup: ['./src/test/global-setup.ts'],
    hookTimeout: 120_000,
    // Files share one database, so they run one at a time (the same reason
    // apps/api sets this).
    fileParallelism: false,
  },
});
