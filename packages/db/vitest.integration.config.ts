import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Starts one ephemeral Postgres container (Testcontainers) and
    // migrates it before any test file runs, instead of every test file
    // depending on a pre-existing, already-migrated Docker Compose
    // database. Self-contained: works the same on a laptop and in CI.
    globalSetup: ['./src/test/global-setup.ts'],
    // Testcontainers pulls an image and waits for Postgres to accept
    // connections; the default 5s hook timeout is too tight for that.
    hookTimeout: 60_000,
  },
});
