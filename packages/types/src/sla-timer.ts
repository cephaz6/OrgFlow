import type { IsoDateTimeString, Uuid } from './common.js';
import type { TimerType } from './engine.js';

export type SlaTimerStatus = 'scheduled' | 'fired' | 'cancelled';

// PRD.md §2.4/§15.2: the durable record behind a timer the engine asked to
// be scheduled (see TimerSpec in engine.ts). schedule_name is unused today,
// since nothing local needs a real EventBridge Scheduler schedule name, but
// exists so a real one can be written there later without a schema change.
export interface SlaTimer {
  timerId: Uuid;
  organisationId: Uuid;
  caseId: Uuid;
  taskId: Uuid | null;
  scheduleName: string;
  timerType: TimerType;
  escalationLevel: number;
  fireAt: IsoDateTimeString;
  status: SlaTimerStatus;
  firedAt: IsoDateTimeString | null;
  createdAt: IsoDateTimeString;
}
