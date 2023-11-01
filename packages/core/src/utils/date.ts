import type { ManipulateType } from 'dayjs';
import dayjs, { extend } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

extend(utc);
extend(timezone);

export class DateUtil {
  public static readonly NORM_YEAR_PATTERN = 'YYYY';
  public static readonly NORM_MONTH_PATTERN = 'YYYY-MM';
  public static readonly NORM_DATE_PATTERN = 'YYYY-MM-DD';
  public static readonly NORM_DATETIME_MINUTE_PATTERN = 'YYYY-MM-DD HH:mm';
  public static readonly NORM_DATETIME_PATTERN = 'YYYY-MM-DD HH:mm:ss';
  public static readonly NORM_DATETIME_MS_PATTERN = 'YYYY-MM-DD HH:mm:ss.SSS';
  public static readonly UTC_SIMPLE_PATTERN = 'YYYY-MM-DDTHH:mm:ss';
  public static readonly UTC_SIMPLE_MS_PATTERN = 'YYYY-MM-DDTHH:mm:ss.SSS';
  public static readonly UTC_WITH_ZONE_OFFSET_PATTERN = 'YYYY-MM-DDTHH:mm:ssZ';
  public static readonly UTC_MS_WITH_ZONE_OFFSET_PATTERN = 'YYYY-MM-DDTHH:mm:ss.SSSZ';

  constructor(
    private readonly timeZone: string,
    private readonly useUTC = true
  ) {}

  /**
   * Current time
   *
   * @param date Date
   * @return Current time
   */
  date(date?: dayjs.ConfigType) {
    return (this.useUTC ? dayjs(date).utc() : dayjs(date)).tz(this.timeZone);
  }

  /**
   * Current time, in the format YYYY-MM-DD HH:mm:ss
   *
   * @return The current time in standard form string
   */
  now(): string {
    return this.date().format(DateUtil.NORM_DATETIME_PATTERN);
  }

  /**
   * Current date, in the format YYYY-MM-DD
   *
   * @return Standard form string of the current date
   */
  today(): string {
    return this.date().format(DateUtil.NORM_DATE_PATTERN);
  }

  /**
   * Offset days
   *
   * @param offset offset days, positive numbers offset to the future, negative numbers offset to history
   * @param date Date
   * @return offset date
   */
  offsetDay(offset: number, date = this.date()) {
    return this.offset('day', offset, date);
  }

  /**
   * Offset week
   *
   * @param offset offset week, positive number offset to future, negative number offset to history
   * @param date Date
   * @return offset date
   */
  offsetWeek(offset: number, date = this.date()) {
    return this.offset('week', offset, date);
  }

  /**
   * Offset month
   *
   * @param offset offset months, positive offset to the future, negative offset to history
   * @param date Date
   * @return offset date
   */
  offsetMonth(offset: number, date = this.date()) {
    return this.offset('month', offset, date);
  }

  /**
   * Get the time after the specified date offset from the specified time, the generated offset date does not affect the original date
   *
   * @param dateField The granularity size of the offset (hour, day, month, etc.) {@link ManipulateType}
   * @param offset offset, positive number is backward offset, negative number is forward offset
   * @param date the base date
   * @return offset date
   */
  offset(dateField: ManipulateType, offset: number, date = this.date()) {
    if (offset === 0) {
      return date;
    }
    return date[offset > 0 ? 'add' : 'subtract'](Math.abs(offset), dateField);
  }

  /**
   * Tomorrow
   *
   * @return Tomorrow
   */
  tomorrow() {
    return this.offsetDay(1);
  }

  /**
   * Yesterday
   *
   * @return yesterday
   */
  yesterday() {
    return this.offsetDay(-1);
  }

  /**
   * Last week
   *
   * @return Last week
   */
  lastWeek() {
    return this.offsetWeek(-1);
  }

  /**
   * Next week
   *
   * @return Next week
   */
  nextWeek() {
    return this.offsetWeek(1);
  }

  /**
   * Last month
   *
   * @return Last month
   */
  lastMonth() {
    return this.offsetMonth(-1);
  }

  /**
   * Next month
   *
   * @return Next month
   */
  nextMonth() {
    return this.offsetMonth(1);
  }
}
