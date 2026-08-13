import { MongoClient } from 'mongodb';

export interface MongoConnectionConfig {
  uri: string;
}

// packages/documents never reads process.env itself (ADR-0001); the
// caller's config module resolves the connection URI and passes it in.
export async function createMongoClient(config: MongoConnectionConfig): Promise<MongoClient> {
  const client = new MongoClient(config.uri);
  await client.connect();
  return client;
}
