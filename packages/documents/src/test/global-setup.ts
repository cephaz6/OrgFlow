import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';

// Same pattern as packages/db and apps/api: an ephemeral container per
// test run, its connection string handed to the tests through process.env,
// which is the only channel a Vitest globalSetup shares with them.
let mongo: StartedMongoDBContainer | undefined;

export async function setup(): Promise<void> {
  mongo = await new MongoDBContainer('mongo:7').start();

  // MongoDBContainer runs a single-node replica set, which advertises its
  // own container hostname during topology discovery; that name does not
  // resolve outside Docker, so the driver must be told to connect directly.
  const connectionString = mongo.getConnectionString();
  const separator = connectionString.includes('?') ? '&' : '?';
  process.env.ORGFLOW_TEST_MONGODB_URI = `${connectionString}${separator}directConnection=true`;
}

export async function teardown(): Promise<void> {
  await mongo?.stop();
}
