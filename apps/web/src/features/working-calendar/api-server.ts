import { apiGet } from '../../lib/api-server';
import type { WorkingCalendarResponse } from './types';

export async function fetchWorkingCalendar(): Promise<WorkingCalendarResponse> {
  return apiGet<WorkingCalendarResponse>('/working-calendar');
}
