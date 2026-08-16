import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Starts ephemeral Postgres and Mongo containers (Testcontainers) and
    // migrates Postgres before any test file runs, instead of depending on
    // a pre-existing, already-migrated Docker Compose stack. Self-contained:
    // works the same on a laptop and in CI.
    globalSetup: ['./src/test/global-setup.ts'],
    // Testcontainers pulls images and waits for both services to accept
    // connections; the default 5s hook timeout is too tight for that.
    hookTimeout: 60_000,
    // Every file in this suite talks to the same Postgres and Mongo pair
    // that global-setup started. Running them in parallel means two files
    // seeding the same development organisation at once, which collides on
    // the unique constraints that make the seed idempotent in the first
    // place, and makes row-counting assertions depend on what another file
    // happened to insert. Sequential files, parallel assertions within a
    // file.
    fileParallelism: false,
  },
});
