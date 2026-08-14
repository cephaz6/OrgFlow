import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from './connection.js';
import { appendAuditEvent, findAuditEventsForCase } from './repositories/audit-events.js';
import {
  cancelOpenTasksForCase,
  createCaseTask,
  findCaseTasksForCase,
  findOpenTasksForAssignee,
  recordTaskDecision,
  TaskConcurrencyError,
} from './repositories/case-tasks.js';
import { appendCaseTransition } from './repositories/case-transitions.js';
import {
  CaseConcurrencyError,
  createCase,
  findCaseById,
  findCasesForCurrentTenant,
  updateCaseState,
} from './repositories/cases.js';
import { createOrganisation } from './repositories/organisations.js';
import {
  allocateCaseReference,
  createProcessDefinition,
  createProcessVersion,
  findPublishedProcessDefinitions,
  publishProcessVersion,
} from './repositories/process-definitions.js';
import { createUserWithIdentity } from './repositories/users.js';
import type { Database } from './schema.js';
import { withTenantTransaction } from './tenant-transaction.js';
import { generateId } from './uuid.js';

// A whole tenant's worth of Phase 1 fixtures, created on the unscoped
// connection so the test can set up two organisations and then prove they
// cannot see each other.
async function seedTenant(db: Kysely<Database>, label: string) {
  const user = await createUserWithIdentity(db, {
    email: `${label}-${generateId()}@example.invalid`,
    displayName: `${label} user`,
    issuer: 'urn:orgflow:test',
    subject: `${label}-${generateId()}`,
  });

  const organisation = await createOrganisation(db, {
    name: `${label} tenant`,
    slug: `${label}-${generateId()}`,
    createdByUserId: user.userId,
  });

  const { definition, version } = await withTenantTransaction(
    db,
    organisation.organisationId,
    async (trx) => {
      const created = await createProcessDefinition(trx, {
        organisationId: organisation.organisationId,
        key: 'laptop-request',
        name: 'Laptop request',
        referencePrefix: 'LAP',
        createdByUserId: user.userId,
      });

      const createdVersion = await createProcessVersion(trx, {
        organisationId: organisation.organisationId,
        definitionId: created.definitionId,
        versionNumber: 1,
        documentId: `doc-${generateId()}`,
        documentHash: 'sha256-placeholder',
      });

      await publishProcessVersion(trx, createdVersion.versionId, user.userId);
      return { definition: created, version: createdVersion };
    },
  );

  return { user, organisation, definition, version };
}

describe('process and case schema', () => {
  let db: Kysely<Database>;
  let tenantA: Awaited<ReturnType<typeof seedTenant>>;
  let tenantB: Awaited<ReturnType<typeof seedTenant>>;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    tenantA = await seedTenant(db, 'tenant-a');
    tenantB = await seedTenant(db, 'tenant-b');
  });

  afterAll(async () => {
    await db.destroy();
  });

  async function createSubmittedCase(tenant: typeof tenantA, title = 'A laptop') {
    return withTenantTransaction(db, tenant.organisation.organisationId, async (trx) => {
      const reference = await allocateCaseReference(trx, tenant.definition.definitionId);
      return createCase(trx, {
        organisationId: tenant.organisation.organisationId,
        definitionId: tenant.definition.definitionId,
        versionId: tenant.version.versionId,
        reference,
        title,
        submittedByUserId: tenant.user.userId,
      });
    });
  }

  it('allocates zero-padded, sequential case references per definition', async () => {
    const first = await createSubmittedCase(tenantA);
    const second = await createSubmittedCase(tenantA);

    expect(first.reference).toMatch(/^LAP-\d{6}$/);
    expect(second.reference).toMatch(/^LAP-\d{6}$/);
    expect(first.reference).not.toBe(second.reference);

    const firstCounter = Number(first.reference.split('-')[1]);
    const secondCounter = Number(second.reference.split('-')[1]);
    expect(secondCounter).toBe(firstCounter + 1);
  });

  it('never issues the same reference twice under concurrent allocation', async () => {
    // The whole point of doing the increment as UPDATE ... RETURNING: run
    // ten submissions at once and every reference must still be distinct.
    const references = await Promise.all(
      Array.from({ length: 10 }, () => createSubmittedCase(tenantA)),
    );

    const unique = new Set(references.map((created) => created.reference));
    expect(unique.size).toBe(references.length);
  });

  it('hides one tenant’s cases from another tenant’s session', async () => {
    const caseA = await createSubmittedCase(tenantA);

    const visibleToB = await withTenantTransaction(db, tenantB.organisation.organisationId, (trx) =>
      findCaseById(trx, caseA.caseId),
    );

    expect(visibleToB).toBeNull();

    const visibleToA = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      findCaseById(trx, caseA.caseId),
    );

    expect(visibleToA?.caseId).toBe(caseA.caseId);
  });

  it('scopes case listings to the current tenant', async () => {
    await createSubmittedCase(tenantB, 'Tenant B laptop');

    const listedForB = await withTenantTransaction(db, tenantB.organisation.organisationId, (trx) =>
      findCasesForCurrentTenant(trx),
    );

    expect(listedForB.length).toBeGreaterThan(0);
    for (const found of listedForB) {
      expect(found.organisationId).toBe(tenantB.organisation.organisationId);
    }
  });

  it('scopes published definitions to the current tenant', async () => {
    const forA = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      findPublishedProcessDefinitions(trx),
    );

    expect(forA).toHaveLength(1);
    expect(forA[0]?.definitionId).toBe(tenantA.definition.definitionId);
  });

  it('rejects a case update whose expected row version has moved', async () => {
    const created = await createSubmittedCase(tenantA);

    const updated = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      updateCaseState(trx, {
        caseId: created.caseId,
        expectedRowVersion: created.rowVersion,
        status: 'active',
        currentStepKey: 'managerApproval',
      }),
    );

    expect(updated.status).toBe('active');
    expect(updated.rowVersion).toBe(created.rowVersion + 1);

    // A second writer holding the now-stale version must lose.
    await expect(
      withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
        updateCaseState(trx, {
          caseId: created.caseId,
          expectedRowVersion: created.rowVersion,
          status: 'completed',
        }),
      ),
    ).rejects.toThrow(CaseConcurrencyError);
  });

  it('records a task decision once and rejects a concurrent second decision', async () => {
    const created = await createSubmittedCase(tenantA);

    const task = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      createCaseTask(trx, {
        organisationId: tenantA.organisation.organisationId,
        caseId: created.caseId,
        stepKey: 'managerApproval',
        stepName: 'Line manager approval',
        taskType: 'approval',
        assignmentStrategy: 'lineManager',
        assigneeUserId: tenantA.user.userId,
      }),
    );

    const decided = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      recordTaskDecision(trx, {
        taskId: task.taskId,
        expectedRowVersion: task.rowVersion,
        decision: 'approved',
        completedByUserId: tenantA.user.userId,
      }),
    );

    expect(decided.decision).toBe('approved');
    expect(decided.status).toBe('completed');

    await expect(
      withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
        recordTaskDecision(trx, {
          taskId: task.taskId,
          expectedRowVersion: task.rowVersion,
          decision: 'rejected',
          completedByUserId: tenantA.user.userId,
        }),
      ),
    ).rejects.toThrow(TaskConcurrencyError);
  });

  it('lists open tasks for an assignee and cancels them when the case terminates', async () => {
    const created = await createSubmittedCase(tenantA);

    await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      createCaseTask(trx, {
        organisationId: tenantA.organisation.organisationId,
        caseId: created.caseId,
        stepKey: 'itFulfilment',
        stepName: 'IT fulfilment',
        taskType: 'action',
        assignmentStrategy: 'specificUser',
        assigneeUserId: tenantA.user.userId,
      }),
    );

    const open = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      findOpenTasksForAssignee(trx, tenantA.user.userId),
    );
    expect(open.some((task) => task.caseId === created.caseId)).toBe(true);

    await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      cancelOpenTasksForCase(trx, created.caseId),
    );

    const afterCancel = await withTenantTransaction(
      db,
      tenantA.organisation.organisationId,
      (trx) => findCaseTasksForCase(trx, created.caseId),
    );
    expect(afterCancel.every((task) => task.status === 'cancelled')).toBe(true);
  });

  it('writes an audit row in the same transaction as the change it describes', async () => {
    const created = await createSubmittedCase(tenantA);

    await withTenantTransaction(db, tenantA.organisation.organisationId, async (trx) => {
      await updateCaseState(trx, {
        caseId: created.caseId,
        expectedRowVersion: created.rowVersion,
        status: 'active',
        currentStepKey: 'managerApproval',
      });
      await appendCaseTransition(trx, {
        organisationId: tenantA.organisation.organisationId,
        caseId: created.caseId,
        fromStepKey: null,
        toStepKey: 'managerApproval',
        triggerType: 'submission',
        triggeredByUserId: tenantA.user.userId,
      });
      await appendAuditEvent(trx, {
        organisationId: tenantA.organisation.organisationId,
        actorUserId: tenantA.user.userId,
        entityType: 'case',
        entityId: created.caseId,
        action: 'case.submitted',
        payload: { reference: created.reference },
      });
    });

    const audit = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      findAuditEventsForCase(trx, created.caseId),
    );

    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('case.submitted');
    expect(audit[0]?.payload).toEqual({ reference: created.reference });
  });

  it('rolls the audit row back with the change when the transaction fails', async () => {
    const created = await createSubmittedCase(tenantA);

    await expect(
      withTenantTransaction(db, tenantA.organisation.organisationId, async (trx) => {
        await appendAuditEvent(trx, {
          organisationId: tenantA.organisation.organisationId,
          actorUserId: tenantA.user.userId,
          entityType: 'case',
          entityId: created.caseId,
          action: 'case.submitted',
        });
        throw new Error('state change failed after the audit row was written');
      }),
    ).rejects.toThrow('state change failed');

    const audit = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      findAuditEventsForCase(trx, created.caseId),
    );

    // No audit row survives a failed change: that is what writing both in
    // one transaction buys, and it is why appendAuditEvent takes a
    // Transaction rather than a connection.
    expect(audit).toHaveLength(0);
  });

  it('refuses to update or delete an audit row, enforced by grants', async () => {
    const created = await createSubmittedCase(tenantA);

    await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      appendAuditEvent(trx, {
        organisationId: tenantA.organisation.organisationId,
        actorUserId: tenantA.user.userId,
        entityType: 'case',
        entityId: created.caseId,
        action: 'case.submitted',
      }),
    );

    await expect(
      withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
        trx
          .updateTable('audit_events')
          .set({ action: 'case.tampered' })
          .where('entity_id', '=', created.caseId)
          .execute(),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
        trx.deleteFrom('audit_events').where('entity_id', '=', created.caseId).execute(),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
