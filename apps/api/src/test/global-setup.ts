import { runMigrations } from '@orgflow/db/migrate';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// Vitest globalSetup: runs once, in a separate process from the test
// files, before any of them start. It cannot share in-memory state with
// the tests, only process.env (https://vitest.dev/config/#globalsetup),
// which is how the ephemeral containers' connection strings reach them.
let postgres: StartedPostgreSqlContainer | undefined;
let mongo: StartedMongoDBContainer | undefined;

export async function setup(): Promise<void> {
  [postgres, mongo] = await Promise.all([
    new PostgreSqlContainer('postgres:16')
      .withDatabase('orgflow_test')
      .withUsername('orgflow')
      .withPassword('orgflow')
      .start(),
    new MongoDBContainer('mongo:7').start(),
  ]);

  const databaseUrl = postgres.getConnectionUri();
  await runMigrations(databaseUrl);

  process.env.ORGFLOW_TEST_DATABASE_URL = databaseUrl;
  // MongoDBContainer runs as a single-node replica set (required for
  // transactions); without directConnection=true the driver instead
  // performs full topology discovery and tries to follow the replica set's
  // internally-advertised member address, which is the container's own
  // Docker hostname and unreachable from outside the container.
  const mongoConnectionString = mongo.getConnectionString();
  const separator = mongoConnectionString.includes('?') ? '&' : '?';
  process.env.ORGFLOW_TEST_MONGODB_URI = `${mongoConnectionString}${separator}directConnection=true`;
}

export async function teardown(): Promise<void> {
  await Promise.all([postgres?.stop(), mongo?.stop()]);
}
