import type { Database } from '@orgflow/db';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { createLogger } from './logger.js';

// /health and the 404 handler never touch db or mongoClient, so a stub
// satisfies the type without needing real infrastructure. /ready does
// need real dependencies; see app.integration.test.ts.
function buildApp() {
  return createApp({
    db: {} as Kysely<Database>,
    mongoClient: {} as MongoClient,
    corsOrigin: 'http://localhost:3000',
    logger: createLogger('silent'),
  });
}

describe('GET /health', () => {
  it('returns 200 without touching any dependency', async () => {
    const response = await request(buildApp()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('echoes a supplied X-Correlation-Id back on the response', async () => {
    const response = await request(buildApp())
      .get('/health')
      .set('X-Correlation-Id', 'test-correlation-id');

    expect(response.headers['x-correlation-id']).toBe('test-correlation-id');
  });
});

describe('an unmatched route', () => {
  it('returns an RFC 7807 problem response', async () => {
    const response = await request(buildApp()).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({ title: 'Not Found', status: 404 });
  });
});
