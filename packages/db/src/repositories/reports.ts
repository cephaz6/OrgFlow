import { sql, type Transaction } from 'kysely';
import type { ReportBucket } from '@orgflow/types';

import type { Database } from '../schema.js';

// PRD.md §17: the first aggregation-heavy repository in this codebase.
// Every function here takes a Transaction<Database>, meant to be called
// inside withTenantTransaction like everything else, so RLS scopes every
// row to one organisation automatically. organisationId is still passed
// and filtered on explicitly, for the same reason every other repository
// in this codebase does: an aggregate query with no visible predicate is
// harder to review, even though SET LOCAL ROLE already makes it correct.
export interface ReportDateRange {
  organisationId: string;
  from: Date;
  to: Date;
}

// PRD.md §17.2: "suppress groups smaller than five to prevent
// re-identification." Applied as a HAVING clause in every query below that
// groups by an individual or a small population (an approver, a step's
// rejection count, a step's sample size), never as a filter after the
// rows have already left Postgres. A suppressed row is one Postgres never
// returns, so there is no later code path that can leak it by forgetting
// to filter.
const SUPPRESS_BELOW = 5;

export interface VolumeRow {
  periodStart: Date;
  definitionId: string;
  definitionName: string;
  count: number;
}

// PRD.md §17.1 volume, by process, bucketed. Not suppressed (see the
// scope note in the plan): a plain case count is not attributable to an
// individual, and PRD.md treats volume as an always-shown top-line chart.
export async function findVolumeByDefinition(
  trx: Transaction<Database>,
  range: ReportDateRange,
  bucket: ReportBucket,
): Promise<VolumeRow[]> {
  // sql.lit, not a bound parameter: Postgres's GROUP BY/ORDER BY expression
  // matching compares parse trees, and two placeholders bound to the same
  // value at runtime are still different nodes to the planner. A literal
  // embeds the identical text everywhere this expression is repeated, so
  // the three usages below are recognised as the same expression.
  const periodExpr = sql<Date>`date_trunc(${sql.lit(bucket)}, cases.submitted_at)`;

  const rows = await trx
    .selectFrom('cases')
    .innerJoin('process_definitions', 'process_definitions.definition_id', 'cases.definition_id')
    .select([
      periodExpr.as('period_start'),
      'cases.definition_id as definitionId',
      'process_definitions.name as definitionName',
      sql<string>`count(*)`.as('count'),
    ])
    .where('cases.organisation_id', '=', range.organisationId)
    .where('cases.submitted_at', 'is not', null)
    .where('cases.submitted_at', '>=', range.from)
    .where('cases.submitted_at', '<', range.to)
    .groupBy([periodExpr, 'cases.definition_id', 'process_definitions.name'])
    .orderBy(periodExpr, 'asc')
    .execute();

  return rows.map((row) => ({
    periodStart: row.period_start,
    definitionId: row.definitionId,
    definitionName: row.definitionName,
    count: Number(row.count),
  }));
}

export interface TurnaroundStats {
  completed: number;
  rejected: number;
  cancelled: number;
  medianHours: number | null;
  p90Hours: number | null;
}

// PRD.md §17.1: completion rate (completed / (completed+rejected+cancelled))
// and median/p90 turnaround (submission to terminal state). One query:
// filtered counts per terminal status, plus percentile_cont over the
// submitted_at-to-completed_at gap in hours, restricted to cases that have
// actually completed (completed_at is not null) so an in-flight case
// cannot pull the distribution toward "still open."
export async function findTurnaroundStats(
  trx: Transaction<Database>,
  range: ReportDateRange,
  definitionId?: string,
): Promise<TurnaroundStats> {
  let query = trx
    .selectFrom('cases')
    .select([
      sql<string>`count(*) filter (where status = 'completed')`.as('completed'),
      sql<string>`count(*) filter (where status = 'rejected')`.as('rejected'),
      sql<string>`count(*) filter (where status = 'cancelled')`.as('cancelled'),
      sql<number | null>`percentile_cont(0.5) within group (
        order by extract(epoch from (completed_at - submitted_at)) / 3600.0
      ) filter (where completed_at is not null)`.as('median_hours'),
      sql<number | null>`percentile_cont(0.9) within group (
        order by extract(epoch from (completed_at - submitted_at)) / 3600.0
      ) filter (where completed_at is not null)`.as('p90_hours'),
    ])
    .where('organisation_id', '=', range.organisationId)
    .where('submitted_at', 'is not', null)
    .where('submitted_at', '>=', range.from)
    .where('submitted_at', '<', range.to);

  if (definitionId) {
    query = query.where('definition_id', '=', definitionId);
  }

  const row = await query.executeTakeFirstOrThrow();

  return {
    completed: Number(row.completed),
    rejected: Number(row.rejected),
    cancelled: Number(row.cancelled),
    medianHours: row.median_hours,
    p90Hours: row.p90_hours,
  };
}

export interface StepDurationRow {
  stepKey: string;
  stepName: string;
  meanHours: number;
  medianHours: number;
  sampleSize: number;
}

export interface BottleneckRow extends StepDurationRow {
  definitionId: string;
  definitionName: string;
}

// PRD.md §17.1 step duration, "the bottleneck view." Sourced from
// case_transitions rather than case_tasks: a step re-entered after a
// $returnedToRequester decision produces a second transition into it, and
// therefore a second sample, which the task row alone (one row per task,
// not per visit) would not capture. lead() finds the next transition for
// the same case in occurred_at order; the gap between a transition arriving
// at a step and the next transition for that case is that visit's
// duration. Suppressed below five samples per step.
async function stepDurationsQuery(
  trx: Transaction<Database>,
  range: ReportDateRange,
  definitionId: string | undefined,
  groupByDefinition: boolean,
): Promise<(StepDurationRow & { definitionId: string; definitionName: string })[]> {
  const definitionFilter = definitionId ? sql`and c.definition_id = ${definitionId}` : sql``;
  // v and pd are the outer query's aliases (the visits CTE and, when
  // grouping across definitions, process_definitions); t and c only exist
  // inside the CTE above and are not in scope out here.
  const groupColumns = groupByDefinition
    ? sql`v.to_step_key, ct.step_name, v.definition_id, pd.name`
    : sql`v.to_step_key, ct.step_name`;
  const selectDefinitionColumns = groupByDefinition
    ? sql`v.definition_id as definition_id, pd.name as definition_name,`
    : sql``;

  const result = await sql<{
    step_key: string;
    step_name: string;
    definition_id: string | null;
    definition_name: string | null;
    mean_hours: number;
    median_hours: number;
    sample_size: string;
  }>`
    with visits as (
      select
        t.case_id,
        t.to_step_key,
        c.definition_id,
        extract(epoch from (
          lead(t.occurred_at) over (partition by t.case_id order by t.occurred_at) - t.occurred_at
        )) / 3600.0 as duration_hours
      from case_transitions t
      inner join cases c on c.case_id = t.case_id
      where c.organisation_id = ${range.organisationId}
        and c.submitted_at >= ${range.from}
        and c.submitted_at < ${range.to}
        and t.to_step_key is not null
        ${definitionFilter}
    )
    select
      v.to_step_key as step_key,
      ct.step_name as step_name,
      ${selectDefinitionColumns}
      avg(v.duration_hours) as mean_hours,
      percentile_cont(0.5) within group (order by v.duration_hours) as median_hours,
      count(*) as sample_size
    from visits v
    inner join case_tasks ct on ct.case_id = v.case_id and ct.step_key = v.to_step_key
    ${groupByDefinition ? sql`inner join process_definitions pd on pd.definition_id = v.definition_id` : sql``}
    where v.duration_hours is not null
    group by ${groupColumns}
    having count(*) >= ${SUPPRESS_BELOW}
  `.execute(trx);

  return result.rows.map((row) => ({
    stepKey: row.step_key,
    stepName: row.step_name,
    definitionId: row.definition_id ?? '',
    definitionName: row.definition_name ?? '',
    meanHours: Number(row.mean_hours),
    medianHours: Number(row.median_hours),
    sampleSize: Number(row.sample_size),
  }));
}

export async function findStepDurations(
  trx: Transaction<Database>,
  range: ReportDateRange,
  definitionId?: string,
): Promise<StepDurationRow[]> {
  const rows = await stepDurationsQuery(trx, range, definitionId, false);
  return rows.map(({ stepKey, stepName, meanHours, medianHours, sampleSize }) => ({
    stepKey,
    stepName,
    meanHours,
    medianHours,
    sampleSize,
  }));
}

export async function findBottlenecksAcrossDefinitions(
  trx: Transaction<Database>,
  range: ReportDateRange,
): Promise<BottleneckRow[]> {
  const rows = await stepDurationsQuery(trx, range, undefined, true);
  return rows.sort((a, b) => b.meanHours - a.meanHours);
}

export interface RejectionCountRow {
  stepKey: string;
  stepName: string;
  rejectedCount: number;
}

// PRD.md §17.1 rejection reasons, grouped by step only (no sentiment
// analysis: nothing in the codebase does NLP, and nobody has asked for
// it). Suppressed below five rejections per step.
export async function findRejectionCountsByStep(
  trx: Transaction<Database>,
  range: ReportDateRange,
  definitionId?: string,
): Promise<RejectionCountRow[]> {
  let query = trx
    .selectFrom('case_tasks')
    .innerJoin('cases', 'cases.case_id', 'case_tasks.case_id')
    .select(['case_tasks.step_key as stepKey', 'case_tasks.step_name as stepName'])
    .select(sql<string>`count(*)`.as('rejectedCount'))
    .where('cases.organisation_id', '=', range.organisationId)
    .where('case_tasks.decision', '=', 'rejected')
    .where('cases.submitted_at', 'is not', null)
    .where('cases.submitted_at', '>=', range.from)
    .where('cases.submitted_at', '<', range.to);

  if (definitionId) {
    query = query.where('cases.definition_id', '=', definitionId);
  }

  const rows = await query
    .groupBy(['case_tasks.step_key', 'case_tasks.step_name'])
    .having(sql`count(*)`, '>=', SUPPRESS_BELOW)
    .execute();

  return rows.map((row) => ({
    stepKey: row.stepKey,
    stepName: row.stepName,
    rejectedCount: Number(row.rejectedCount),
  }));
}

export interface EscalationAndReturnRates {
  escalationRate: number | null;
  returnRate: number | null;
}

// PRD.md §17.1: "proportion of tasks escalating at least once" and
// "proportion returned to requester at least once." Both computed over
// cases (not tasks), since a case either had an escalation/return
// somewhere in it or it did not; a case with two escalated tasks still
// only counts once.
export async function findEscalationAndReturnRates(
  trx: Transaction<Database>,
  range: ReportDateRange,
  definitionId?: string,
): Promise<EscalationAndReturnRates> {
  let query = trx
    .selectFrom('cases')
    .select([
      sql<string>`count(*)`.as('total'),
      sql<string>`count(*) filter (
        where exists (
          select 1 from case_tasks
          where case_tasks.case_id = cases.case_id and case_tasks.escalation_level > 0
        )
      )`.as('escalated'),
      sql<string>`count(*) filter (
        where exists (
          select 1 from case_tasks
          where case_tasks.case_id = cases.case_id and case_tasks.decision = 'returned'
        )
      )`.as('returned'),
    ])
    .where('organisation_id', '=', range.organisationId)
    .where('submitted_at', 'is not', null)
    .where('submitted_at', '>=', range.from)
    .where('submitted_at', '<', range.to);

  if (definitionId) {
    query = query.where('definition_id', '=', definitionId);
  }

  const row = await query.executeTakeFirstOrThrow();
  const total = Number(row.total);

  return {
    escalationRate: total > 0 ? Number(row.escalated) / total : null,
    returnRate: total > 0 ? Number(row.returned) / total : null,
  };
}

export interface ApproverLoadRow {
  approverUserId: string;
  approverName: string;
  tasksHandled: number;
  medianHours: number;
}

// PRD.md §17.1 approver load: individual-level, so this is permission-
// gated at the route (apps/api/src/routes/reports.ts, isAdministrator) and
// suppressed below five completed tasks here, never filtered after the
// fact.
export async function findApproverLoad(
  trx: Transaction<Database>,
  range: ReportDateRange,
): Promise<ApproverLoadRow[]> {
  const rows = await trx
    .selectFrom('case_tasks')
    .innerJoin('users', 'users.user_id', 'case_tasks.completed_by_user_id')
    .select([
      'case_tasks.completed_by_user_id as approverUserId',
      'users.display_name as approverName',
    ])
    .select(sql<string>`count(*)`.as('tasksHandled'))
    .select(
      sql<number>`percentile_cont(0.5) within group (
        order by extract(epoch from (case_tasks.completed_at - case_tasks.created_at)) / 3600.0
      )`.as('medianHours'),
    )
    .where('case_tasks.organisation_id', '=', range.organisationId)
    .where('case_tasks.status', '=', 'completed')
    .where('case_tasks.completed_at', 'is not', null)
    .where('case_tasks.completed_at', '>=', range.from)
    .where('case_tasks.completed_at', '<', range.to)
    .groupBy(['case_tasks.completed_by_user_id', 'users.display_name'])
    .having(sql`count(*)`, '>=', SUPPRESS_BELOW)
    .execute();

  return rows.map((row) => ({
    // The inner join on users.user_id = case_tasks.completed_by_user_id
    // cannot match a null completed_by_user_id, so this is non-null for
    // every row that reaches here even though the column itself is
    // nullable.
    approverUserId: row.approverUserId!,
    approverName: row.approverName,
    tasksHandled: Number(row.tasksHandled),
    medianHours: Number(row.medianHours),
  }));
}
