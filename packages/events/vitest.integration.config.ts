import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Starts its own LocalStack, so the suite behaves identically on a
    // laptop and in CI, where docker compose is never run.
    globalSetup: ['./src/test/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
