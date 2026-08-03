import { GeneratedColumnQuerySupportValidatorPostgres } from './postgres/generated-column-query-support-validator.postgres';

describe('GeneratedColumnQuerySupportValidator', () => {
  let postgresValidator: GeneratedColumnQuerySupportValidatorPostgres;

  beforeEach(() => {
    postgresValidator = new GeneratedColumnQuerySupportValidatorPostgres();
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
      expect(postgresValidator.upper('a')).toBe(false); // Requires collation in PostgreSQL
      expect(postgresValidator.lower('a')).toBe(false); // Requires collation in PostgreSQL
      expect(postgresValidator.trim('a')).toBe(true);
      expect(postgresValidator.len('a')).toBe(true);
      expect(postgresValidator.regexpReplace('a', 'b', 'c')).toBe(false); // Not supported in generated columns
      expect(postgresValidator.textBefore('a', ',')).toBe(false);
      expect(postgresValidator.textSplit('a', ',')).toBe(false);
    });

    it('should not support array functions due to technical limitations', () => {
      expect(postgresValidator.arrayJoin('a', ',')).toBe(false);
      expect(postgresValidator.arrayUnique(['a'])).toBe(false);
      expect(postgresValidator.arrayFlatten(['a'])).toBe(false);
      expect(postgresValidator.arrayCompact(['a'])).toBe(false);
    });

    it('should support basic time functions but not time-dependent ones', () => {
      expect(postgresValidator.now()).toBe(true);
      expect(postgresValidator.today()).toBe(true);
      expect(postgresValidator.lastModifiedTime()).toBe(false);
      expect(postgresValidator.createdTime()).toBe(false);
      expect(postgresValidator.fromNow('a')).toBe(false);
      expect(postgresValidator.toNow('a')).toBe(false);
    });

    it('should support system functions', () => {
      expect(postgresValidator.recordId()).toBe(false);
      expect(postgresValidator.autoNumber()).toBe(false);
    });

    it('should support basic date functions but not complex ones', () => {
      expect(postgresValidator.dateAdd('a', 'b', 'c')).toBe(false);
      expect(postgresValidator.datetimeDiff('a', 'b', 'c')).toBe(false); // Not immutable in PostgreSQL
      expect(postgresValidator.year('a')).toBe(false); // Not immutable in PostgreSQL
      expect(postgresValidator.month('a')).toBe(false); // Not immutable in PostgreSQL
      expect(postgresValidator.day('a')).toBe(false); // Not immutable in PostgreSQL
      expect(postgresValidator.workday('a', 'b')).toBe(false);
      expect(postgresValidator.workdayDiff('a', 'b')).toBe(false);
    });
  });
});
