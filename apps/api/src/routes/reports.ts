import {
  findApproverLoad,
  findBottlenecksAcrossDefinitions,
  findCasesForCurrentTenant,
  findEscalationAndReturnRates,
  findProcessDefinitionById,
  findRejectionCountsByStep,
  findStepDurations,
  findTurnaroundStats,
  findVolumeByDefinition,
  withTenantTransaction,
} from '@orgflow/db';
import type { Database } from '@orgflow/db';
import type {
  ApproverLoadEntry,
  BottleneckEntry,
  DefinitionReport,
  OverviewReport,
  ReportBucket,
  StepDuration,
} from '@orgflow/types';
import { Router } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { canViewReports, isAdministrator } from '../cases/permissions.js';
import { toCsv } from '../lib/csv.js';
import { parseBody } from '../lib/parse-body.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import { requireSession, sessionOf } from '../middleware/require-session.js';

export interface ReportsDeps {
  db: Kysely<Database>;
  sessionSecret: string;
}

const DEFAULT_RANGE_DAYS = 90;

const rangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  bucket: z.enum(['day', 'week', 'month']).optional(),
});

// No precedent to match for volume's bucket granularity or default date
// window, since nothing has queried cases by date range before this
// feature. week/90 days chosen as reasonable defaults for a brand-new
// endpoint nobody depends on yet; documented here rather than asked
// separately, since a default is cheap to change later and expensive to
// leave silently unspecified.
function parseRange(query: Record<string, unknown>): {
  from: Date;
  to: Date;
  bucket: ReportBucket;
} {
  const parsed = parseBody(rangeSchema, query);
  const to = parsed.to ? new Date(parsed.to) : new Date();
  const from = parsed.from
    ? new Date(parsed.from)
    : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  return { from, to, bucket: parsed.bucket ?? 'week' };
}

function toStepDuration(row: {
  stepKey: string;
  stepName: string;
  meanHours: number;
  medianHours: number;
  sampleSize: number;
}): StepDuration {
  return {
    stepKey: row.stepKey,
    stepName: row.stepName,
    meanDurationHours: row.meanHours,
    medianDurationHours: row.medianHours,
    sampleSize: row.sampleSize,
  };
}

// PRD.md §11.8/§17: process metrics, bottleneck analysis, approver load,
// and CSV export. Every GET requires canViewReports (processOwner, admin
// or owner); GET /reports/approver-load additionally requires
// isAdministrator, since it is the one individual-level view PRD.md §17.2
// gates more tightly than the aggregate reports around it.
export function createReportsRouter(deps: ReportsDeps): Router {
  const router = Router();

  router.use(['/reports', '/exports'], requireSession(deps.sessionSecret));

  router.get('/reports/overview', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const range = parseRange(req.query as Record<string, unknown>);

      const report = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await canViewReports(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Reporting requires the process owner, admin or owner role.',
          );
        }

        const [volume, turnaround] = await Promise.all([
          findVolumeByDefinition(
            trx,
            { organisationId: session.organisationId, from: range.from, to: range.to },
            range.bucket,
          ),
          findTurnaroundStats(trx, {
            organisationId: session.organisationId,
            from: range.from,
            to: range.to,
          }),
        ]);

        const total = turnaround.completed + turnaround.rejected + turnaround.cancelled;

        const body: OverviewReport = {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          bucket: range.bucket,
          volume: volume.map((row) => ({
            periodStart: row.periodStart.toISOString(),
            definitionId: row.definitionId,
            definitionName: row.definitionName,
            count: row.count,
          })),
          completionRate: total > 0 ? turnaround.completed / total : null,
          medianTurnaroundHours: turnaround.medianHours,
          p90TurnaroundHours: turnaround.p90Hours,
        };
        return body;
      });

      res.status(200).json(report);
    } catch (err) {
      next(err);
    }
  });

  router.get('/reports/definitions/:id', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const definitionId = req.params.id!;
      const range = parseRange(req.query as Record<string, unknown>);

      const report = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await canViewReports(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Reporting requires the process owner, admin or owner role.',
          );
        }

        // Cross-tenant access returns 404, never 403 (CLAUDE.md §3): RLS
        // already hides another organisation's definition, so a miss here
        // means either it does not exist or it is not this tenant's.
        const definition = await findProcessDefinitionById(trx, definitionId);
        if (!definition) {
          throw new HttpProblemError(404, 'Not Found', 'No such process definition.');
        }

        const dateRange = {
          organisationId: session.organisationId,
          from: range.from,
          to: range.to,
        };
        const [turnaround, steps, rejections, rates] = await Promise.all([
          findTurnaroundStats(trx, dateRange, definitionId),
          findStepDurations(trx, dateRange, definitionId),
          findRejectionCountsByStep(trx, dateRange, definitionId),
          findEscalationAndReturnRates(trx, dateRange, definitionId),
        ]);

        const total = turnaround.completed + turnaround.rejected + turnaround.cancelled;
        const stepDurations = steps.map(toStepDuration);
        const slowestStep =
          stepDurations.length > 0
            ? [...stepDurations].sort((a, b) => b.meanDurationHours - a.meanDurationHours)[0]!
            : null;

        const body: DefinitionReport = {
          definitionId: definition.definitionId,
          definitionName: definition.name,
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          volume: total,
          completionRate: total > 0 ? turnaround.completed / total : null,
          medianTurnaroundHours: turnaround.medianHours,
          p90TurnaroundHours: turnaround.p90Hours,
          escalationRate: rates.escalationRate,
          returnRate: rates.returnRate,
          steps: stepDurations,
          slowestStep,
          rejectionReasons: rejections.map((row) => ({
            stepKey: row.stepKey,
            stepName: row.stepName,
            rejectedCount: row.rejectedCount,
          })),
        };
        return body;
      });

      res.status(200).json(report);
    } catch (err) {
      next(err);
    }
  });

  router.get('/reports/bottlenecks', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const range = parseRange(req.query as Record<string, unknown>);

      const bottlenecks = await withTenantTransaction(
        deps.db,
        session.organisationId,
        async (trx) => {
          if (!(await canViewReports(trx, session))) {
            throw new HttpProblemError(
              403,
              'Forbidden',
              'Reporting requires the process owner, admin or owner role.',
            );
          }

          return findBottlenecksAcrossDefinitions(trx, {
            organisationId: session.organisationId,
            from: range.from,
            to: range.to,
          });
        },
      );

      const body: BottleneckEntry[] = bottlenecks.map((row) => ({
        ...toStepDuration(row),
        definitionId: row.definitionId,
        definitionName: row.definitionName,
      }));

      res.status(200).json({ data: body });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §17.1/§17.2: individual-level, so this is the one report route
  // gated to admin/owner rather than the broader canViewReports set.
  // Suppression below five is already applied inside findApproverLoad, so
  // this handler never has to remember to filter.
  router.get('/reports/approver-load', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const range = parseRange(req.query as Record<string, unknown>);

      const rows = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Approver load is an individual-level report; it requires the admin or owner role.',
          );
        }

        return findApproverLoad(trx, {
          organisationId: session.organisationId,
          from: range.from,
          to: range.to,
        });
      });

      const body: ApproverLoadEntry[] = rows.map((row) => ({
        approverUserId: row.approverUserId,
        approverName: row.approverName,
        tasksHandled: row.tasksHandled,
        medianTurnaroundHours: row.medianHours,
      }));

      res.status(200).json({ data: body });
    } catch (err) {
      next(err);
    }
  });

  const exportRequestSchema = z.object({
    definitionId: z.string().uuid().optional(),
    status: z
      .enum(['draft', 'active', 'completed', 'rejected', 'cancelled', 'unassigned'])
      .optional(),
  });

  // Synchronous CSV, not the PRD-literal async SQS+S3+presigned-link
  // pipeline: nothing exists yet for that (no presign helper, no exports
  // queue, nothing deployed to AWS at all), so this streams the CSV
  // directly in the response, capped at 5000 rows rather than true
  // pagination, since the response is a single body. Real async delivery
  // is a follow-up once AWS is actually deployed.
  router.post('/exports', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const body = parseBody(exportRequestSchema, req.body);
      const EXPORT_ROW_CAP = 5000;
      const PAGE_SIZE = 200;

      const cases = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await canViewReports(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Exporting the case list requires the process owner, admin or owner role.',
          );
        }

        const collected: Awaited<ReturnType<typeof findCasesForCurrentTenant>>['cases'] = [];
        let cursor: string | undefined;
        for (;;) {
          const page = await findCasesForCurrentTenant(trx, {
            ...(body.definitionId ? { definitionId: body.definitionId } : {}),
            ...(body.status ? { status: body.status } : {}),
            ...(cursor ? { cursor } : {}),
            limit: PAGE_SIZE,
          });
          collected.push(...page.cases);
          if (!page.hasMore || collected.length >= EXPORT_ROW_CAP) {
            break;
          }
          cursor = page.nextCursor ?? undefined;
        }
        return collected.slice(0, EXPORT_ROW_CAP);
      });

      // Deliberately excludes submitter identity and form values: both may
      // carry personal data (PRD.md §18's containsPersonalData exclusion),
      // and this synchronous export has no redaction pass. That belongs to
      // the real async export, not reinvented here.
      const csv = toCsv(
        ['Reference', 'Title', 'Status', 'Current step', 'Submitted at', 'Completed at'],
        cases.map((c) => [
          c.reference,
          c.title,
          c.status,
          c.currentStepKey,
          c.submittedAt,
          c.completedAt,
        ]),
      );

      res
        .status(200)
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="orgflow-export-${Date.now()}.csv"`)
        .send(csv);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
