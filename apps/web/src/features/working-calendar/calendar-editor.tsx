'use client';

import { Alert, Button, Input, Label, Select } from '@orgflow/ui';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';

import { addHoliday, removeHoliday, saveWorkingCalendar } from './api-client';
import type { Holiday, WorkingCalendarResponse } from './types';

export interface CalendarEditorProps {
  initial: WorkingCalendarResponse;
  canEdit: boolean;
}

// Sunday first, matching the 0-6 the engine and the database both use, so
// nothing has to be renumbered on the way in or out.
const DAYS = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
];

// A short list rather than every zone the runtime knows: several hundred
// options in a select is not a choice anybody can make. The API accepts any
// name Intl understands, so this is the common set, not the limit.
const TIME_ZONES = [
  'UTC',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

function toTimeInput(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  const rest = String(minutes % 60).padStart(2, '0');
  return `${hours}:${rest}`;
}

function fromTimeInput(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

// The number an SLA of "16 hours" actually means under this calendar, shown
// because "16 hours" reads as two days to most people and is two working
// days here only if the day is eight hours long. Stating it removes the
// arithmetic somebody would otherwise have to do in their head.
function describeWorkingWeek(workdays: number[], startMinute: number, endMinute: number): string {
  const hoursPerDay = (endMinute - startMinute) / 60;
  const perWeek = hoursPerDay * workdays.length;
  const rounded = Math.round(hoursPerDay * 10) / 10;
  return `${rounded} hours a day, ${Math.round(perWeek * 10) / 10} a week. An SLA of ${Math.round(
    perWeek,
  )} hours is one working week.`;
}

type Phase =
  { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; message: string };

export function CalendarEditor({ initial, canEdit }: CalendarEditorProps) {
  const idPrefix = useId();
  const [timeZone, setTimeZone] = useState(initial.calendar.timeZone);
  const [workdays, setWorkdays] = useState<number[]>(initial.calendar.workdays);
  // The raw "HH:MM" strings, not parsed minutes. A controlled input whose
  // state only updates when the value happens to parse will silently ignore
  // an intermediate one, and then the box shows what was typed while the
  // component believes something else entirely. Holding the string keeps
  // the field honest and makes "not a time yet" a state that can be shown
  // rather than swallowed.
  const [startValue, setStartValue] = useState(toTimeInput(initial.calendar.startMinute));
  const [endValue, setEndValue] = useState(toTimeInput(initial.calendar.endMinute));
  const startMinute = fromTimeInput(startValue);
  const endMinute = fromTimeInput(endValue);
  const [holidays, setHolidays] = useState<Holiday[]>(initial.calendar.holidays);
  const [isDefault, setIsDefault] = useState(initial.isDefault);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');

  const timesParse = startMinute !== null && endMinute !== null;
  const dayLengthValid = timesParse && endMinute > startMinute;
  const canSave = canEdit && workdays.length > 0 && dayLengthValid && phase.kind !== 'saving';

  function toggleDay(day: number, on: boolean) {
    setWorkdays((current) =>
      on ? [...current, day].sort((a, b) => a - b) : current.filter((value) => value !== day),
    );
    setPhase({ kind: 'idle' });
  }

  async function save() {
    setPhase({ kind: 'saving' });
    try {
      if (startMinute === null || endMinute === null) {
        return;
      }
      await saveWorkingCalendar({ timeZone, workdays, startMinute, endMinute });
      setIsDefault(false);
      setPhase({ kind: 'saved' });
    } catch (err) {
      setPhase({
        kind: 'failed',
        message: err instanceof Error ? err.message : 'The calendar could not be saved.',
      });
    }
  }

  async function handleAddHoliday() {
    try {
      const added = await addHoliday({ date: holidayDate, name: holidayName });
      setHolidays((current) =>
        [...current.filter((holiday) => holiday.date !== added.date), added].sort((a, b) =>
          a.date.localeCompare(b.date),
        ),
      );
      setHolidayDate('');
      setHolidayName('');
      setPhase({ kind: 'idle' });
    } catch (err) {
      setPhase({
        kind: 'failed',
        message: err instanceof Error ? err.message : 'That day could not be added.',
      });
    }
  }

  async function handleRemoveHoliday(holidayId: string) {
    try {
      await removeHoliday(holidayId);
      setHolidays((current) => current.filter((holiday) => holiday.holidayId !== holidayId));
    } catch (err) {
      setPhase({
        kind: 'failed',
        message: err instanceof Error ? err.message : 'That day could not be removed.',
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div aria-live="polite">
        {phase.kind === 'failed' ? <Alert variant="destructive">{phase.message}</Alert> : null}
        {phase.kind === 'saved' ? (
          <Alert>
            Saved. New requests will use this calendar. Deadlines already given out do not move.
          </Alert>
        ) : null}
      </div>

      {isDefault ? (
        <Alert>
          Nothing is configured yet, so deadlines use the default: Monday to Friday, 09:00 to 17:00,
          UTC, with no holidays.
        </Alert>
      ) : null}

      <fieldset disabled={!canEdit} className="flex flex-col gap-6 border-0 p-0">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-timezone`}>Time zone</Label>
            <Select
              id={`${idPrefix}-timezone`}
              value={timeZone}
              onChange={(event) => {
                setTimeZone(event.target.value);
                setPhase({ kind: 'idle' });
              }}
            >
              {/* A configured zone outside the short list still shows,
                  rather than silently switching to the first option. */}
              {(TIME_ZONES.includes(timeZone) ? TIME_ZONES : [timeZone, ...TIME_ZONES]).map(
                (zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ),
              )}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-start`}>Working day starts</Label>
            <Input
              id={`${idPrefix}-start`}
              type="time"
              value={startValue}
              onChange={(event) => {
                setStartValue(event.target.value);
                setPhase({ kind: 'idle' });
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-end`}>Working day ends</Label>
            <Input
              id={`${idPrefix}-end`}
              type="time"
              value={endValue}
              aria-invalid={dayLengthValid ? undefined : true}
              aria-describedby={dayLengthValid ? undefined : `${idPrefix}-end-error`}
              onChange={(event) => {
                setEndValue(event.target.value);
                setPhase({ kind: 'idle' });
              }}
            />
            {dayLengthValid ? null : (
              <p
                id={`${idPrefix}-end-error`}
                role="alert"
                className="text-sm text-destructive-subtle-foreground"
              >
                {timesParse
                  ? 'The working day has to end after it starts.'
                  : 'Enter both times as HH:MM.'}
              </p>
            )}
          </div>
        </div>

        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="text-sm font-medium">Working days</legend>
          <div className="flex flex-wrap gap-3">
            {DAYS.map((day) => (
              <label key={day.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={workdays.includes(day.value)}
                  onChange={(event) => toggleDay(day.value, event.target.checked)}
                />
                {day.label}
              </label>
            ))}
          </div>
          {workdays.length === 0 ? (
            <p role="alert" className="text-sm text-destructive-subtle-foreground">
              Choose at least one working day, or no request could ever fall due.
            </p>
          ) : dayLengthValid ? (
            <p className="text-sm text-muted-foreground">
              {describeWorkingWeek(workdays, startMinute, endMinute)}
            </p>
          ) : null}
        </fieldset>

        {canEdit ? (
          <div>
            <Button type="button" disabled={!canSave} onClick={() => void save()}>
              {phase.kind === 'saving' ? 'Saving...' : 'Save working week'}
            </Button>
          </div>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-3 border-t border-divider pt-6">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarDays aria-hidden="true" className="h-4 w-4" />
            Holidays
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Days nobody is expected to work. A deadline never falls on one, and time spent on one
            does not count towards an SLA.
          </p>
        </div>

        {holidays.length === 0 ? (
          <p className="text-sm text-muted-foreground">No holidays yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {holidays.map((holiday) => (
              <li
                key={holiday.holidayId}
                className="flex items-center justify-between gap-3 rounded-md border border-divider p-3"
              >
                <span className="text-sm">
                  <span className="font-medium">{holiday.date}</span>
                  <span className="text-muted-foreground"> · {holiday.name}</span>
                </span>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${holiday.name} on ${holiday.date}`}
                    onClick={() => void handleRemoveHoliday(holiday.holidayId)}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-holiday-date`}>Date</Label>
              <Input
                id={`${idPrefix}-holiday-date`}
                type="date"
                value={holidayDate}
                onChange={(event) => setHolidayDate(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-holiday-name`}>What it is</Label>
              <Input
                id={`${idPrefix}-holiday-name`}
                value={holidayName}
                placeholder="For example, Christmas Day"
                onChange={(event) => setHolidayName(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={holidayDate.length === 0 || holidayName.trim().length === 0}
              onClick={() => void handleAddHoliday()}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Add holiday
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
