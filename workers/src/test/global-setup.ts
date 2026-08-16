import { runMigrations } from '@orgflow/db/migrate';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// As in packages/db and apps/api: an ephemeral, already-migrated Postgres,
// not the Docker Compose stack, so the suite works identically on a laptop
// and in CI. The worker needs no Mongo, since notifications read only
// Postgres.
let postgres: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  postgres = await new PostgreSqlContainer('postgres:16')
    .withDatabase('orgflow_test')
    .withUsername('orgflow')
    .withPassword('orgflow')
    .start();

  const databaseUrl = postgres.getConnectionUri();
  await runMigrations(databaseUrl);

  process.env.ORGFLOW_TEST_DATABASE_URL = databaseUrl;
}

export async function teardown(): Promise<void> {
  await postgres?.stop();
}
