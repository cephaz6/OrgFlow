import { v7 as uuidv7 } from 'uuid';

// ADR-0003: primary keys are generated here, in the application layer, and
// passed into inserts explicitly, never left to a column default.
export function generateId(): string {
  return uuidv7();
}
