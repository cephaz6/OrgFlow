import { defineConfig } from 'vitest/config';

// The default run is the unit suite, which needs no infrastructure. The
// integration suite starts its own Testcontainers Postgres and runs under
// vitest.integration.config.ts, matching every other package here.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
});
