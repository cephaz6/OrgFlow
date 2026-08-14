import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { runMigrations } from '../migrate.js';

// Vitest globalSetup: runs once, in a separate process from the test
// files, before any of them start. It cannot share in-memory state with
// the tests, only process.env (https://vitest.dev/config/#globalsetup),
// which is how the ephemeral container's connection string reaches them.
let container: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:16')
    .withDatabase('orgflow_test')
    .withUsername('orgflow')
    .withPassword('orgflow')
    .start();

  const databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);

  process.env.ORGFLOW_TEST_DATABASE_URL = databaseUrl;
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
