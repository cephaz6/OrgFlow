import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from './connection.js';
import { createCaseTask } from './repositories/case-tasks.js';
import { createCase } from './repositories/cases.js';
import {
  createDelegation,
  deleteDelegation,
  findActiveDelegateByUserId,
  findDelegationsForUser,
} from './repositories/delegations.js';
import { createOrganisation } from './repositories/organisations.js';
import {
  createProcessDefinition,
  createProcessVersion,
  publishProcessVersion,
} from './repositories/process-definitions.js';
import { cancelTimersForCase, createSlaTimer, findDueTimers } from './repositories/sla-timers.js';
import { createUserWithIdentity } from './repositories/users.js';
import type { Database } from './schema.js';
import { withTenantTransaction } from './tenant-transaction.js';
import { generateId } from './uuid.js';

// Mirrors case-schema.integration.test.ts's seedTenant: a whole tenant's
// worth of fixtures, created on the unscoped connection, so the test can
// prove two tenants cannot see each other's sla_timers or delegations.
async function seedTenant(db: Kysely<Database>, label: string) {
  const user = await createUserWithIdentity(db, {
    email: `${label}-${generateId()}@example.invalid`,
    displayName: `${label} user`,
    issuer: 'urn:orgflow:test',
    subject: `${label}-${generateId()}`,
  });

  const otherUser = await createUserWithIdentity(db, {
    email: `${label}-other-${generateId()}@example.invalid`,
    displayName: `${label} other user`,
    issuer: 'urn:orgflow:test',
    subject: `${label}-other-${generateId()}`,
  });

  const organisation = await createOrganisation(db, {
    name: `${label} tenant`,
    slug: `${label}-${generateId()}`,
    createdByUserId: user.userId,
  });

  const { caseRow, task } = await withTenantTransaction(
    db,
    organisation.organisationId,
    async (trx) => {
      const definition = await createProcessDefinition(trx, {
        organisationId: organisation.organisationId,
        key: 'laptop-request',
        name: 'Laptop request',
        referencePrefix: 'LAP',
        createdByUserId: user.userId,
      });

      const version = await createProcessVersion(trx, {
        organisationId: organisation.organisationId,
        definitionId: definition.definitionId,
        versionNumber: 1,
        documentId: `doc-${generateId()}`,
        documentHash: 'sha256-placeholder',
      });
      await publishProcessVersion(trx, version.versionId, user.userId);

      const createdCase = await createCase(trx, {
        organisationId: organisation.organisationId,
        definitionId: definition.definitionId,
        versionId: version.versionId,
        title: 'A laptop',
        submittedByUserId: user.userId,
      });

      const createdTask = await createCaseTask(trx, {
        organisationId: organisation.organisationId,
        caseId: createdCase.caseId,
        stepKey: 'approval',
        stepName: 'Line manager approval',
        taskType: 'approval',
        assignmentStrategy: 'specificUser',
        assigneeUserId: user.userId,
      });

      return { caseRow: createdCase, task: createdTask };
    },
  );

  return { user, otherUser, organisation, caseRow, task };
}

describe('cross-tenant isolation on sla_timers and delegations', () => {
  let db: Kysely<Database>;
  let tenantA: Awaited<ReturnType<typeof seedTenant>>;
  let tenantB: Awaited<ReturnType<typeof seedTenant>>;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    tenantA = await seedTenant(db, 'sla-tenant-a');
    tenantB = await seedTenant(db, 'sla-tenant-b');
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('sla_timers', () => {
    it("finds a due timer scoped to its own organisation, never another tenant's", async () => {
      const dueSoon = new Date(Date.now() - 60_000);

      await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
        createSlaTimer(trx, {
          organisationId: tenantA.organisation.organisationId,
          caseId: tenantA.caseRow.caseId,
          taskId: tenantA.task.taskId,
          timerType: 'reminder',
          escalationLevel: 0,
          fireAt: dueSoon.toISOString(),
        }),
      );

      // findDueTimers is the one deliberate cross-tenant read (see its own
      // comment in sla-timers.ts): it has to see every organisation's due
      // work, so this asserts it finds tenant A's row while every mutation
      // afterwards still goes through withTenantTransaction, scoped to the
      // row's own organisation_id.
      const due = await findDueTimers(db, new Date());
      const tenantARows = due.filter((timer) => timer.caseId === tenantA.caseRow.caseId);
      const tenantBRows = due.filter((timer) => timer.caseId === tenantB.caseRow.caseId);

      expect(tenantARows).toHaveLength(1);
      expect(tenantARows[0]?.organisationId).toBe(tenantA.organisation.organisationId);
      expect(tenantBRows).toHaveLength(0);
    });

    it('rejects inserting a timer for organisation B while scoped to organisation A', async () => {
      await expect(
        withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
          createSlaTimer(trx, {
            organisationId: tenantB.organisation.organisationId,
            caseId: tenantB.caseRow.caseId,
            taskId: tenantB.task.taskId,
            timerType: 'escalation',
            escalationLevel: 1,
            fireAt: new Date().toISOString(),
          }),
        ),
      ).rejects.toThrow();
    });

    it('cancelling organisation A timers never touches organisation B rows', async () => {
      await withTenantTransaction(db, tenantB.organisation.organisationId, (trx) =>
        createSlaTimer(trx, {
          organisationId: tenantB.organisation.organisationId,
          caseId: tenantB.caseRow.caseId,
          taskId: tenantB.task.taskId,
          timerType: 'reminder',
          escalationLevel: 0,
          fireAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      );

      await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
        cancelTimersForCase(trx, tenantA.caseRow.caseId),
      );

      const stillDue = await findDueTimers(db, new Date());
      expect(stillDue.some((timer) => timer.caseId === tenantB.caseRow.caseId)).toBe(true);
    });
  });

  describe('delegations', () => {
    it('hides organisation A delegations from a session scoped to organisation B', async () => {
      await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
        createDelegation(trx, {
          organisationId: tenantA.organisation.organisationId,
          fromUserId: tenantA.user.userId,
          toUserId: tenantA.otherUser.userId,
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      );

      const visibleToB = await withTenantTransaction(
        db,
        tenantB.organisation.organisationId,
        (trx) => findDelegationsForUser(trx, tenantA.user.userId),
      );

      expect(visibleToB.delegations).toHaveLength(0);
    });

    it('returns organisation A delegations to a session scoped to organisation A', async () => {
      const visibleToA = await withTenantTransaction(
        db,
        tenantA.organisation.organisationId,
        (trx) => findDelegationsForUser(trx, tenantA.user.userId),
      );

      expect(visibleToA.delegations).toHaveLength(1);
      expect(visibleToA.delegations[0]?.fromUserId).toBe(tenantA.user.userId);
      expect(visibleToA.delegations[0]?.toUserId).toBe(tenantA.otherUser.userId);
    });

    it('resolves an active delegate only within the delegating organisation', async () => {
      const activeInA = await withTenantTransaction(
        db,
        tenantA.organisation.organisationId,
        (trx) => findActiveDelegateByUserId(trx, new Date()),
      );
      const activeInB = await withTenantTransaction(
        db,
        tenantB.organisation.organisationId,
        (trx) => findActiveDelegateByUserId(trx, new Date()),
      );

      expect(activeInA[tenantA.user.userId]).toBe(tenantA.otherUser.userId);
      expect(activeInB[tenantA.user.userId]).toBeUndefined();
    });

    it('rejects inserting a delegation for organisation B while scoped to organisation A', async () => {
      await expect(
        withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
          createDelegation(trx, {
            organisationId: tenantB.organisation.organisationId,
            fromUserId: tenantB.user.userId,
            toUserId: tenantB.otherUser.userId,
            startsAt: new Date().toISOString(),
            endsAt: new Date(Date.now() + 60_000).toISOString(),
          }),
        ),
      ).rejects.toThrow();
    });

    it('deletes only the targeted delegation, leaving the other tenant untouched', async () => {
      const created = await withTenantTransaction(db, tenantB.organisation.organisationId, (trx) =>
        createDelegation(trx, {
          organisationId: tenantB.organisation.organisationId,
          fromUserId: tenantB.user.userId,
          toUserId: tenantB.otherUser.userId,
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      );

      await withTenantTransaction(db, tenantB.organisation.organisationId, (trx) =>
        deleteDelegation(trx, created.delegationId),
      );

      const remainingInB = await withTenantTransaction(
        db,
        tenantB.organisation.organisationId,
        (trx) => findDelegationsForUser(trx, tenantB.user.userId),
      );
      const remainingInA = await withTenantTransaction(
        db,
        tenantA.organisation.organisationId,
        (trx) => findDelegationsForUser(trx, tenantA.user.userId),
      );

      expect(remainingInB.delegations).toHaveLength(0);
      expect(remainingInA.delegations).toHaveLength(1);
    });
  });
});
