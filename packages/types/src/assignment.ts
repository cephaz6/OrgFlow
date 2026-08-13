import type { Uuid } from './common.js';

export type AssignmentStrategy =
  | { strategy: 'specificUser'; userId: Uuid }
  | { strategy: 'role'; role: string }
  | { strategy: 'lineManager' }
  | { strategy: 'lineManagerOfAssignee' }
  | { strategy: 'submitter' }
  | { strategy: 'group'; groupKey: string }
  | { strategy: 'fieldReference'; fieldKey: string };
