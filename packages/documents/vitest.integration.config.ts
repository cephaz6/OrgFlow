import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    globalSetup: ['./src/test/global-setup.ts'],
    // Pulling the Mongo image and waiting for it to accept connections
    // takes well over the 5s default.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
