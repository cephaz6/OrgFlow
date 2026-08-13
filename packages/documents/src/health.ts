import type { MongoClient } from 'mongodb';

export async function pingMongo(client: MongoClient): Promise<void> {
  await client.db().command({ ping: 1 });
}
