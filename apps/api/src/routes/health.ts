import { pingDatabase, type Database } from '@orgflow/db';
import { pingMongo } from '@orgflow/documents';
import { Router } from 'express';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';

export interface HealthDeps {
  db: Kysely<Database>;
  mongoClient: MongoClient;
}

// GOV-STANDARDS.md §10: /health is liveness (always 200 once the process is
// up); /ready checks dependencies and fails closed if either is down.
export function createHealthRouter(deps: HealthDeps): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  router.get('/ready', async (_req, res) => {
    const [postgres, mongo] = await Promise.allSettled([
      pingDatabase(deps.db),
      pingMongo(deps.mongoClient),
    ]);

    const healthy = postgres.status === 'fulfilled' && mongo.status === 'fulfilled';

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'unavailable',
      dependencies: {
        postgres: postgres.status === 'fulfilled' ? 'ok' : 'unavailable',
        mongo: mongo.status === 'fulfilled' ? 'ok' : 'unavailable',
      },
    });
  });

  return router;
}
