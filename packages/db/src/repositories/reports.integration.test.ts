import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from '../connection.js';
import { createCaseTask } from './case-tasks.js';
import { createCase, updateCaseState } from './cases.js';
import { createOrganisation } from './organisations.js';
import {
  createProcessDefinition,
  createProcessVersion,
  publishProcessVersion,
} from './process-definitions.js';
import {
  findApproverLoad,
  findBottlenecksAcrossDefinitions,
  findRejectionCountsByStep,
  findStepDurations,
  findTurnaroundStats,
  findVolumeByDefinition,
} from './reports.js';
import { createUserWithIdentity } from './users.js';
import type { Database } from '../schema.js';
import { withTenantTransaction } from '../tenant-transaction.js';
import { generateId } from '../uuid.js';

const HOUR = 60 * 60 * 1000;

// Mirrors sla-and-delegations.integration.test.ts's seedTenant: fixtures
// created on the unscoped connection, one organisation, one definition,
// one submitter, so each test only has to vary case/task/transition
// timestamps.
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

  const definitionId = await withTenantTransaction(db, organisation.organisationId, async (trx) => {
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
    return definition.definitionId;
  });

  return { user, organisation, definitionId };
}

interface CaseFixture {
  submittedAt: Date;
  completedAt: Date | null;
  status: 'completed' | 'rejected' | 'cancelled' | 'active';
}

// Creates a case pinned to the seeded definition and backdates
// submitted_at/completed_at to exact values, since the aggregation queries
// this file tests are only verifiable against known deltas, not "some
// recent timestamp."
async function seedCase(
  db: Kysely<Database>,
  tenant: Awaited<ReturnType<typeof seedTenant>>,
  fixture: CaseFixture,
) {
  return withTenantTransaction(db, tenant.organisation.organisationId, async (trx) => {
    const created = await createCase(trx, {
      organisationId: tenant.organisation.organisationId,
      definitionId: tenant.definitionId,
      versionId: (
        await trx
          .selectFrom('process_versions')
          .select('version_id')
          .where('definition_id', '=', tenant.definitionId)
          .executeTakeFirstOrThrow()
      ).version_id,
      title: 'A laptop',
      submittedByUserId: tenant.user.userId,
    });

    return updateCaseState(trx, {
      caseId: created.caseId,
      expectedRowVersion: created.rowVersion,
      status: fixture.status,
      submittedAt: fixture.submittedAt,
      completedAt: fixture.completedAt,
    });
  });
}

describe('reporting aggregation queries', () => {
  let db: Kysely<Database>;
  let tenantA: Awaited<ReturnType<typeof seedTenant>>;
  let tenantB: Awaited<ReturnType<typeof seedTenant>>;
  const rangeStart = new Date('2026-01-01T00:00:00.000Z');
  const rangeEnd = new Date('2026-02-01T00:00:00.000Z');

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    tenantA = await seedTenant(db, 'report-tenant-a');
    tenantB = await seedTenant(db, 'report-tenant-b');
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('findVolumeByDefinition', () => {
    it('counts cases by definition and week, scoped to the calling tenant', async () => {
      await seedCase(db, tenantA, {
        submittedAt: new Date('2026-01-05T09:00:00.000Z'),
        completedAt: null,
        status: 'active',
      });
      await seedCase(db, tenantA, {
        submittedAt: new Date('2026-01-06T09:00:00.000Z'),
        completedAt: null,
        status: 'active',
      });
      await seedCase(db, tenantB, {
        submittedAt: new Date('2026-01-05T09:00:00.000Z'),
        completedAt: null,
        status: 'active',
      });

      const rows = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
        findVolumeByDefinition(
          trx,
          { organisationId: tenantA.organisation.organisationId, from: rangeStart, to: rangeEnd },
          'week',
        ),
      );

      const total = rows.reduce((sum, row) => sum + row.count, 0);
      expect(total).toBe(2);
      expect(rows.every((row) => row.definitionId === tenantA.definitionId)).toBe(true);
    });
  });

  describe('findTurnaroundStats', () => {
    it('computes completion rate and median/p90 turnaround against known deltas', async () => {
      const tenant = await seedTenant(db, 'turnaround');
      const { organisation, definitionId } = tenant;
      const deltas = [1, 2, 3, 4, 100]; // hours
      const submittedAt = new Date('2026-01-10T00:00:00.000Z');

      for (const hours of deltas) {
        await withTenantTransaction(db, organisation.organisationId, async (trx) => {
          const version = await trx
            .selectFrom('process_versions')
            .select('version_id')
            .where('definition_id', '=', definitionId)
            .executeTakeFirstOrThrow();
          const created = await createCase(trx, {
            organisationId: organisation.organisationId,
            definitionId,
            versionId: version.version_id,
            title: 'A laptop',
            submittedByUserId: tenant.user.userId,
          });
          await updateCaseState(trx, {
            caseId: created.caseId,
            expectedRowVersion: created.rowVersion,
            status: 'completed',
            submittedAt,
            completedAt: new Date(submittedAt.getTime() + hours * HOUR),
          });
        });
      }

      const stats = await withTenantTransaction(db, organisation.organisationId, (trx) =>
        findTurnaroundStats(trx, {
          organisationId: organisation.organisationId,
          from: rangeStart,
          to: rangeEnd,
        }),
      );

      expect(stats.completed).toBe(5);
      expect(stats.rejected).toBe(0);
      expect(stats.cancelled).toBe(0);
      // percentile_cont(0.5) over [1,2,3,4,100] is the middle value, 3.
      expect(stats.medianHours).toBe(3);
      // percentile_cont(0.9) over 5 sorted values interpolates between the
      // 4th (4) and 5th (100) at position 0.9*(5-1) = 3.6, i.e.
      // 4 + 0.6*(100-4) = 61.6.
      expect(stats.p90Hours).toBeCloseTo(61.6, 5);
    });
  });

  describe('findStepDurations', () => {
    it('counts a step revisited after a return as two separate samples', async () => {
      const tenant = await seedTenant(db, 'stepdur');

      await withTenantTransaction(db, tenant.organisation.organisationId, async (trx) => {
        const version = await trx
          .selectFrom('process_versions')
          .select('version_id')
          .where('definition_id', '=', tenant.definitionId)
          .executeTakeFirstOrThrow();
        const created = await createCase(trx, {
          organisationId: tenant.organisation.organisationId,
          definitionId: tenant.definitionId,
          versionId: version.version_id,
          title: 'A laptop',
          submittedByUserId: tenant.user.userId,
        });
        await updateCaseState(trx, {
          caseId: created.caseId,
          expectedRowVersion: created.rowVersion,
          status: 'active',
          submittedAt: new Date('2026-01-10T00:00:00.000Z'),
        });

        await createCaseTask(trx, {
          organisationId: tenant.organisation.organisationId,
          caseId: created.caseId,
          stepKey: 'managerApproval',
          stepName: 'Line manager approval',
          taskType: 'approval',
          assignmentStrategy: 'lineManager',
          assigneeUserId: tenant.user.userId,
        });

        // Enters managerApproval, returns to requester (2h later), the
        // requester resubmits and re-enters managerApproval (1h after
        // that), which finally moves on 3h later: two visits to the same
        // step, 2h and 3h respectively.
        const t0 = new Date('2026-01-10T00:00:00.000Z');
        await trx
          .insertInto('case_transitions')
          .values({
            transition_id: generateId(),
            organisation_id: tenant.organisation.organisationId,
            case_id: created.caseId,
            from_step_key: null,
            to_step_key: 'managerApproval',
            trigger_type: 'submission',
            occurred_at: t0,
          })
          .execute();
        await trx
          .insertInto('case_transitions')
          .values({
            transition_id: generateId(),
            organisation_id: tenant.organisation.organisationId,
            case_id: created.caseId,
            from_step_key: 'managerApproval',
            to_step_key: '$returnedToRequester',
            trigger_type: 'decision',
            occurred_at: new Date(t0.getTime() + 2 * HOUR),
          })
          .execute();
        await trx
          .insertInto('case_transitions')
          .values({
            transition_id: generateId(),
            organisation_id: tenant.organisation.organisationId,
            case_id: created.caseId,
            from_step_key: '$returnedToRequester',
            to_step_key: 'managerApproval',
            trigger_type: 'system',
            occurred_at: new Date(t0.getTime() + 3 * HOUR),
          })
          .execute();
        await trx
          .insertInto('case_transitions')
          .values({
            transition_id: generateId(),
            organisation_id: tenant.organisation.organisationId,
            case_id: created.caseId,
            from_step_key: 'managerApproval',
            to_step_key: 'itFulfilment',
            trigger_type: 'decision',
            occurred_at: new Date(t0.getTime() + 6 * HOUR),
          })
          .execute();
      });

      // Only two of managerApproval's samples exist (2h, 3h), below the
      // suppress-below-five threshold, so the row must not appear even
      // though the query ran correctly.
      const suppressed = await withTenantTransaction(
        db,
        tenant.organisation.organisationId,
        (trx) =>
          findStepDurations(trx, {
            organisationId: tenant.organisation.organisationId,
            from: rangeStart,
            to: rangeEnd,
          }),
      );
      expect(suppressed.find((row) => row.stepKey === 'managerApproval')).toBeUndefined();
    });
  });

  describe('suppress-below-five', () => {
    it('omits an approver with four completed tasks but includes one with five', async () => {
      const tenant = await seedTenant(db, 'approverload');
      const fourTaskApprover = await createUserWithIdentity(db, {
        email: `four-${generateId()}@example.invalid`,
        displayName: 'Four Task Approver',
        issuer: 'urn:orgflow:test',
        subject: `four-${generateId()}`,
      });
      const fiveTaskApprover = await createUserWithIdentity(db, {
        email: `five-${generateId()}@example.invalid`,
        displayName: 'Five Task Approver',
        issuer: 'urn:orgflow:test',
        subject: `five-${generateId()}`,
      });

      async function completeTasksFor(approverUserId: string, count: number) {
        for (let i = 0; i < count; i += 1) {
          await withTenantTransaction(db, tenant.organisation.organisationId, async (trx) => {
            const version = await trx
              .selectFrom('process_versions')
              .select('version_id')
              .where('definition_id', '=', tenant.definitionId)
              .executeTakeFirstOrThrow();
            const created = await createCase(trx, {
              organisationId: tenant.organisation.organisationId,
              definitionId: tenant.definitionId,
              versionId: version.version_id,
              title: 'A laptop',
              submittedByUserId: tenant.user.userId,
            });
            await updateCaseState(trx, {
              caseId: created.caseId,
              expectedRowVersion: created.rowVersion,
              status: 'active',
              submittedAt: new Date('2026-01-10T00:00:00.000Z'),
            });
            const task = await createCaseTask(trx, {
              organisationId: tenant.organisation.organisationId,
              caseId: created.caseId,
              stepKey: 'managerApproval',
              stepName: 'Line manager approval',
              taskType: 'approval',
              assignmentStrategy: 'lineManager',
              assigneeUserId: approverUserId,
            });
            await trx
              .updateTable('case_tasks')
              .set({
                status: 'completed',
                decision: 'approved',
                completed_by_user_id: approverUserId,
                completed_at: new Date('2026-01-10T02:00:00.000Z'),
              })
              .where('task_id', '=', task.taskId)
              .execute();
          });
        }
      }

      await completeTasksFor(fourTaskApprover.userId, 4);
      await completeTasksFor(fiveTaskApprover.userId, 5);

      const rows = await withTenantTransaction(db, tenant.organisation.organisationId, (trx) =>
        findApproverLoad(trx, {
          organisationId: tenant.organisation.organisationId,
          from: rangeStart,
          to: rangeEnd,
        }),
      );

      expect(rows.find((row) => row.approverUserId === fourTaskApprover.userId)).toBeUndefined();
      const fiveRow = rows.find((row) => row.approverUserId === fiveTaskApprover.userId);
      expect(fiveRow?.tasksHandled).toBe(5);
    });

    it('omits a step with four rejections but includes one with five', async () => {
      const tenant = await seedTenant(db, 'rejectcount');

      async function rejectTasks(count: number) {
        for (let i = 0; i < count; i += 1) {
          await withTenantTransaction(db, tenant.organisation.organisationId, async (trx) => {
            const version = await trx
              .selectFrom('process_versions')
              .select('version_id')
              .where('definition_id', '=', tenant.definitionId)
              .executeTakeFirstOrThrow();
            const created = await createCase(trx, {
              organisationId: tenant.organisation.organisationId,
              definitionId: tenant.definitionId,
              versionId: version.version_id,
              title: 'A laptop',
              submittedByUserId: tenant.user.userId,
            });
            await updateCaseState(trx, {
              caseId: created.caseId,
              expectedRowVersion: created.rowVersion,
              status: 'rejected',
              submittedAt: new Date('2026-01-10T00:00:00.000Z'),
            });
            const task = await createCaseTask(trx, {
              organisationId: tenant.organisation.organisationId,
              caseId: created.caseId,
              stepKey: 'managerApproval',
              stepName: 'Line manager approval',
              taskType: 'approval',
              assignmentStrategy: 'lineManager',
              assigneeUserId: tenant.user.userId,
            });
            await trx
              .updateTable('case_tasks')
              .set({ status: 'completed', decision: 'rejected' })
              .where('task_id', '=', task.taskId)
              .execute();
          });
        }
      }

      await rejectTasks(4);

      const rows = await withTenantTransaction(db, tenant.organisation.organisationId, (trx) =>
        findRejectionCountsByStep(trx, {
          organisationId: tenant.organisation.organisationId,
          from: rangeStart,
          to: rangeEnd,
        }),
      );
      expect(rows.find((row) => row.stepKey === 'managerApproval')).toBeUndefined();

      await rejectTasks(1); // brings the total to five

      const afterFive = await withTenantTransaction(db, tenant.organisation.organisationId, (trx) =>
        findRejectionCountsByStep(trx, {
          organisationId: tenant.organisation.organisationId,
          from: rangeStart,
          to: rangeEnd,
        }),
      );
      const row = afterFive.find((entry) => entry.stepKey === 'managerApproval');
      expect(row?.rejectedCount).toBe(5);
    });
  });

  describe('cross-tenant isolation', () => {
    it("never returns another organisation's rows from any reporting function", async () => {
      const tenant = await seedTenant(db, 'crosstenant');
      const other = await seedTenant(db, 'crosstenant-other');

      await seedCase(db, tenant, {
        submittedAt: new Date('2026-01-15T00:00:00.000Z'),
        completedAt: new Date('2026-01-16T00:00:00.000Z'),
        status: 'completed',
      });
      await seedCase(db, other, {
        submittedAt: new Date('2026-01-15T00:00:00.000Z'),
        completedAt: new Date('2026-01-16T00:00:00.000Z'),
        status: 'completed',
      });

      const range = { from: rangeStart, to: rangeEnd };
      const volume = await withTenantTransaction(db, tenant.organisation.organisationId, (trx) =>
        findVolumeByDefinition(
          trx,
          { organisationId: tenant.organisation.organisationId, ...range },
          'week',
        ),
      );
      expect(volume.every((row) => row.definitionId === tenant.definitionId)).toBe(true);

      const bottlenecks = await withTenantTransaction(
        db,
        tenant.organisation.organisationId,
        (trx) =>
          findBottlenecksAcrossDefinitions(trx, {
            organisationId: tenant.organisation.organisationId,
            ...range,
          }),
      );
      expect(
        bottlenecks.every(
          (row) => row.definitionId === tenant.definitionId || row.definitionId === '',
        ),
      ).toBe(true);
    });
  });
});
