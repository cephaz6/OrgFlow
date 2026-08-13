import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import type { Database } from './schema.js';

export interface DbConnectionConfig {
  connectionString: string;
}

// packages/db never reads process.env itself (ADR-0001, enforced by
// eslint.config.mjs); the caller's config module resolves the connection
// string and passes it in explicitly.
export function createDb(config: DbConnectionConfig): Kysely<Database> {
  const pool = new Pool({ connectionString: config.connectionString });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
