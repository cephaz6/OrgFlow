import { apiDelete, apiPost, apiPut } from '../../lib/api-client';
import type { Holiday, SaveWorkingCalendarBody } from './types';

export async function saveWorkingCalendar(body: SaveWorkingCalendarBody): Promise<void> {
  await apiPut('/working-calendar', body);
}

export async function addHoliday(body: { date: string; name: string }): Promise<Holiday> {
  const response = await apiPost<{ holiday: Holiday }>('/working-calendar/holidays', body);
  return response.holiday;
}

export async function removeHoliday(holidayId: string): Promise<void> {
  await apiDelete(`/working-calendar/holidays/${holidayId}`);
}
