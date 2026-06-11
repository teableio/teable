import type { ManipulateType, UnitType } from 'dayjs';
import dayjs, { isDayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import isBetween from 'dayjs/plugin/isBetween';
import relativeTime from 'dayjs/plugin/relativeTime';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { isNumber, isString } from 'lodash';
import { CellValueType } from '../../models/field/constant';
import type { TypedValue } from '../typed-value';
import type { IFormulaContext } from './common';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';
import { FormulaBaseError } from './logical';

dayjs.extend(relativeTime);
dayjs.extend(weekOfYear);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

export { dayjs };

abstract class DateTimeFunc extends FormulaFunc {
  readonly type = FormulaFuncType.DateTime;
}

const unitSet = new Set<ManipulateType>([
  'millisecond',
  'second',
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'year',
  'ms',
  's',
  'm',
  'h',
  'd',
  'w',
  'M',
  'y',
]);

const getUnit = (unit?: string) => {
  const unitStr = unit as ManipulateType;
  if (unitSet.has(unitStr)) return unitStr;
  return 'second';
};

const dateOnlyFormat = 'YYYY-MM-DD';

function isISODateString(dateString: string) {
  const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  return isoDatePattern.test(dateString);
}

const normalizeDateTimeParseInput = (isoStr: string) =>
  isoStr.trim().replace(/\//g, '-').replace('T', ' ');

const inferDateTimeParseFormat = (isoStr: string) => {
  if (!/^\d{4}-\d{1,2}-\d{1,2}(?: \d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d{1,3})?)?)?$/.test(isoStr)) {
    return null;
  }

  const timePart = isoStr.split(' ')[1];
  if (!timePart) return 'YYYY-M-D';

  const timeSegments = timePart.split(':');
  if (timeSegments.length < 2 || timeSegments.length > 3) return null;
  if (!/^\d{1,2}$/.test(timeSegments[0]) || !/^\d{1,2}$/.test(timeSegments[1])) return null;
  if (timeSegments.length === 2) return 'YYYY-M-D H:m';

  const [second, fractional] = timeSegments[2].split('.');
  if (!/^\d{1,2}$/.test(second)) return null;

  if (!fractional) return 'YYYY-M-D H:m:s';
  const msToken = 'S'.repeat(Math.max(1, Math.min(3, fractional.length)));
  return `YYYY-M-D H:m:s.${msToken}`;
};

export const getDayjs = (isoStr: string | null, timeZone: string, customFormat?: string) => {
  if (isoStr == null) return null;
  if (isDayjs(isoStr)) return isoStr;
  if (!isString(isoStr)) throw new FormulaBaseError();

  let date;
  if (customFormat) {
    // For custom format, assume it's in the specified timezone
    date = dayjs.tz(isoStr, customFormat, timeZone);
  } else if (isISODateString(isoStr)) {
    // If it's a valid ISO string, convert to the specified timezone
    date = dayjs(isoStr).tz(timeZone);
  } else {
    // For other formats (including local date-time text), interpret as local time in target timezone.
    const normalizedInput = normalizeDateTimeParseInput(isoStr);
    const format = inferDateTimeParseFormat(normalizedInput);
    date = format
      ? dayjs.tz(normalizedInput, format, timeZone)
      : dayjs.tz(normalizedInput, timeZone);
  }

  if (!date.isValid()) throw new FormulaBaseError();
  return date;
};

const normalizeToCalendarDate = (date: dayjs.Dayjs, timeZone: string) =>
  dayjs.tz(date.format(dateOnlyFormat), dateOnlyFormat, timeZone);

export class Today extends DateTimeFunc {
  name = FunctionName.Today;

  acceptValueType = new Set([]);

  acceptMultipleValue = false;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
  validateParams(_params: TypedValue[]) {}

  getReturnType() {
    return { type: CellValueType.DateTime };
  }

  eval(_params: TypedValue[], context: IFormulaContext): string | null {
    return dayjs().tz(context.timeZone).startOf('d').toISOString();
  }
}

export class Now extends DateTimeFunc {
  name = FunctionName.Now;

  acceptValueType = new Set([]);

  acceptMultipleValue = false;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
  validateParams(_params: TypedValue[]) {}

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.DateTime };
  }

  eval(_params: TypedValue[], context: IFormulaContext): string | null {
    return dayjs().tz(context.timeZone).toISOString();
  }
}

export class Year extends DateTimeFunc {
  name = FunctionName.Year;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Year} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): number | null {
    const value = params[0].value;
    return getDayjs(value, context.timeZone)?.year() ?? null;
  }
}

export class Month extends DateTimeFunc {
  name = FunctionName.Month;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Month} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): number | null {
    const value = params[0].value;
    const month = getDayjs(value, context.timeZone)?.month() ?? null;
    return isNumber(month) ? month + 1 : null;
  }
}

export class WeekNum extends DateTimeFunc {
  name = FunctionName.WeekNum;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.WeekNum} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): number | null {
    const value = params[0].value;
    return getDayjs(value, context.timeZone)?.week() ?? null;
  }
}

export class Weekday extends DateTimeFunc {
  name = FunctionName.Weekday;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      throw new Error(`${FunctionName.Weekday} needs at least 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): number | null {
    const value = params[0].value;
    const startDayOfWeek = params[1]?.value ?? 'sunday';
    const currentDate = getDayjs(value, context.timeZone);
    if (currentDate == null) return null;
    const weekday = currentDate.day();
    if (startDayOfWeek.toLowerCase() === 'monday') {
      return weekday === 0 ? 6 : weekday - 1;
    }
    return weekday;
  }
}

export class Day extends DateTimeFunc {
  name = FunctionName.Day;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Day} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): number | null {
    const value = params[0].value;
    return getDayjs(value, context.timeZone)?.date() ?? null;
  }
}

export class Hour extends DateTimeFunc {
  name = FunctionName.Hour;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Hour} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): number | null {
    const value = params[0].value;
    return getDayjs(value, context.timeZone)?.hour() ?? null;
  }
}

export class Minute extends DateTimeFunc {
  name = FunctionName.Minute;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Minute} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): number | null {
    const value = params[0].value;
    return getDayjs(value, context.timeZone)?.minute() ?? null;
  }
}

export class Second extends DateTimeFunc {
  name = FunctionName.Second;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Second} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): number | null {
    const value = params[0].value;
    return getDayjs(value, context.timeZone)?.second() ?? null;
  }
}

export class FromNow extends DateTimeFunc {
  name = FunctionName.FromNow;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String, CellValueType.Boolean]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length < 2) {
      throw new Error(`${FunctionName.FromNow} needs at least 2 params`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<string | boolean | null>[], context: IFormulaContext): number | null {
    const targetDate = getDayjs(params[0].value as string, context.timeZone);
    const unit = (params[1]?.value ?? 'd') as UnitType;
    const isFloat = Boolean(params[2]?.value ?? false);
    const diffCount = dayjs().diff(targetDate, unit, isFloat);
    return isNumber(diffCount) ? Math.abs(diffCount) : null;
  }
}

export class ToNow extends FromNow {
  name = FunctionName.ToNow;

  validateParams(params: TypedValue[]) {
    if (params.length < 2) {
      throw new Error(`${FunctionName.ToNow} needs at least 2 params`);
    }
  }
}

export class DatetimeDiff extends DateTimeFunc {
  name = FunctionName.DatetimeDiff;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String, CellValueType.Boolean]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length < 2) {
      throw new Error(`${FunctionName.DatetimeDiff} needs at least 2 params`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<string | boolean | null>[], context: IFormulaContext): number | null {
    const startDate = getDayjs(params[0].value as string, context.timeZone);
    const endDate = getDayjs(params[1].value as string, context.timeZone);
    const unit = (params[2]?.value ?? 'second') as UnitType;
    const isFloat = Boolean(params[3]?.value ?? false);
    if (startDate == null || endDate == null) return null;
    const diffCount = startDate.diff(endDate, unit, isFloat);
    return isNumber(diffCount) ? diffCount : null;
  }
}

export class Workday extends DateTimeFunc {
  name = FunctionName.Workday;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length < 2) {
      throw new Error(`${FunctionName.Workday} needs at least 2 params`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.DateTime };
  }

  eval(params: TypedValue<string | number | null>[], context: IFormulaContext): string | null {
    const startDate = getDayjs(params[0].value as string, context.timeZone);

    if (startDate == null) return null;

    const count = Number(params[1].value ?? 0);
    const holidayStr = params[2]?.value;
    const holidays = (
      isString(holidayStr)
        ? holidayStr
            .split(',')
            .map((str) => getDayjs(str.trim(), context.timeZone))
            .filter(Boolean)
        : []
    ) as dayjs.Dayjs[];
    const unit = 'day';
    const efficientSign = count > 0 ? 1 : -1;
    const weeks = Math.floor(count / 5);
    const extraDays = count % 5;
    let targetDate = startDate.add(weeks * 7, unit);

    for (let i = 0; i < extraDays; ) {
      targetDate = targetDate.add(efficientSign, unit);
      const holidayIndex = holidays.findIndex((holiday) => holiday.isSame(targetDate, unit));
      if (holidayIndex > -1) holidays.splice(holidayIndex);
      if (targetDate.day() !== 0 && targetDate.day() !== 6 && holidayIndex === -1) {
        i++;
      }
    }

    let daysToAdjust = holidays.filter((date) => {
      return date.isBetween(startDate, targetDate, 'day', '[]') && ![0, 6].includes(date.day());
    }).length;

    while (daysToAdjust > 0) {
      targetDate = targetDate.add(efficientSign, unit);
      if (
        targetDate.day() !== 0 &&
        targetDate.day() !== 6 &&
        !holidays.some((holiday) => holiday.isSame(targetDate, unit))
      ) {
        daysToAdjust--;
      }
    }

    return targetDate.toISOString();
  }
}

export class WorkdayDiff extends DateTimeFunc {
  name = FunctionName.WorkdayDiff;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length < 2) {
      throw new Error(`${FunctionName.WorkdayDiff} needs at least 2 params`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<string | number | null>[], context: IFormulaContext): number | null {
    const startDate = getDayjs(params[0].value as string, context.timeZone);
    const endDate = getDayjs(params[1].value as string, context.timeZone);

    if (startDate == null || endDate == null) return null;

    const holidayStr = params[2]?.value;
    const holidays = (
      isString(holidayStr)
        ? holidayStr
            .split(',')
            .map((str) => getDayjs(str.trim(), context.timeZone))
            .filter((date): date is dayjs.Dayjs => date != null)
            .map((date) => normalizeToCalendarDate(date, context.timeZone))
        : []
    ) as dayjs.Dayjs[];

    const normalizedStartDate = normalizeToCalendarDate(startDate, context.timeZone);
    const normalizedEndDate = normalizeToCalendarDate(endDate, context.timeZone);
    const isForward =
      normalizedEndDate.isSame(normalizedStartDate, 'day') ||
      normalizedEndDate.isAfter(normalizedStartDate, 'day');
    const minDate = isForward ? normalizedStartDate : normalizedEndDate;
    const maxDate = isForward ? normalizedEndDate : normalizedStartDate;
    let currentDay = minDate.add(1, 'day');
    let count = 0;

    while (currentDay.isSame(maxDate, 'day') || currentDay.isBefore(maxDate, 'day')) {
      const isWeekend = currentDay.day() === 0 || currentDay.day() === 6;
      const isHoliday = holidays.some((holiday) => holiday.isSame(currentDay, 'day'));

      if (!isWeekend && !isHoliday) {
        count++;
      }

      currentDay = currentDay.add(1, 'day');
    }

    return isForward ? count : -count;
  }
}

export class IsSame extends DateTimeFunc {
  name = FunctionName.IsSame;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length < 2) {
      throw new Error(`${FunctionName.IsSame} needs at least 2 params`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Boolean };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): boolean | null {
    const date1 = getDayjs(params[0].value as string, context.timeZone);
    const date2 = getDayjs(params[1].value as string, context.timeZone);

    if (date1 == null || date2 == null) return null;

    const unit = (params[2]?.value ?? 'd') as UnitType;
    return date1.isSame(date2, unit);
  }
}

export class IsAfter extends DateTimeFunc {
  name = FunctionName.IsAfter;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length < 2) {
      throw new Error(`${FunctionName.IsAfter} needs at least 2 params`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Boolean };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): boolean | null {
    const date1 = getDayjs(params[0].value as string, context.timeZone);
    const date2 = getDayjs(params[1].value as string, context.timeZone);

    if (date1 == null || date2 == null) return null;

    const unit = (params[2]?.value ?? 'd') as UnitType;
    return date1.isAfter(date2, unit);
  }
}

export class IsBefore extends DateTimeFunc {
  name = FunctionName.IsBefore;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length < 2) {
      throw new Error(`${FunctionName.IsBefore} needs at least 2 params`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Boolean };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): boolean | null {
    const date1 = getDayjs(params[0].value as string, context.timeZone);
    const date2 = getDayjs(params[1].value as string, context.timeZone);

    if (date1 == null || date2 == null) return null;

    const unit = (params[2]?.value ?? 'd') as UnitType;
    return date1.isBefore(date2, unit);
  }
}

export class DateAdd extends DateTimeFunc {
  name = FunctionName.DateAdd;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length < 3) {
      throw new Error(`${FunctionName.DateAdd} needs at least 3 params`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.DateTime };
  }

  eval(params: TypedValue<string | number | null>[], context: IFormulaContext): string | null {
    const date = getDayjs(params[0].value as string, context.timeZone);

    if (date == null) return null;

    const count = Number(params[1].value ?? 0);
    const unit = getUnit(params[2].value as string);
    return date.add(Number(count), unit).toISOString();
  }
}

export class Datestr extends DateTimeFunc {
  name = FunctionName.Datestr;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Datestr} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): string | null {
    const date = getDayjs(params[0].value as string, context.timeZone);

    if (date == null) return null;

    return date.format(dateOnlyFormat);
  }
}

export class Timestr extends DateTimeFunc {
  name = FunctionName.Timestr;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Timestr} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): string | null {
    const date = getDayjs(params[0].value as string, context.timeZone);

    if (date == null) return null;

    return date.format('HH:mm:ss');
  }
}

export class DatetimeFormat extends DateTimeFunc {
  name = FunctionName.DatetimeFormat;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      throw new Error(`${FunctionName.DatetimeFormat} needs at least 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): string | null {
    const date = getDayjs(params[0].value as string, context.timeZone);

    if (date == null) return null;

    const formatString = String(params[1]?.value || 'YYYY-MM-DD HH:mm');
    return date.format(formatString);
  }
}

export class DatetimeParse extends DateTimeFunc {
  name = FunctionName.DatetimeParse;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      throw new Error(`${FunctionName.DatetimeParse} needs at least 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.DateTime };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): string | null {
    const format = params[1]?.value as string | undefined;

    if (params[0].type === CellValueType.DateTime && format) {
      const sourceDate = getDayjs(params[0].value, context.timeZone);
      if (sourceDate == null) {
        return null;
      }

      const reparsedDate = getDayjs(sourceDate.format(format), context.timeZone, format);
      return reparsedDate?.toISOString() ?? null;
    }

    const date = getDayjs(params[0].value, context.timeZone, format);

    if (date == null) return null;
    return date.toISOString();
  }
}

export class CreatedTime extends DateTimeFunc {
  name = FunctionName.CreatedTime;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  validateParams() {}

  getReturnType() {
    return { type: CellValueType.DateTime };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): string | null {
    return context.record.createdTime ?? null;
  }
}

export class LastModifiedTime extends DateTimeFunc {
  name = FunctionName.LastModifiedTime;

  acceptValueType = new Set([
    CellValueType.String,
    CellValueType.Number,
    CellValueType.Boolean,
    CellValueType.DateTime,
  ]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]): void {
    if (!params.length) return;
    if (params.some((param) => !param?.field)) {
      throw new Error(`${FunctionName.LastModifiedTime} parameter must be a field reference`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.DateTime };
  }

  eval(params: TypedValue<string | null>[], context: IFormulaContext): string | null {
    this.validateParams(params);
    return context.record.lastModifiedTime ?? null;
  }
}
