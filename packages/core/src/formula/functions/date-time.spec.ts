/* eslint-disable sonarjs/no-duplicate-string */
import type { IRecord } from '../../models';
import { CellValueType } from '../../models/field/constant';
import { TypedValue } from '../typed-value';
import {
  CreatedTime,
  DateAdd,
  Datestr,
  DatetimeDiff,
  DatetimeFormat,
  DatetimeParse,
  Day,
  FromNow,
  Hour,
  IsAfter,
  IsBefore,
  IsSame,
  LastModifiedTime,
  Minute,
  Month,
  Second,
  Timestr,
  Today,
  WeekNum,
  Weekday,
  Workday,
  WorkdayDiff,
  Year,
  dayjs,
} from './date-time';

describe('DateTime', () => {
  describe('Today', () => {
    const todayFunc = new Today();

    it('should return the current date', () => {
      const result = todayFunc.eval();

      expect(result).toBe(dayjs().startOf('d').toISOString());
    });
  });

  describe('Year', () => {
    const yearFunc = new Year();

    it('should return the year from a given date string', () => {
      const result = yearFunc.eval([new TypedValue('2023-09-08', CellValueType.String, false)], {
        record: {} as IRecord,
        dependencies: {},
        timeZone: 'Asia/Shanghai',
      });

      expect(result).toBe(2023);
    });

    it('should return the year from a given date iso string', () => {
      // time zone test America/Los_Angeles -7 ~ -8
      expect(
        yearFunc.eval(
          [
            new TypedValue(
              new Date('2023-01-01T07:00:00.000Z').toISOString(),
              CellValueType.DateTime,
              false
            ),
          ],
          {
            record: {} as IRecord,
            dependencies: {},
            timeZone: 'America/Los_Angeles',
          }
        )
      ).toBe(2022);

      expect(
        yearFunc.eval(
          [
            new TypedValue(
              new Date('2023-01-01T09:00:00.000Z').toISOString(),
              CellValueType.DateTime,
              false
            ),
          ],
          {
            record: {} as IRecord,
            dependencies: {},
            timeZone: 'America/Los_Angeles',
          }
        )
      ).toBe(2023);
    });
  });

  describe('Month', () => {
    const monthFunc = new Month();

    it('should return the month from a given date string', () => {
      const result = monthFunc.eval([new TypedValue('2023-09-01', CellValueType.String, false)], {
        record: {} as IRecord,
        dependencies: {},
        timeZone: 'America/Los_Angeles',
      });

      expect(result).toBe(9);
    });

    it('should return the month from a given date iso string', () => {
      expect(
        monthFunc.eval(
          [
            new TypedValue(
              new Date('2023-09-01T06:00:00.000Z').toISOString(),
              CellValueType.DateTime,
              false
            ),
          ],
          {
            record: {} as IRecord,
            dependencies: {},
            timeZone: 'America/Los_Angeles',
          }
        )
      ).toBe(8);

      expect(
        monthFunc.eval(
          [
            new TypedValue(
              new Date('2023-09-01T09:00:00.000Z').toISOString(),
              CellValueType.DateTime,
              false
            ),
          ],
          {
            record: {} as IRecord,
            dependencies: {},
            timeZone: 'America/Los_Angeles',
          }
        )
      ).toBe(9);
    });
  });

  describe('WeekNum', () => {
    const weekNumFunc = new WeekNum();

    it('should return the weeknum from a given date string', () => {
      const result = weekNumFunc.eval([new TypedValue('2023-09-08', CellValueType.String, false)], {
        record: {} as IRecord,
        dependencies: {},
        timeZone: 'America/Los_Angeles',
      });

      expect(result).toBe(36);
    });

    it('should return the weeknum from a given date iso string', () => {
      const result = weekNumFunc.eval(
        [
          new TypedValue(
            new Date('2023-09-08T07:00:00.000Z').toISOString(),
            CellValueType.DateTime,
            false
          ),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(36);
    });
  });

  describe('Weekday', () => {
    const weekdayFunc = new Weekday();
    it('should return the weekday from a given date string', () => {
      const result = weekdayFunc.eval([new TypedValue('2023-09-08', CellValueType.String, false)], {
        record: {} as IRecord,
        dependencies: {},
        timeZone: 'America/Los_Angeles',
      });

      expect(result).toBe(5);
    });

    it('should return the weekday from a given date iso string', () => {
      const result = weekdayFunc.eval(
        [
          new TypedValue(
            new Date('2023-09-08T00:00:00.000Z').toISOString(),
            CellValueType.DateTime,
            false
          ),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(4);
    });

    it('should return the weekday from a given date iso string', () => {
      const result = weekdayFunc.eval(
        [
          new TypedValue(
            new Date('2023-09-08T00:00:00.000Z').toISOString(),
            CellValueType.DateTime,
            false
          ),
          new TypedValue('monday', CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(3);
    });
  });

  describe('Day', () => {
    const dayFunc = new Day();

    it('should return the day from a given date string', () => {
      const result = dayFunc.eval([new TypedValue('2023-09-08', CellValueType.String, false)], {
        record: {} as IRecord,
        dependencies: {},
        timeZone: 'America/Los_Angeles',
      });

      expect(result).toBe(8);
    });

    it('should return the day from a given date iso string', () => {
      expect(
        dayFunc.eval(
          [
            new TypedValue(
              new Date('2023-09-08T00:00:00.000Z').toISOString(),
              CellValueType.DateTime,
              false
            ),
          ],
          {
            record: {} as IRecord,
            dependencies: {},
            timeZone: 'America/Los_Angeles',
          }
        )
      ).toBe(7);

      expect(
        dayFunc.eval(
          [
            new TypedValue(
              new Date('2023-09-07T20:00:00.000Z').toISOString(),
              CellValueType.DateTime,
              false
            ),
          ],
          {
            record: {} as IRecord,
            dependencies: {},
            timeZone: 'Asia/Shanghai',
          }
        )
      ).toBe(8);

      expect(
        dayFunc.eval(
          [
            new TypedValue(
              new Date('2023-09-07T00:00:00+09:00').toISOString(),
              CellValueType.DateTime,
              false
            ),
          ],
          {
            record: {} as IRecord,
            dependencies: {},
            timeZone: 'Asia/Shanghai',
          }
        )
      ).toBe(6);
    });
  });

  describe('Hour', () => {
    const hourFunc = new Hour();

    it('should return the hours from a given date-time string', () => {
      const result = hourFunc.eval(
        [new TypedValue('2023-09-08 18:28:38', CellValueType.String, false)],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(18);
    });

    it('should return the hours from a given date-time iso string', () => {
      const result = hourFunc.eval(
        [
          new TypedValue(
            new Date('2023-09-08T18:00:00.000Z').toISOString(),
            CellValueType.DateTime,
            false
          ),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(11);
    });
  });

  describe('Minute', () => {
    const minuteFunc = new Minute();

    it('should return the minutes from a given date-time string', () => {
      const result = minuteFunc.eval(
        [new TypedValue('2023-09-08 18:28:38', CellValueType.String, false)],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(28);
    });

    it('should return the minutes from a given date-time iso string', () => {
      const result = minuteFunc.eval(
        [
          new TypedValue(
            new Date('2023-09-08T18:28:00.000Z').toISOString(),
            CellValueType.DateTime,
            false
          ),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(28);
    });
  });

  describe('Second', () => {
    const secondFunc = new Second();

    it('should return the seconds from a given date-time string', () => {
      const result = secondFunc.eval(
        [new TypedValue('2023-09-08 18:28:38', CellValueType.String, false)],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(38);
    });

    it('should return the seconds from a given date-time iso string', () => {
      const result = secondFunc.eval(
        [
          new TypedValue(
            new Date('2023-09-08 18:28:38').toISOString(),
            CellValueType.DateTime,
            false
          ),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(38);
    });
  });

  describe('FromNow', () => {
    const fromNowFunc = new FromNow();
    // Calculate a date 36 days in the past
    const date = new Date(Date.now() - 36 * 24 * 60 * 60 * 1000).toISOString();

    it('should return the difference in years from the current date to the given date', () => {
      const result = fromNowFunc.eval(
        [
          new TypedValue(date, CellValueType.DateTime, false),
          new TypedValue('year', CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(0);
    });

    it('should return the difference in months from the current date to the given date', () => {
      const result = fromNowFunc.eval(
        [
          new TypedValue(date, CellValueType.DateTime, false),
          new TypedValue('month', CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(1);
    });

    it('should return the difference in days from the current date to the given date', () => {
      const result = fromNowFunc.eval(
        [
          new TypedValue(date, CellValueType.DateTime, false),
          new TypedValue('day', CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(36);
    });

    it('should return the difference in hours from the current date to the given date', () => {
      const result = fromNowFunc.eval(
        [
          new TypedValue(date, CellValueType.DateTime, false),
          new TypedValue('hour', CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );
      expect(result).toBe(864);
    });

    it('should return the difference in minutes from the current date to the given date', () => {
      const result = fromNowFunc.eval(
        [
          new TypedValue(date, CellValueType.DateTime, false),
          new TypedValue('minute', CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(51840);
    });

    it('should return the approximate difference in years from the current date to the given date', () => {
      const result = fromNowFunc.eval(
        [
          new TypedValue(date, CellValueType.DateTime, false),
          new TypedValue('year', CellValueType.String, false),
          new TypedValue(true, CellValueType.Boolean, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBeCloseTo(0.1, 1);
    });
  });

  describe('DatetimeDiff', () => {
    const datetimeDiffFunc = new DatetimeDiff();
    const startDate = new Date('2022-08-01T16:30:00.000Z').toISOString();
    const endDate = new Date('2023-09-08T19:20:00.000Z').toISOString();

    it('should return the difference in day between two dates by default', () => {
      expect(
        datetimeDiffFunc.eval(
          [
            new TypedValue(startDate, CellValueType.DateTime, false),
            new TypedValue(endDate, CellValueType.DateTime, false),
          ],
          {
            record: {} as IRecord,
            dependencies: {},
            timeZone: 'America/Los_Angeles',
          }
        )
      ).toBe(-403);

      expect(
        datetimeDiffFunc.eval(
          [
            new TypedValue(
              new Date('2023-09-09T00:00:00.000Z').toISOString(),
              CellValueType.DateTime,
              false
            ),
            new TypedValue(
              new Date('2023-09-08T00:00:00.000Z').toISOString(),
              CellValueType.DateTime,
              false
            ),
          ],
          {
            record: {} as IRecord,
            dependencies: {},
            timeZone: 'America/Los_Angeles',
          }
        )
      ).toBe(1);
    });

    it('should return the difference in years between two dates', () => {
      const result = datetimeDiffFunc.eval(
        [
          new TypedValue(startDate, CellValueType.DateTime, false),
          new TypedValue(endDate, CellValueType.DateTime, false),
          new TypedValue('year', CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(-1);
    });

    it('should return the difference in months between two dates', () => {
      const result = datetimeDiffFunc.eval(
        [
          new TypedValue(startDate, CellValueType.DateTime, false),
          new TypedValue(endDate, CellValueType.DateTime, false),
          new TypedValue('month', CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(-13);
    });

    it('should return the difference in days between two dates', () => {
      const result = datetimeDiffFunc.eval(
        [
          new TypedValue(startDate, CellValueType.DateTime, false),
          new TypedValue(endDate, CellValueType.DateTime, false),
          new TypedValue('day', CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(-403);
    });

    it('should return the difference in hours between two dates', () => {
      const result = datetimeDiffFunc.eval(
        [
          new TypedValue(startDate, CellValueType.DateTime, false),
          new TypedValue(endDate, CellValueType.DateTime, false),
          new TypedValue('hour', CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(-9674);
    });

    it('should return the difference in minutes between two dates', () => {
      const result = datetimeDiffFunc.eval(
        [
          new TypedValue(startDate, CellValueType.DateTime, false),
          new TypedValue(endDate, CellValueType.DateTime, false),
          new TypedValue('minute', CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(-580490);
    });

    it('should return the difference in seconds between two dates', () => {
      const result = datetimeDiffFunc.eval(
        [
          new TypedValue(startDate, CellValueType.DateTime, false),
          new TypedValue(endDate, CellValueType.DateTime, false),
          new TypedValue('second', CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(-34829400);
    });

    it('should return an approximate difference in months between two dates', () => {
      const result = datetimeDiffFunc.eval(
        [
          new TypedValue(startDate, CellValueType.DateTime, false),
          new TypedValue(endDate, CellValueType.DateTime, false),
          new TypedValue('month', CellValueType.String, false),
          new TypedValue(true, CellValueType.Boolean, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBeCloseTo(-13.23, 2);
    });
  });

  describe('Workday', () => {
    const workdayFunc = new Workday();
    const startDate = new Date('2023-09-08 00:00:00').toISOString();
    const holidayStr = '2024-01-22, 2024-01-23, 2024-01-24, 2024-01-25';

    it('should add 200 workdays to the start date', () => {
      const result = workdayFunc.eval(
        [
          new TypedValue(startDate, CellValueType.DateTime, false),
          new TypedValue(200, CellValueType.Number, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(new Date('2024-06-14 00:00:00').toISOString());
    });

    it('should add 200 workdays to the start date, excluding the specified holidays', () => {
      const result = workdayFunc.eval(
        [
          new TypedValue(startDate, CellValueType.DateTime, false),
          new TypedValue(200, CellValueType.Number, false),
          new TypedValue(holidayStr, CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(new Date('2024-06-20 00:00:00').toISOString());
    });

    it('should subtract 100 workdays from the start date', () => {
      const result = workdayFunc.eval(
        [
          new TypedValue(startDate, CellValueType.DateTime, false),
          new TypedValue(-100, CellValueType.Number, false),
        ],
        { record: {} as IRecord, dependencies: {}, timeZone: 'America/Los_Angeles' }
      );

      expect(result).toBe(new Date('2023-04-21 00:00:00').toISOString());
    });

    it('should subtract 100 workdays from the start date, excluding the specified holidays', () => {
      const result = workdayFunc.eval(
        [
          new TypedValue(startDate, CellValueType.DateTime, false),
          new TypedValue(-100, CellValueType.Number, false),
          new TypedValue('2023-08-03, 2023-08-11', CellValueType.String, false),
        ],
        { record: {} as IRecord, dependencies: {}, timeZone: 'America/Los_Angeles' }
      );

      expect(result).toBe(new Date('2023-04-19 00:00:00').toISOString());
    });

    it('should skip the start date when it is considered a holiday', () => {
      const result = workdayFunc.eval(
        [
          new TypedValue('2023-09-07 00:00:00', CellValueType.String, false),
          new TypedValue(2, CellValueType.Number, false),
          new TypedValue(startDate, CellValueType.DateTime, false),
        ],
        { record: {} as IRecord, dependencies: {}, timeZone: 'America/Los_Angeles' }
      );

      expect(result).toBe(new Date('2023-09-12T07:00:00.000Z').toISOString());
    });
  });

  describe('WorkdayDiff', () => {
    const workdayDiffFunc = new WorkdayDiff();
    const startDate = new Date('2023-06-18').toISOString();
    const endDate = new Date('2023-10-01').toISOString();
    const holidayStr = '2023-07-12, 2023-08-18, 2023-08-19';

    it('should return the difference in workdays between two dates', () => {
      const result = workdayDiffFunc.eval(
        [
          new TypedValue(startDate, CellValueType.DateTime, false),
          new TypedValue(endDate, CellValueType.DateTime, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(75);
    });

    it('should return the difference in workdays between two dates, excluding the specified holidays', () => {
      const result = workdayDiffFunc.eval(
        [
          new TypedValue(startDate, CellValueType.DateTime, false),
          new TypedValue(endDate, CellValueType.DateTime, false),
          new TypedValue(holidayStr, CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(73);
    });

    it('should accurately return the workday difference for short date ranges', () => {
      const result = workdayDiffFunc.eval(
        [
          new TypedValue(new Date('2023-09-05').toISOString(), CellValueType.DateTime, false),
          new TypedValue(new Date('2023-09-11').toISOString(), CellValueType.DateTime, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(5);
    });
  });

  describe('IsSame', () => {
    const isSameFunc = new IsSame();
    const date1 = new Date('2023-09-08 18:00:00').toISOString();
    const date2 = new Date('2023-09-10 18:00:00').toISOString();

    it('should return false when checking if two distinct dates are the same without any granularity', () => {
      const result = isSameFunc.eval(
        [
          new TypedValue(date1, CellValueType.DateTime, false),
          new TypedValue(date2, CellValueType.DateTime, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(false);
    });

    it('should return true when checking if two distinct dates are from the same year', () => {
      const result = isSameFunc.eval(
        [
          new TypedValue(date1, CellValueType.DateTime, false),
          new TypedValue(date2, CellValueType.DateTime, false),
          new TypedValue('year', CellValueType.DateTime, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(true);
    });

    it('should return true when checking if two distinct dates are from the same month', () => {
      const result = isSameFunc.eval(
        [
          new TypedValue(date1, CellValueType.DateTime, false),
          new TypedValue(date2, CellValueType.DateTime, false),
          new TypedValue('month', CellValueType.DateTime, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(true);
    });

    it('should return true when checking if two distinct dates are the same day', () => {
      expect(
        isSameFunc.eval(
          [
            new TypedValue(
              new Date('2023-09-08T23:00:00.000Z').toISOString(),
              CellValueType.DateTime,
              false
            ),
            new TypedValue(
              new Date('2023-09-09T03:00:00.000Z').toISOString(),
              CellValueType.DateTime,
              false
            ),
            new TypedValue('day', CellValueType.DateTime, false),
          ],
          {
            record: {} as IRecord,
            dependencies: {},
            timeZone: 'America/Los_Angeles',
          }
        )
      ).toBe(true);

      expect(
        isSameFunc.eval(
          [
            new TypedValue(
              new Date('2023-09-09T23:00:00.000Z').toISOString(),
              CellValueType.DateTime,
              false
            ),
            new TypedValue(
              new Date('2023-09-09T03:00:00.000Z').toISOString(),
              CellValueType.DateTime,
              false
            ),
            new TypedValue('day', CellValueType.DateTime, false),
          ],
          {
            record: {} as IRecord,
            dependencies: {},
            timeZone: 'America/Los_Angeles',
          }
        )
      ).toBe(false);
    });
  });

  describe('IsAfter', () => {
    const isAfterFunc = new IsAfter();
    const date1 = new Date('2023-09-10 18:00:00').toISOString();
    const date2 = new Date('2023-09-08 18:00:00').toISOString();

    it('should return true when date1 is after date2 without any granularity', () => {
      const result = isAfterFunc.eval(
        [
          new TypedValue(date1, CellValueType.DateTime, false),
          new TypedValue(date2, CellValueType.DateTime, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(true);
    });

    it('should return false when date1 and date2 are in the same year', () => {
      const result = isAfterFunc.eval(
        [
          new TypedValue(date1, CellValueType.DateTime, false),
          new TypedValue(date2, CellValueType.DateTime, false),
          new TypedValue('year', CellValueType.DateTime, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(false);
    });

    it('should return false when date1 and date2 are in the same month', () => {
      const result = isAfterFunc.eval(
        [
          new TypedValue(date1, CellValueType.DateTime, false),
          new TypedValue(date2, CellValueType.DateTime, false),
          new TypedValue('month', CellValueType.DateTime, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(false);
    });

    it('should return true when date1 is after date2 in terms of day', () => {
      const result = isAfterFunc.eval(
        [
          new TypedValue(date1, CellValueType.DateTime, false),
          new TypedValue(date2, CellValueType.DateTime, false),
          new TypedValue('day', CellValueType.DateTime, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(true);
    });
  });

  describe('IsBefore', () => {
    const isBeforeFunc = new IsBefore();
    const date1 = new Date('2023-09-08 18:00:00').toISOString();
    const date2 = new Date('2023-09-10 18:00:00').toISOString();

    it('should return true when date1 is before date2 without any granularity', () => {
      const result = isBeforeFunc.eval(
        [
          new TypedValue(date1, CellValueType.DateTime, false),
          new TypedValue(date2, CellValueType.DateTime, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(true);
    });

    it('should return false when date1 and date2 are in the same year', () => {
      const result = isBeforeFunc.eval(
        [
          new TypedValue(date1, CellValueType.DateTime, false),
          new TypedValue(date2, CellValueType.DateTime, false),
          new TypedValue('year', CellValueType.DateTime, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(false);
    });

    it('should return false when date1 and date2 are in the same month', () => {
      const result = isBeforeFunc.eval(
        [
          new TypedValue(date1, CellValueType.DateTime, false),
          new TypedValue(date2, CellValueType.DateTime, false),
          new TypedValue('month', CellValueType.DateTime, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(false);
    });

    it('should return true when date1 is before date2 in terms of day', () => {
      const result = isBeforeFunc.eval(
        [
          new TypedValue(
            new Date('2023-09-09T03:00:00.000Z').toISOString(),
            CellValueType.DateTime,
            false
          ),
          new TypedValue(
            new Date('2023-09-09T13:00:00.000Z').toISOString(),
            CellValueType.DateTime,
            false
          ),
          new TypedValue('day', CellValueType.DateTime, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(true);
    });
  });

  describe('DateAdd', () => {
    const dateAddFunc = new DateAdd();
    const date = new Date('2023-09-08 18:00:00').toISOString();

    it('should add 10 days to the given date', () => {
      const result = dateAddFunc.eval(
        [
          new TypedValue(date, CellValueType.DateTime, false),
          new TypedValue(10, CellValueType.Number, false),
          new TypedValue('day', CellValueType.Number, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(new Date('2023-09-18 18:00:00').toISOString());
    });

    it('should add 2 months to the given date', () => {
      const result = dateAddFunc.eval(
        [
          new TypedValue(date, CellValueType.DateTime, false),
          new TypedValue(2, CellValueType.Number, false),
          new TypedValue('month', CellValueType.Number, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(new Date('2023-11-08 18:00:00').toISOString());
    });
  });

  describe('Datestr', () => {
    const datestrFunc = new Datestr();
    const date = new Date('2023-09-08 18:00:00').toISOString();

    it('should return only the date part of a DateTime value', () => {
      const result = datestrFunc.eval([new TypedValue(date, CellValueType.DateTime, false)], {
        record: {} as IRecord,
        dependencies: {},
        timeZone: 'America/Los_Angeles',
      });

      expect(result).toBe('2023-09-08');
    });
  });

  describe('Timestr', () => {
    const timestrFunc = new Timestr();
    const date = new Date('2023-09-08T18:56:00.000Z').toISOString();

    it('should return only the time part of a DateTime value', () => {
      const result = timestrFunc.eval([new TypedValue(date, CellValueType.DateTime, false)], {
        record: {} as IRecord,
        dependencies: {},
        timeZone: 'America/Los_Angeles',
      });

      expect(result).toBe('11:56:00');
    });
  });

  describe('DatetimeFormat', () => {
    const datetimeFormatFunc = new DatetimeFormat();
    const date = new Date('2023-09-08T18:56:00.000Z').toISOString();

    it('The function returns a formatted date-time string when no specific format string is provided', () => {
      const result = datetimeFormatFunc.eval(
        [new TypedValue(date, CellValueType.DateTime, false)],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe('2023-09-08 11:56');
    });

    it('The function returns the date-time in a custom format when a format string is provided', () => {
      const result = datetimeFormatFunc.eval(
        [
          new TypedValue(date, CellValueType.DateTime, false),
          new TypedValue('M/D/YYYY', CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe('9/8/2023');
    });
  });

  describe('DatetimeParse', () => {
    const datetimeParseFunc = new DatetimeParse();
    const date = new Date('2023-09-08 18:56:00').toISOString();

    it('The function returns an ISO string when given a date-time ISO string without a specific format', () => {
      const result = datetimeParseFunc.eval([new TypedValue(date, CellValueType.DateTime, false)], {
        record: {} as IRecord,
        dependencies: {},
        timeZone: 'America/Los_Angeles',
      });

      expect(result).toBe(date);
    });

    it('The function parses a date-time ISO string into a new date-time format, returning a new date-time ISO string', () => {
      const result = datetimeParseFunc.eval(
        [
          new TypedValue('8 Sep 2023 18:00', CellValueType.String, false),
          new TypedValue('D MMM YYYY HH:mm', CellValueType.String, false),
        ],
        {
          record: {} as IRecord,
          dependencies: {},
          timeZone: 'America/Los_Angeles',
        }
      );

      expect(result).toBe(
        dayjs.tz('8 Sep 2023 18:00', 'D MMM YYYY HH:mm', 'America/Los_Angeles').toISOString()
      );
    });
  });

  describe('CreatedTime', () => {
    const createdTimeFunc = new CreatedTime();
    const date = new Date().toISOString();
    const record: IRecord = {
      id: 'recTest',
      fields: {},
      createdTime: date,
    };
    const context = {
      record,
      dependencies: {},
      timeZone: 'America/Los_Angeles',
    };

    it('Should return created time', () => {
      const result = createdTimeFunc.eval([], context);

      expect(result).toBe(date);
    });
  });

  describe('LastModifiedTime', () => {
    const lastModifiedTimeFunc = new LastModifiedTime();
    const date = new Date().toISOString();
    const record: IRecord = {
      id: 'recTest',
      fields: {},
      createdTime: date,
      lastModifiedTime: date,
    };
    const context = {
      record,
      dependencies: {},
      timeZone: 'America/Los_Angeles',
    };

    it('Should return last modified time', () => {
      const result = lastModifiedTimeFunc.eval([], context);

      expect(result).toBe(date);
    });
  });
});
