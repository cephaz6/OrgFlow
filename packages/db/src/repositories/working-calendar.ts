import type { WorkingCalendar } from '@orgflow/types';
import type { Transaction } from 'kysely';
import { sql } from 'kysely';

import type { Database } from '../schema.js';
import { generateId } from '../uuid.js';

// PRD.md §15.1, ADR-0044. Both tables are ordinary tenant tables, so no
// query here names organisation_id: RLS decides which rows exist.

export interface Holiday {
  holidayId: string;
  date: string;
  name: string;
}

export interface OrganisationCalendar {
  timeZone: string;
  workdays: number[];
  startMinute: number;
  endMinute: number;
  holidays: Holiday[];
}

// Null when this organisation has never configured one, which the caller
// turns into the engine's documented default rather than inventing a row.
// Returning null rather than the default here keeps "not configured"
// distinguishable from "configured to the same values as the default",
// which is what the settings screen needs in order to say which it is.
export async function findOrganisationCalendar(
  trx: Transaction<Database>,
): Promise<OrganisationCalendar | null> {
  const [calendar, holidays] = await Promise.all([
    trx
      .selectFrom('organisation_calendars')
      .select(['time_zone', 'workdays', 'start_minute', 'end_minute'])
      .executeTakeFirst(),
    trx
      .selectFrom('organisation_holidays')
      .select(['holiday_id', 'holiday_date', 'name'])
      .orderBy('holiday_date', 'asc')
      .execute(),
  ]);

  if (!calendar) {
    return null;
  }

  return {
    timeZone: calendar.time_zone,
    workdays: calendar.workdays,
    startMinute: calendar.start_minute,
    endMinute: calendar.end_minute,
    holidays: holidays.map((row) => ({
      holidayId: row.holiday_id,
      date: row.holiday_date,
      name: row.name,
    })),
  };
}

// What the engine takes. Holidays are read even when no calendar row
// exists, so an organisation that has only added bank holidays still gets
// them applied against the default working week rather than silently
// ignored.
export async function resolveWorkingCalendar(
  trx: Transaction<Database>,
  fallback: WorkingCalendar,
): Promise<WorkingCalendar> {
  const configured = await findOrganisationCalendar(trx);
  const holidays = configured
    ? configured.holidays.map((holiday) => holiday.date)
    : (await trx.selectFrom('organisation_holidays').select('holiday_date').execute()).map(
        (row) => row.holiday_date,
      );

  if (!configured) {
    return { ...fallback, holidays };
  }

  return {
    timeZone: configured.timeZone,
    workdays: configured.workdays,
    startMinute: configured.startMinute,
    endMinute: configured.endMinute,
    holidays,
  };
}

export interface UpsertCalendarInput {
  organisationId: string;
  timeZone: string;
  workdays: number[];
  startMinute: number;
  endMinute: number;
}

export async function upsertOrganisationCalendar(
  trx: Transaction<Database>,
  input: UpsertCalendarInput,
): Promise<void> {
  await trx
    .insertInto('organisation_calendars')
    .values({
      organisation_id: input.organisationId,
      time_zone: input.timeZone,
      workdays: input.workdays,
      start_minute: input.startMinute,
      end_minute: input.endMinute,
    })
    .onConflict((oc) =>
      oc.column('organisation_id').doUpdateSet({
        time_zone: input.timeZone,
        workdays: input.workdays,
        start_minute: input.startMinute,
        end_minute: input.endMinute,
        updated_at: sql`now()`,
      }),
    )
    .execute();
}

export interface AddHolidayInput {
  organisationId: string;
  date: string;
  name: string;
}

// Upsert on the date, so adding the same day twice renames it rather than
// failing on the unique constraint. Somebody correcting a typo should not
// have to delete first.
export async function addHoliday(
  trx: Transaction<Database>,
  input: AddHolidayInput,
): Promise<string> {
  const holidayId = generateId();

  const row = await trx
    .insertInto('organisation_holidays')
    .values({
      holiday_id: holidayId,
      organisation_id: input.organisationId,
      holiday_date: input.date,
      name: input.name,
    })
    .onConflict((oc) =>
      oc.columns(['organisation_id', 'holiday_date']).doUpdateSet({ name: input.name }),
    )
    .returning('holiday_id')
    .executeTakeFirst();

  return row?.holiday_id ?? holidayId;
}

export async function removeHoliday(
  trx: Transaction<Database>,
  holidayId: string,
): Promise<boolean> {
  const result = await trx
    .deleteFrom('organisation_holidays')
    .where('holiday_id', '=', holidayId)
    .executeTakeFirst();

  return Number(result.numDeletedRows) > 0;
}
