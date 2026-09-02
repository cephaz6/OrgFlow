// Mirrors apps/api/src/routes/working-calendar.ts.
export interface Holiday {
  holidayId: string;
  date: string;
  name: string;
}

export interface WorkingCalendarSettings {
  timeZone: string;
  workdays: number[];
  startMinute: number;
  endMinute: number;
  holidays: Holiday[];
}

export interface WorkingCalendarResponse {
  // True while the organisation has configured nothing and is running on
  // the engine's default. Worth distinguishing on screen from having
  // deliberately chosen the same values.
  isDefault: boolean;
  calendar: WorkingCalendarSettings;
}

export interface SaveWorkingCalendarBody {
  timeZone: string;
  workdays: number[];
  startMinute: number;
  endMinute: number;
}
