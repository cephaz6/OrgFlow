import { createDb, type Database } from '@orgflow/db';
import { createMongoClient } from '@orgflow/documents';
import { createDummyPublisher } from '@orgflow/events';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { createLogger } from './logger.js';

const SESSION_SECRET = '11'.repeat(32);

describe('apps/api against real Postgres and Mongo', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;

  beforeAll(async () => {
    // Provided by src/test/global-setup.ts: ephemeral Testcontainers
    // Postgres (already migrated) and Mongo, not the Docker Compose stack.
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });
  });

  afterAll(async () => {
    await db.destroy();
    await mongoClient.close();
  });

  function buildApp() {
    return createApp({
      db,
      mongoClient,
      publisher: createDummyPublisher(),
      corsOrigin: 'http://localhost:3000',
      logger: createLogger('silent'),
      sessionSecret: SESSION_SECRET,
      isLocal: true,
      apiBaseUrl: 'http://localhost:4000',
    });
  }

  it('GET /ready returns 200 when Postgres and Mongo are both reachable', async () => {
    const response = await request(buildApp()).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      dependencies: { postgres: 'ok', mongo: 'ok' },
    });
  });

  it('dev-login, then /auth/session, then /auth/logout round-trip', async () => {
    const app = buildApp();
    const agent = request.agent(app);

    const loginResponse = await agent.post('/api/v1/auth/dev-login');
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user.email).toBe('dev@orgflow.local');
    expect(loginResponse.headers['set-cookie']?.[0]).toContain('HttpOnly');

    const sessionResponse = await agent.get('/api/v1/auth/session');
    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.body.user.email).toBe('dev@orgflow.local');
    expect(sessionResponse.body.organisationId).toBeTruthy();
    expect(sessionResponse.body.roles).toContain('owner');

    const logoutResponse = await agent.post('/api/v1/auth/logout');
    expect(logoutResponse.status).toBe(204);

    const afterLogout = await agent.get('/api/v1/auth/session');
    expect(afterLogout.status).toBe(401);
  });

  it("discovers Google's real OIDC configuration", async () => {
    const { discoverOidc } = await import('./auth/oidc-client.js');

    const config = await discoverOidc({
      issuerUrl: 'https://accounts.google.com',
      clientId: 'placeholder-client-id',
      clientSecret: 'placeholder-client-secret',
    });

    expect(config.serverMetadata().issuer).toBe('https://accounts.google.com');
    expect(config.serverMetadata().authorization_endpoint).toContain('accounts.google.com');
  });
});
