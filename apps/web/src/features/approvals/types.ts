import type { CaseTask, FormField, WorkflowDecisionAction } from '@orgflow/types';

// The queue projection GET /tasks and GET /tasks/available return: the task
// row plus the case context a queue row needs, which PRD.md §13.2 lists as
// reference, process, requester, age and due.
export interface TaskQueueEntry extends CaseTask {
  caseReference: string;
  caseTitle: string;
  definitionId: string;
  requesterUserId: string;
  requesterName: string;
}

export interface TaskDetail {
  task: CaseTask;
  case: {
    caseId: string;
    reference: string;
    title: string;
    status: string;
    currentStepKey: string | null;
    submittedByUserId: string;
    submittedAt: string | null;
  };
  requester: {
    userId: string;
    displayName: string;
    email: string;
    department: string | null;
    lineManagerUserId: string | null;
  } | null;
  values: Record<string, unknown>;
  step: {
    key: string;
    name: string;
    type: string;
    instructions: string | null;
    allowedDecisions: WorkflowDecisionAction[];
    // Decisions the definition insists carry a comment. PRD.md §13.2: the
    // comment field is mandatory where the definition requires it, and the
    // definition is the only thing that knows which.
    requireCommentOn: WorkflowDecisionAction[];
    outputFields: FormField[];
  } | null;
  // Visibility and actionability are separate questions (PRD.md §12.3), so
  // a task can be readable and not decidable. The screen has to honour that
  // rather than assuming that being able to open it means being able to act.
  canAct: boolean;
}

export interface TaskQueuePage {
  data: TaskQueueEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}
