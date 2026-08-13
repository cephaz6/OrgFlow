import { sql, type Kysely, type Transaction } from 'kysely';

import type { Database } from './schema.js';

// ADR-0004 + ADR-0009: every scoped query runs inside a transaction that
// sets both the tenant GUC and the effective role with SET LOCAL, so both
// revert automatically on commit or rollback and can never leak onto a
// pooled connection handed to the next request. set_config() is used for
// the tenant id specifically because it accepts a bind parameter; SET ROLE
// has no parameterised form, but orgflow_app is a fixed literal, never
// derived from input, so inlining it carries no injection risk.
export async function withTenantTransaction<T>(
  db: Kysely<Database>,
  organisationId: string,
  callback: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`set local role orgflow_app`.execute(trx);
    await sql`select set_config('orgflow.organisation_id', ${organisationId}, true)`.execute(trx);
    return callback(trx);
  });
}
