import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from './connection.js';
import type { Database } from './schema.js';

// PRD.md Phase 9: "Row-Level Security verified active on every tenant table."
//
// tenant-isolation.integration.test.ts proves the policy behaves correctly on
// organisation_members, by reading and writing across two tenants. That is the
// behavioural half. This file is the coverage half, and it deliberately asks
// the catalogue rather than the data: which tables carry organisation_id, and
// is every one of them actually protected?
//
// The distinction matters because a behavioural test only covers the tables
// somebody remembered to write a test for. A migration that adds a tenant
// table and forgets ENABLE ROW LEVEL SECURITY leaks every row in it, and no
// existing test would fail. Asking pg_class instead means a new table is
// covered the moment it is created, without anybody adding a case here.
describe('row-level security covers every tenant table', () => {
  let db: Kysely<Database>;

  // organisations is the tenant root: its organisation_id is its own primary
  // key, not a scoping column, so there is no outer tenant to scope it to.
  // The row-level-security migration excludes it for exactly this reason.
  //
  // Note that system_templates needs no entry here. It has no
  // organisation_id column at all (ADR-0042), so it never appears in the
  // query below: a table with no tenant column cannot leak one tenant's rows
  // to another, because it never held any.
  const NOT_TENANT_SCOPED = new Set(['organisations']);

  // ADR-0042's published library, the single deliberate widening of tenant
  // isolation in the whole schema. Listing it here is the point: any other
  // policy that appears alongside tenant_isolation fails the test below, so
  // a second widening cannot be added without this decision being revisited.
  const PERMITTED_EXTRA_POLICIES = new Map([['templates', 'published_library_is_readable']]);

  interface TableRls {
    tableName: string;
    rlsEnabled: boolean;
    rlsForced: boolean;
  }

  interface PolicyRow {
    tableName: string;
    policyName: string;
    command: string;
    using: string | null;
  }

  let tenantTables: TableRls[];
  let policies: PolicyRow[];

  beforeAll(async () => {
    // Provided by src/test/global-setup.ts: an ephemeral, already-migrated
    // Testcontainers Postgres, not the Docker Compose database.
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });

    const tables = await sql<{
      table_name: string;
      rls_enabled: boolean;
      rls_forced: boolean;
    }>`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'organisation_id'
        )
      ORDER BY c.relname
    `.execute(db);

    tenantTables = tables.rows
      .filter((row) => !NOT_TENANT_SCOPED.has(row.table_name))
      .map((row) => ({
        tableName: row.table_name,
        rlsEnabled: row.rls_enabled,
        rlsForced: row.rls_forced,
      }));

    const policyRows = await sql<{
      tablename: string;
      policyname: string;
      cmd: string;
      qual: string | null;
    }>`
      SELECT tablename, policyname, cmd, qual
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname
    `.execute(db);

    policies = policyRows.rows.map((row) => ({
      tableName: row.tablename,
      policyName: row.policyname,
      command: row.cmd,
      using: row.qual,
    }));
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('finds the tenant tables to check, so a silent empty pass is impossible', () => {
    // Guards the whole file: if the catalogue query ever stops matching (a
    // schema rename, say), every other test here would pass vacuously over an
    // empty list. Naming a few tables that must always be present means that
    // failure surfaces as a failure rather than as green.
    expect(tenantTables.length).toBeGreaterThan(15);

    const names = tenantTables.map((table) => table.tableName);
    expect(names).toContain('cases');
    expect(names).toContain('case_tasks');
    expect(names).toContain('audit_events');
    expect(names).toContain('organisation_members');

    // The tenant root carries the column but is not scoped by it.
    expect(names).not.toContain('organisations');
  });

  it('enables and forces row-level security on every tenant table', () => {
    for (const table of tenantTables) {
      // FORCE matters as much as ENABLE. Without it the policy is bypassed
      // for the table's owner, and migrations run as the owner, so an
      // ENABLE-only table looks protected in the catalogue while the
      // application's own role could still read across tenants if it ever
      // owned the table (ADR-0009).
      expect(table.rlsEnabled, `${table.tableName} has RLS enabled`).toBe(true);
      expect(table.rlsForced, `${table.tableName} has RLS forced`).toBe(true);
    }
  });

  it('gives every tenant table a tenant_isolation policy scoped to the session setting', () => {
    for (const table of tenantTables) {
      const policy = policies.find(
        (candidate) =>
          candidate.tableName === table.tableName && candidate.policyName === 'tenant_isolation',
      );

      expect(policy, `${table.tableName} has a tenant_isolation policy`).toBeDefined();
      expect(policy?.command, `${table.tableName} tenant_isolation covers every command`).toBe(
        'ALL',
      );

      // A policy of USING (true) would satisfy every structural check above
      // while isolating nothing, so the expression itself is asserted: it
      // must compare this table's organisation_id against the per-transaction
      // setting the application sets (ADR-0004).
      expect(policy?.using, `${table.tableName} policy compares organisation_id`).toContain(
        'organisation_id',
      );
      expect(policy?.using, `${table.tableName} policy reads the tenant setting`).toContain(
        'orgflow.organisation_id',
      );
    }
  });

  it('permits no cross-tenant policy beyond ADR-0042’s published library', () => {
    const unexpected = policies.filter((policy) => {
      if (policy.policyName === 'tenant_isolation') {
        return false;
      }
      return PERMITTED_EXTRA_POLICIES.get(policy.tableName) !== policy.policyName;
    });

    expect(
      unexpected.map((policy) => `${policy.tableName}.${policy.policyName}`),
      'a new policy widening tenant isolation needs an ADR, not just a migration',
    ).toEqual([]);
  });

  it('detects a tenant table that was created without row-level security', async () => {
    // The negative control for this whole file. Every assertion above passes
    // against a correct schema, which on its own says nothing about whether
    // they would catch an incorrect one. So an unprotected tenant table is
    // created here on purpose, and the same catalogue query has to notice it.
    //
    // This is the exact mistake being guarded against: a migration that adds
    // organisation_id and forgets ENABLE ROW LEVEL SECURITY. Without this
    // test, a query that silently stopped matching would leave the suite
    // green while covering nothing.
    await sql`
      CREATE TABLE rls_negative_control (
        rls_negative_control_id uuid PRIMARY KEY,
        organisation_id uuid NOT NULL
      )
    `.execute(db);

    try {
      const probe = await sql<{ table_name: string; rls_enabled: boolean }>`
        SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND EXISTS (
            SELECT 1 FROM information_schema.columns col
            WHERE col.table_schema = 'public'
              AND col.table_name = c.relname
              AND col.column_name = 'organisation_id'
          )
          AND c.relname = 'rls_negative_control'
      `.execute(db);

      // Found by the query, and found to be unprotected: the two halves that
      // together make the assertions above meaningful.
      expect(probe.rows).toHaveLength(1);
      expect(probe.rows[0]?.rls_enabled).toBe(false);
    } finally {
      await sql`DROP TABLE rls_negative_control`.execute(db);
    }
  });

  it('keeps the published library read-only, so sharing a template does not surrender it', () => {
    const published = policies.find(
      (policy) => policy.policyName === 'published_library_is_readable',
    );

    expect(published, 'the published library policy still exists').toBeDefined();
    // FOR SELECT deliberately: another organisation may read and clone a
    // published template, but its UPDATE and DELETE still match zero rows.
    expect(published?.command).toBe('SELECT');
    expect(published?.tableName).toBe('templates');
  });
});
