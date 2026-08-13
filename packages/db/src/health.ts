import { sql, type Kysely } from 'kysely';

import type { Database } from './schema.js';

export async function pingDatabase(db: Kysely<Database>): Promise<void> {
  await sql`select 1`.execute(db);
}
