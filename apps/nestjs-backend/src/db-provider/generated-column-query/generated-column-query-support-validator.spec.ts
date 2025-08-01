import { GeneratedColumnQuerySupportValidatorPostgres } from './postgres/generated-column-query-support-validator.postgres';
import { GeneratedColumnQuerySupportValidatorSqlite } from './sqlite/generated-column-query-support-validator.sqlite';

describe('GeneratedColumnQuerySupportValidator', () => {
  let postgresValidator: GeneratedColumnQuerySupportValidatorPostgres;
  let sqliteValidator: GeneratedColumnQuerySupportValidatorSqlite;

  beforeEach(() => {
    postgresValidator = new GeneratedColumnQuerySupportValidatorPostgres();
    sqliteValidator = new GeneratedColumnQuerySupportValidatorSqlite();
  });

  describe('PostgreSQL Support Validator', () => {
    it('should support basic numeric functions', () => {
      expect(postgresValidator.sum(['a', 'b'])).toBe(true);
      expect(postgresValidator.average(['a', 'b'])).toBe(true);
      expect(postgresValidator.max(['a', 'b'])).toBe(true);
      expect(postgresValidator.min(['a', 'b'])).toBe(true);
      expect(postgresValidator.round('a', '2')).toBe(true);
      expect(postgresValidator.abs('a')).toBe(true);
      expect(postgresValidator.sqrt('a')).toBe(true);
      expect(postgresValidator.power('a', 'b')).toBe(true);
    });

    it('should support basic text functions', () => {
      expect(postgresValidator.concatenate(['a', 'b'])).toBe(true);
      expect(postgresValidator.upper('a')).toBe(true);
      expect(postgresValidator.lower('a')).toBe(true);
      expect(postgresValidator.trim('a')).toBe(true);
      expect(postgresValidator.len('a')).toBe(true);
      expect(postgresValidator.regexpReplace('a', 'b', 'c')).toBe(true);
    });

    it('should not support array functions due to technical limitations', () => {
      expect(postgresValidator.arrayJoin('a', ',')).toBe(false);
      expect(postgresValidator.arrayUnique('a')).toBe(false);
      expect(postgresValidator.arrayFlatten('a')).toBe(false);
      expect(postgresValidator.arrayCompact('a')).toBe(false);
    });

    it('should support basic time functions but not time-dependent ones', () => {
      expect(postgresValidator.now()).toBe(true);
      expect(postgresValidator.today()).toBe(true);
      expect(postgresValidator.lastModifiedTime()).toBe(true);
      expect(postgresValidator.createdTime()).toBe(true);
      expect(postgresValidator.fromNow('a')).toBe(false);
      expect(postgresValidator.toNow('a')).toBe(false);
    });

    it('should support system functions', () => {
      expect(postgresValidator.recordId()).toBe(true);
      expect(postgresValidator.autoNumber()).toBe(true);
    });

    it('should support basic date functions but not complex ones', () => {
      expect(postgresValidator.dateAdd('a', 'b', 'c')).toBe(true);
      expect(postgresValidator.datetimeDiff('a', 'b', 'c')).toBe(true);
      expect(postgresValidator.year('a')).toBe(true);
      expect(postgresValidator.month('a')).toBe(true);
      expect(postgresValidator.day('a')).toBe(true);
      expect(postgresValidator.workday('a', 'b')).toBe(false);
      expect(postgresValidator.workdayDiff('a', 'b')).toBe(false);
    });
  });

  describe('SQLite Support Validator', () => {
    it('should support basic numeric functions', () => {
      expect(sqliteValidator.sum(['a', 'b'])).toBe(true);
      expect(sqliteValidator.average(['a', 'b'])).toBe(true);
      expect(sqliteValidator.max(['a', 'b'])).toBe(true);
      expect(sqliteValidator.min(['a', 'b'])).toBe(true);
      expect(sqliteValidator.round('a', '2')).toBe(true);
      expect(sqliteValidator.abs('a')).toBe(true);
    });

    it('should not support advanced numeric functions', () => {
      expect(sqliteValidator.sqrt('a')).toBe(false);
      expect(sqliteValidator.power('a', 'b')).toBe(false);
      expect(sqliteValidator.exp('a')).toBe(false);
      expect(sqliteValidator.log('a', 'b')).toBe(false);
    });

    it('should support basic text functions', () => {
      expect(sqliteValidator.concatenate(['a', 'b'])).toBe(true);
      expect(sqliteValidator.upper('a')).toBe(true);
      expect(sqliteValidator.lower('a')).toBe(true);
      expect(sqliteValidator.trim('a')).toBe(true);
      expect(sqliteValidator.len('a')).toBe(true);
    });

    it('should not support advanced text functions', () => {
      expect(sqliteValidator.regexpReplace('a', 'b', 'c')).toBe(false);
      expect(sqliteValidator.rept('a', '3')).toBe(false);
      expect(sqliteValidator.encodeUrlComponent('a')).toBe(false);
    });

    it('should not support array functions', () => {
      expect(sqliteValidator.arrayJoin('a', ',')).toBe(false);
      expect(sqliteValidator.arrayUnique('a')).toBe(false);
      expect(sqliteValidator.arrayFlatten('a')).toBe(false);
      expect(sqliteValidator.arrayCompact('a')).toBe(false);
    });

    it('should support basic time functions but not time-dependent ones', () => {
      expect(sqliteValidator.now()).toBe(true);
      expect(sqliteValidator.today()).toBe(true);
      expect(sqliteValidator.lastModifiedTime()).toBe(true);
      expect(sqliteValidator.createdTime()).toBe(true);
      expect(sqliteValidator.fromNow('a')).toBe(false);
      expect(sqliteValidator.toNow('a')).toBe(false);
    });

    it('should support system functions', () => {
      expect(sqliteValidator.recordId()).toBe(true);
      expect(sqliteValidator.autoNumber()).toBe(true);
    });

    it('should not support complex date functions', () => {
      expect(sqliteValidator.workday('a', 'b')).toBe(false);
      expect(sqliteValidator.workdayDiff('a', 'b')).toBe(false);
      expect(sqliteValidator.datetimeParse('a', 'b')).toBe(false);
    });

    it('should support basic date functions', () => {
      expect(sqliteValidator.dateAdd('a', 'b', 'c')).toBe(true);
      expect(sqliteValidator.datetimeDiff('a', 'b', 'c')).toBe(true);
      expect(sqliteValidator.year('a')).toBe(true);
      expect(sqliteValidator.month('a')).toBe(true);
      expect(sqliteValidator.day('a')).toBe(true);
    });
  });

  describe('Comparison between PostgreSQL and SQLite', () => {
    it('should show PostgreSQL has more capabilities than SQLite', () => {
      // Functions that PostgreSQL supports but SQLite doesn't
      const postgresOnlyFunctions = [
        () => postgresValidator.sqrt('a') && !sqliteValidator.sqrt('a'),
        () => postgresValidator.power('a', 'b') && !sqliteValidator.power('a', 'b'),
        () => postgresValidator.exp('a') && !sqliteValidator.exp('a'),
        () => postgresValidator.log('a', 'b') && !sqliteValidator.log('a', 'b'),
        () =>
          postgresValidator.regexpReplace('a', 'b', 'c') &&
          !sqliteValidator.regexpReplace('a', 'b', 'c'),
        () => postgresValidator.rept('a', '3') && !sqliteValidator.rept('a', '3'),
        () => postgresValidator.encodeUrlComponent('a') && !sqliteValidator.encodeUrlComponent('a'),
        () => postgresValidator.datetimeParse('a', 'b') && !sqliteValidator.datetimeParse('a', 'b'),
      ];

      postgresOnlyFunctions.forEach((testFn) => {
        expect(testFn()).toBe(true);
      });
    });

    it('should have same restrictions for error handling and unpredictable time functions', () => {
      // Both should reject these functions
      const restrictedFunctions = [
        'fromNow',
        'toNow',
        'error',
        'isError',
        'workday',
        'workdayDiff',
        'arrayJoin',
        'arrayUnique',
        'arrayFlatten',
        'arrayCompact',
      ] as const;

      restrictedFunctions.forEach((funcName) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const postgresResult = (postgresValidator as any)[funcName]('test');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sqliteResult = (sqliteValidator as any)[funcName]('test');
        expect(postgresResult).toBe(false);
        expect(sqliteResult).toBe(false);
        expect(postgresResult).toBe(sqliteResult);
      });
    });
  });
});
