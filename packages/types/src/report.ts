import type { IsoDateTimeString, Uuid } from './common.js';

export type ReportBucket = 'day' | 'week' | 'month';

export interface VolumeBucket {
  periodStart: IsoDateTimeString;
  definitionId: Uuid;
  definitionName: string;
  count: number;
}

export interface OverviewReport {
  from: IsoDateTimeString;
  to: IsoDateTimeString;
  bucket: ReportBucket;
  volume: VolumeBucket[];
  // Null when the denominator is zero (no terminal cases in range yet),
  // never coerced to 0, which would misreport "nothing has happened" as
  // "everything failed."
  completionRate: number | null;
  medianTurnaroundHours: number | null;
  p90TurnaroundHours: number | null;
}

export interface StepDuration {
  stepKey: string;
  stepName: string;
  meanDurationHours: number;
  medianDurationHours: number;
  sampleSize: number;
}

export interface BottleneckEntry extends StepDuration {
  definitionId: Uuid;
  definitionName: string;
}

export interface RejectionReasonGroup {
  stepKey: string;
  stepName: string;
  rejectedCount: number;
}

export interface DefinitionReport {
  definitionId: Uuid;
  definitionName: string;
  from: IsoDateTimeString;
  to: IsoDateTimeString;
  volume: number;
  completionRate: number | null;
  medianTurnaroundHours: number | null;
  p90TurnaroundHours: number | null;
  escalationRate: number | null;
  returnRate: number | null;
  // Rows with fewer than five samples are never returned (suppressed at
  // the query, PRD.md §17.2), so slowestStep can legitimately be null even
  // when the definition has real volume.
  steps: StepDuration[];
  slowestStep: StepDuration | null;
  rejectionReasons: RejectionReasonGroup[];
}

// PRD.md §17.1: tasks handled and median turnaround per approver.
// Individual-level, so this is permission-gated at the route
// (apps/api/src/routes/reports.ts) and suppressed below five at the query
// (packages/db/src/repositories/reports.ts), never filtered after the
// fact.
export interface ApproverLoadEntry {
  approverUserId: Uuid;
  approverName: string;
  tasksHandled: number;
  medianTurnaroundHours: number;
}
