import { fileURLToPath } from 'node:url';

import { runner } from 'node-pg-migrate';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

// Runs the package's own migrations against an arbitrary connection
// string. Used by the real CLI scripts (migrate:up/down, which point at
// the local Docker Compose database) and by the Testcontainers-backed
// integration test setup (packages/db/src/test/global-setup.ts), which
// needs an ephemeral database migrated to the current schema before any
// test runs.
export async function runMigrations(databaseUrl: string): Promise<void> {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
  });
}
