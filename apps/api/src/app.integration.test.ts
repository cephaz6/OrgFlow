import { createDb, type Database } from '@orgflow/db';
import { createMongoClient } from '@orgflow/documents';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { createLogger } from './logger.js';

// Local Docker Compose credentials, not a secret (ADR-0007). Requires
// `docker compose up -d postgres mongo`.
const DATABASE_URL = 'postgres://orgflow:orgflow@localhost:5432/orgflow';
const MONGODB_URI = 'mongodb://localhost:27017/orgflow';

describe('GET /ready', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;

  beforeAll(async () => {
    db = createDb({ connectionString: DATABASE_URL });
    mongoClient = await createMongoClient({ uri: MONGODB_URI });
  });

  afterAll(async () => {
    await db.destroy();
    await mongoClient.close();
  });

  it('returns 200 when Postgres and Mongo are both reachable', async () => {
    const app = createApp({
      db,
      mongoClient,
      corsOrigin: 'http://localhost:3000',
      logger: createLogger('silent'),
    });

    const response = await request(app).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      dependencies: { postgres: 'ok', mongo: 'ok' },
    });
  });
});
