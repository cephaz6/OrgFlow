// PRD.md §15.1's working calendar: the organisation configuration a
// business-hours SLA is measured against. It lives here rather than in
// packages/core because EvaluationContext carries it, and the engine
// resolves nothing for itself.
export interface WorkingCalendar {
  // IANA name, for example 'Europe/London'.
  timeZone: string;
  // Days of the week that are worked, 0 = Sunday through 6 = Saturday.
  workdays: readonly number[];
  // Minutes from midnight, local to timeZone. 09:00 is 540.
  startMinute: number;
  endMinute: number;
  // 'YYYY-MM-DD' in the organisation's own timezone, not UTC: a holiday is
  // a date somebody wrote on a wall planner, not an instant.
  holidays: readonly string[];
}
