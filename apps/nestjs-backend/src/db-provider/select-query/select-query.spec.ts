/* eslint-disable sonarjs/no-duplicate-string */
import type { IFormulaConversionContext } from '@teable/core';
import { FieldType, DbFieldType, CellValueType } from '@teable/core';
import { createFieldInstanceByVo } from '../../features/field/model/factory';
import { SelectQueryPostgres } from './postgres/select-query.postgres';
import { SelectQuerySqlite } from './sqlite/select-query.sqlite';

describe('SelectQuery', () => {
  let postgresQuery: SelectQueryPostgres;
  let sqliteQuery: SelectQuerySqlite;

  beforeEach(() => {
    postgresQuery = new SelectQueryPostgres();
    sqliteQuery = new SelectQuerySqlite();
  });

  describe('Numeric Functions', () => {
    it('should generate correct SUM expressions', () => {
      expect(postgresQuery.sum(['a', 'b', 'c'])).toBe('SUM(a, b, c)');
      expect(sqliteQuery.sum(['a', 'b', 'c'])).toBe('SUM(a, b, c)');
    });

    it('should generate correct AVERAGE expressions', () => {
      expect(postgresQuery.average(['a', 'b', 'c'])).toBe('AVG(a, b, c)');
      expect(sqliteQuery.average(['a', 'b', 'c'])).toBe('AVG(a, b, c)');
    });

    it('should generate correct MAX expressions', () => {
      expect(postgresQuery.max(['a', 'b', 'c'])).toBe('GREATEST(a, b, c)');
      expect(sqliteQuery.max(['a', 'b', 'c'])).toBe('MAX(a, b, c)');
    });

    it('should generate correct MIN expressions', () => {
      expect(postgresQuery.min(['a', 'b', 'c'])).toBe('LEAST(a, b, c)');
      expect(sqliteQuery.min(['a', 'b', 'c'])).toBe('MIN(a, b, c)');
    });

    it('should generate correct ROUND expressions', () => {
      expect(postgresQuery.round('value', '2')).toBe('ROUND(value::numeric, 2::integer)');
      expect(postgresQuery.round('value')).toBe('ROUND(value::numeric)');
      expect(sqliteQuery.round('value', '2')).toBe('ROUND(value, 2)');
      expect(sqliteQuery.round('value')).toBe('ROUND(value)');
    });

    it('should generate correct ROUNDUP expressions', () => {
      expect(postgresQuery.roundUp('value', '2')).toBe(
        'CEIL(value::numeric * POWER(10, 2::integer)) / POWER(10, 2::integer)'
      );
      expect(postgresQuery.roundUp('value')).toBe('CEIL(value::numeric)');
      expect(sqliteQuery.roundUp('value', '2')).toBe(
        'CAST(CEIL(value * POWER(10, 2)) / POWER(10, 2) AS REAL)'
      );
      expect(sqliteQuery.roundUp('value')).toBe('CAST(CEIL(value) AS INTEGER)');
    });

    it('should generate correct ROUNDDOWN expressions', () => {
      expect(postgresQuery.roundDown('value', '2')).toBe(
        'FLOOR(value::numeric * POWER(10, 2::integer)) / POWER(10, 2::integer)'
      );
      expect(postgresQuery.roundDown('value')).toBe('FLOOR(value::numeric)');
      expect(sqliteQuery.roundDown('value', '2')).toBe(
        'CAST(FLOOR(value * POWER(10, 2)) / POWER(10, 2) AS REAL)'
      );
      expect(sqliteQuery.roundDown('value')).toBe('CAST(FLOOR(value) AS INTEGER)');
    });

    it('should generate correct CEILING expressions', () => {
      expect(postgresQuery.ceiling('value')).toBe('CEIL(value::numeric)');
      expect(sqliteQuery.ceiling('value')).toBe('CAST(CEIL(value) AS INTEGER)');
    });

    it('should generate correct FLOOR expressions', () => {
      expect(postgresQuery.floor('value')).toBe('FLOOR(value::numeric)');
      expect(sqliteQuery.floor('value')).toBe('CAST(FLOOR(value) AS INTEGER)');
    });

    it('should generate correct EVEN expressions', () => {
      expect(postgresQuery.even('value')).toBe(
        'CASE WHEN value::integer % 2 = 0 THEN value::integer ELSE value::integer + 1 END'
      );
      expect(sqliteQuery.even('value')).toBe(
        'CASE WHEN CAST(value AS INTEGER) % 2 = 0 THEN CAST(value AS INTEGER) ELSE CAST(value AS INTEGER) + 1 END'
      );
    });

    it('should generate correct ODD expressions', () => {
      expect(postgresQuery.odd('value')).toBe(
        'CASE WHEN value::integer % 2 = 1 THEN value::integer ELSE value::integer + 1 END'
      );
      expect(sqliteQuery.odd('value')).toBe(
        'CASE WHEN CAST(value AS INTEGER) % 2 = 1 THEN CAST(value AS INTEGER) ELSE CAST(value AS INTEGER) + 1 END'
      );
    });

    it('should generate correct INT expressions', () => {
      expect(postgresQuery.int('value')).toBe('FLOOR(value::numeric)');
      expect(sqliteQuery.int('value')).toBe('CAST(value AS INTEGER)');
    });

    it('should generate correct ABS expressions', () => {
      expect(postgresQuery.abs('value')).toBe('ABS(value::numeric)');
      expect(sqliteQuery.abs('value')).toBe('ABS(value)');
    });

    it('should generate correct SQRT expressions', () => {
      expect(postgresQuery.sqrt('16')).toBe('SQRT(16::numeric)');
      expect(sqliteQuery.sqrt('16')).toBe('SQRT(16)');
    });

    it('should generate correct POWER expressions', () => {
      expect(postgresQuery.power('base', 'exp')).toBe('POWER(base::numeric, exp::numeric)');
      expect(sqliteQuery.power('base', 'exp')).toBe('POWER(base, exp)');
    });

    it('should generate correct EXP expressions', () => {
      expect(postgresQuery.exp('value')).toBe('EXP(value::numeric)');
      expect(sqliteQuery.exp('value')).toBe('EXP(value)');
    });

    it('should generate correct LOG expressions', () => {
      expect(postgresQuery.log('value', 'base')).toBe('LOG(base::numeric, value::numeric)');
      expect(postgresQuery.log('value')).toBe('LN(value::numeric)');
      expect(sqliteQuery.log('value', 'base')).toBe(
        '(LOG(value) * 2.302585092994046 / (LOG(base) * 2.302585092994046))'
      );
      expect(sqliteQuery.log('value')).toBe('(LOG(value) * 2.302585092994046)');
    });

    it('should generate correct MOD expressions', () => {
      expect(postgresQuery.mod('dividend', 'divisor')).toBe(
        'MOD(dividend::numeric, divisor::numeric)'
      );
      expect(sqliteQuery.mod('dividend', 'divisor')).toBe('(dividend % divisor)');
    });

    it('should generate correct VALUE expressions', () => {
      expect(postgresQuery.value('text')).toBe('text::numeric');
      expect(sqliteQuery.value('text')).toBe('CAST(text AS REAL)');
    });
  });

  describe('Text Functions', () => {
    it('should generate correct CONCATENATE expressions', () => {
      expect(postgresQuery.concatenate(['a', 'b'])).toBe('CONCAT(a, b)');
      expect(sqliteQuery.concatenate(['a', 'b'])).toBe("(COALESCE(a, '') || COALESCE(b, ''))");
    });

    it('should generate correct STRING_CONCAT expressions', () => {
      expect(postgresQuery.stringConcat('left', 'right')).toBe('CONCAT(left, right)');
      expect(sqliteQuery.stringConcat('left', 'right')).toBe(
        "(COALESCE(left, '') || COALESCE(right, ''))"
      );
    });

    it('should generate correct FIND expressions', () => {
      expect(postgresQuery.find('search', 'text', 'start')).toBe(
        'POSITION(search IN SUBSTRING(text FROM start::integer)) + start::integer - 1'
      );
      expect(postgresQuery.find('search', 'text')).toBe('POSITION(search IN text)');
      expect(sqliteQuery.find('search', 'text', 'start')).toBe(
        'CASE WHEN INSTR(SUBSTR(text, start), search) > 0 THEN INSTR(SUBSTR(text, start), search) + start - 1 ELSE 0 END'
      );
      expect(sqliteQuery.find('search', 'text')).toBe('INSTR(text, search)');
    });

    it('should generate correct SEARCH expressions', () => {
      expect(postgresQuery.search('search', 'text', 'start')).toBe(
        'POSITION(UPPER(search) IN UPPER(SUBSTRING(text FROM start::integer))) + start::integer - 1'
      );
      expect(postgresQuery.search('search', 'text')).toBe('POSITION(UPPER(search) IN UPPER(text))');
      expect(sqliteQuery.search('search', 'text', 'start')).toBe(
        'CASE WHEN INSTR(UPPER(SUBSTR(text, start)), UPPER(search)) > 0 THEN INSTR(UPPER(SUBSTR(text, start)), UPPER(search)) + start - 1 ELSE 0 END'
      );
      expect(sqliteQuery.search('search', 'text')).toBe('INSTR(UPPER(text), UPPER(search))');
    });

    it('should generate correct MID expressions', () => {
      expect(postgresQuery.mid('text', 'start', 'length')).toBe(
        'SUBSTRING(text FROM start::integer FOR length::integer)'
      );
      expect(sqliteQuery.mid('text', 'start', 'length')).toBe('SUBSTR(text, start, length)');
    });

    it('should generate correct LEFT expressions', () => {
      expect(postgresQuery.left('text', 'count')).toBe('LEFT(text, count::integer)');
      expect(sqliteQuery.left('text', 'count')).toBe('SUBSTR(text, 1, count)');
    });

    it('should generate correct RIGHT expressions', () => {
      expect(postgresQuery.right('text', 'count')).toBe('RIGHT(text, count::integer)');
      expect(sqliteQuery.right('text', 'count')).toBe('SUBSTR(text, -count)');
    });

    it('should generate correct REPLACE expressions', () => {
      expect(postgresQuery.replace('text', 'start', 'length', 'new')).toBe(
        'OVERLAY(text PLACING new FROM start::integer FOR length::integer)'
      );
      expect(sqliteQuery.replace('text', 'start', 'length', 'new')).toBe(
        '(SUBSTR(text, 1, start - 1) || new || SUBSTR(text, start + length))'
      );
    });

    it('should generate correct REGEX_REPLACE expressions', () => {
      expect(postgresQuery.regexpReplace('text', 'pattern', 'replacement')).toBe(
        "REGEXP_REPLACE(text, pattern, replacement, 'g')"
      );
      expect(sqliteQuery.regexpReplace('text', 'pattern', 'replacement')).toBe(
        'REPLACE(text, pattern, replacement)'
      );
    });

    it('should generate correct SUBSTITUTE expressions', () => {
      expect(postgresQuery.substitute('text', 'old', 'new', 'instance')).toBe(
        'REPLACE(text, old, new)'
      );
      expect(postgresQuery.substitute('text', 'old', 'new')).toBe('REPLACE(text, old, new)');
      expect(sqliteQuery.substitute('text', 'old', 'new', 'instance')).toBe(
        'REPLACE(text, old, new)'
      );
      expect(sqliteQuery.substitute('text', 'old', 'new')).toBe('REPLACE(text, old, new)');
    });

    it('should generate correct LOWER expressions', () => {
      expect(postgresQuery.lower('text')).toBe('LOWER(text)');
      expect(sqliteQuery.lower('text')).toBe('LOWER(text)');
    });

    it('should generate correct UPPER expressions', () => {
      expect(postgresQuery.upper('text')).toBe('UPPER(text)');
      expect(sqliteQuery.upper('text')).toBe('UPPER(text)');
    });

    it('should generate correct REPT expressions', () => {
      expect(postgresQuery.rept('text', 'count')).toBe('REPEAT(text, count::integer)');
      expect(sqliteQuery.rept('text', 'count')).toBe("REPLACE(HEX(ZEROBLOB(count)), '00', text)");
    });

    it('should generate correct TRIM expressions', () => {
      expect(postgresQuery.trim('text')).toBe('TRIM(text)');
      expect(sqliteQuery.trim('text')).toBe('TRIM(text)');
    });

    it('should generate correct LEN expressions', () => {
      expect(postgresQuery.len('text')).toBe('LENGTH(text)');
      expect(sqliteQuery.len('text')).toBe('LENGTH(text)');
    });

    it('should generate correct T expressions', () => {
      expect(postgresQuery.t('value')).toBe("CASE WHEN value IS NULL THEN '' ELSE value::text END");
      expect(sqliteQuery.t('value')).toBe(
        "CASE WHEN value IS NULL THEN '' WHEN typeof(value) = 'text' THEN value ELSE value END"
      );
    });

    it('should generate correct ENCODE_URL_COMPONENT expressions', () => {
      expect(postgresQuery.encodeUrlComponent('text')).toBe("encode(text::bytea, 'escape')");
      expect(sqliteQuery.encodeUrlComponent('text')).toBe('text');
    });
  });

  describe('DateTime Functions', () => {
    it('should generate correct NOW expressions', () => {
      expect(postgresQuery.now()).toBe('NOW()');
      expect(sqliteQuery.now()).toBe("DATETIME('now')");
    });

    it('should generate correct TODAY expressions', () => {
      expect(postgresQuery.today()).toBe('CURRENT_DATE');
      expect(sqliteQuery.today()).toBe("DATE('now')");
    });

    it('should generate correct DATEADD expressions', () => {
      expect(postgresQuery.dateAdd('date', 'count', 'unit')).toBe(
        "date::timestamp + INTERVAL 'count unit'"
      );
      expect(sqliteQuery.dateAdd('date', 'count', 'unit')).toBe(
        "DATETIME(date, '+' || count || ' unit')"
      );
    });

    it('should generate correct DATESTR expressions', () => {
      expect(postgresQuery.datestr('date')).toBe('date::date::text');
      expect(sqliteQuery.datestr('date')).toBe('DATE(date)');
    });

    it('should generate correct DATETIME_DIFF expressions', () => {
      expect(postgresQuery.datetimeDiff('start', 'end', 'unit')).toBe(
        'EXTRACT(unit FROM end::timestamp - start::timestamp)'
      );
      expect(sqliteQuery.datetimeDiff('start', 'end', 'unit')).toBe(
        'CAST((JULIANDAY(end) - JULIANDAY(start)) AS INTEGER)'
      );
    });

    it('should generate correct DATETIME_FORMAT expressions', () => {
      expect(postgresQuery.datetimeFormat('date', 'format')).toBe(
        'TO_CHAR(date::timestamp, format)'
      );
      expect(sqliteQuery.datetimeFormat('date', 'format')).toBe('STRFTIME(format, date)');
    });

    it('should generate correct DATETIME_PARSE expressions', () => {
      expect(postgresQuery.datetimeParse('dateString', 'format')).toBe(
        'TO_TIMESTAMP(dateString, format)'
      );
      expect(sqliteQuery.datetimeParse('dateString', 'format')).toBe('DATETIME(dateString)');
    });

    it('should generate correct DAY expressions', () => {
      expect(postgresQuery.day('date')).toBe('EXTRACT(DAY FROM date::timestamp)::int');
      expect(sqliteQuery.day('date')).toBe("CAST(STRFTIME('%d', date) AS INTEGER)");
    });

    it('should generate correct FROMNOW expressions', () => {
      expect(postgresQuery.fromNow('date')).toBe('EXTRACT(EPOCH FROM (NOW() - date::timestamp))');
      expect(sqliteQuery.fromNow('date')).toBe(
        "CAST((JULIANDAY('now') - JULIANDAY(date)) * 86400 AS INTEGER)"
      );
    });

    it('should generate correct HOUR expressions', () => {
      expect(postgresQuery.hour('date')).toBe('EXTRACT(HOUR FROM date::timestamp)::int');
      expect(sqliteQuery.hour('date')).toBe("CAST(STRFTIME('%H', date) AS INTEGER)");
    });

    it('should generate correct IS_AFTER expressions', () => {
      expect(postgresQuery.isAfter('date1', 'date2')).toBe('date1::timestamp > date2::timestamp');
      expect(sqliteQuery.isAfter('date1', 'date2')).toBe('DATETIME(date1) > DATETIME(date2)');
    });

    it('should generate correct IS_BEFORE expressions', () => {
      expect(postgresQuery.isBefore('date1', 'date2')).toBe('date1::timestamp < date2::timestamp');
      expect(sqliteQuery.isBefore('date1', 'date2')).toBe('DATETIME(date1) < DATETIME(date2)');
    });

    it('should generate correct IS_SAME expressions', () => {
      expect(postgresQuery.isSame('date1', 'date2', 'unit')).toBe(
        "DATE_TRUNC('unit', date1::timestamp) = DATE_TRUNC('unit', date2::timestamp)"
      );
      expect(postgresQuery.isSame('date1', 'date2')).toBe('date1::timestamp = date2::timestamp');
      expect(sqliteQuery.isSame('date1', 'date2', 'day')).toBe(
        "STRFTIME('%Y-%m-%d', date1) = STRFTIME('%Y-%m-%d', date2)"
      );
      expect(sqliteQuery.isSame('date1', 'date2')).toBe('DATETIME(date1) = DATETIME(date2)');
    });

    it('should generate correct LAST_MODIFIED_TIME expressions', () => {
      expect(postgresQuery.lastModifiedTime()).toBe('"__last_modified_time"');
      expect(sqliteQuery.lastModifiedTime()).toBe('"__last_modified_time"');
    });

    it('should generate correct MINUTE expressions', () => {
      expect(postgresQuery.minute('date')).toBe('EXTRACT(MINUTE FROM date::timestamp)::int');
      expect(sqliteQuery.minute('date')).toBe("CAST(STRFTIME('%M', date) AS INTEGER)");
    });

    it('should generate correct MONTH expressions', () => {
      expect(postgresQuery.month('date')).toBe('EXTRACT(MONTH FROM date::timestamp)::int');
      expect(sqliteQuery.month('date')).toBe("CAST(STRFTIME('%m', date) AS INTEGER)");
    });

    it('should generate correct SECOND expressions', () => {
      expect(postgresQuery.second('date')).toBe('EXTRACT(SECOND FROM date::timestamp)::int');
      expect(sqliteQuery.second('date')).toBe("CAST(STRFTIME('%S', date) AS INTEGER)");
    });

    it('should generate correct TIMESTR expressions', () => {
      expect(postgresQuery.timestr('date')).toBe('date::time::text');
      expect(sqliteQuery.timestr('date')).toBe('TIME(date)');
    });

    it('should generate correct TONOW expressions', () => {
      expect(postgresQuery.toNow('date')).toBe('EXTRACT(EPOCH FROM (date::timestamp - NOW()))');
      expect(sqliteQuery.toNow('date')).toBe(
        "CAST((JULIANDAY(date) - JULIANDAY('now')) * 86400 AS INTEGER)"
      );
    });

    it('should generate correct WEEKNUM expressions', () => {
      expect(postgresQuery.weekNum('date')).toBe('EXTRACT(WEEK FROM date::timestamp)::int');
      expect(sqliteQuery.weekNum('date')).toBe("CAST(STRFTIME('%W', date) AS INTEGER)");
    });

    it('should generate correct WEEKDAY expressions', () => {
      expect(postgresQuery.weekday('date')).toBe('EXTRACT(DOW FROM date::timestamp)::int');
      expect(sqliteQuery.weekday('date')).toBe("CAST(STRFTIME('%w', date) AS INTEGER) + 1");
    });

    it('should generate correct WORKDAY expressions', () => {
      expect(postgresQuery.workday('start', 'days')).toBe("start::date + INTERVAL 'days days'");
      expect(sqliteQuery.workday('start', 'days')).toBe("DATE(start, '+' || days || ' days')");
    });

    it('should generate correct WORKDAY_DIFF expressions', () => {
      expect(postgresQuery.workdayDiff('start', 'end')).toBe('end::date - start::date');
      expect(sqliteQuery.workdayDiff('start', 'end')).toBe(
        'CAST((JULIANDAY(end) - JULIANDAY(start)) AS INTEGER)'
      );
    });

    it('should generate correct YEAR expressions', () => {
      expect(postgresQuery.year('date_col')).toBe('EXTRACT(YEAR FROM date_col::timestamp)::int');
      expect(sqliteQuery.year('date_col')).toBe("CAST(STRFTIME('%Y', date_col) AS INTEGER)");
    });

    it('should generate correct CREATED_TIME expressions', () => {
      expect(postgresQuery.createdTime()).toBe('"__created_time"');
      expect(sqliteQuery.createdTime()).toBe('"__created_time"');
    });
  });

  describe('Logical Functions', () => {
    it('should generate correct IF expressions', () => {
      expect(postgresQuery.if('condition', 'true_val', 'false_val')).toBe(
        'CASE WHEN condition THEN true_val ELSE false_val END'
      );
      expect(sqliteQuery.if('condition', 'true_val', 'false_val')).toBe(
        'CASE WHEN condition THEN true_val ELSE false_val END'
      );
    });

    it('should generate correct AND expressions', () => {
      expect(postgresQuery.and(['a', 'b', 'c'])).toBe('((a) AND (b) AND (c))');
      expect(sqliteQuery.and(['a', 'b', 'c'])).toBe('((a) AND (b) AND (c))');
    });

    it('should generate correct OR expressions', () => {
      expect(postgresQuery.or(['a', 'b', 'c'])).toBe('((a) OR (b) OR (c))');
      expect(sqliteQuery.or(['a', 'b', 'c'])).toBe('((a) OR (b) OR (c))');
    });

    it('should generate correct NOT expressions', () => {
      expect(postgresQuery.not('condition')).toBe('NOT (condition)');
      expect(sqliteQuery.not('condition')).toBe('NOT (condition)');
    });

    it('should generate correct XOR expressions', () => {
      expect(postgresQuery.xor(['a', 'b'])).toBe('((a) AND NOT (b)) OR (NOT (a) AND (b))');
      expect(postgresQuery.xor(['a', 'b', 'c'])).toBe(
        '(CASE WHEN a THEN 1 ELSE 0 END + CASE WHEN b THEN 1 ELSE 0 END + CASE WHEN c THEN 1 ELSE 0 END) % 2 = 1'
      );
      expect(sqliteQuery.xor(['a', 'b'])).toBe('((a) AND NOT (b)) OR (NOT (a) AND (b))');
      expect(sqliteQuery.xor(['a', 'b', 'c'])).toBe(
        '(CASE WHEN a THEN 1 ELSE 0 END + CASE WHEN b THEN 1 ELSE 0 END + CASE WHEN c THEN 1 ELSE 0 END) % 2 = 1'
      );
    });

    it('should generate correct BLANK expressions', () => {
      expect(postgresQuery.blank()).toBe("''");
      expect(sqliteQuery.blank()).toBe('NULL');
    });

    it('should generate correct ERROR expressions', () => {
      expect(postgresQuery.error('message')).toBe(
        '(SELECT pg_catalog.pg_advisory_unlock_all() WHERE FALSE)'
      );
      expect(sqliteQuery.error('message')).toBe('(1/0)');
    });

    it('should generate correct ISERROR expressions', () => {
      expect(postgresQuery.isError('value')).toBe('FALSE');
      expect(sqliteQuery.isError('value')).toBe('0');
    });

    it('should generate correct SWITCH expressions', () => {
      const cases = [
        { case: '1', result: 'one' },
        { case: '2', result: 'two' },
      ];
      expect(postgresQuery.switch('expr', cases, 'default')).toBe(
        'CASE expr WHEN 1 THEN one WHEN 2 THEN two ELSE default END'
      );
      expect(sqliteQuery.switch('expr', cases, 'default')).toBe(
        'CASE expr WHEN 1 THEN one WHEN 2 THEN two ELSE default END'
      );
    });
  });

  describe('Array Functions', () => {
    it('should generate correct COUNT expressions', () => {
      expect(postgresQuery.count(['a', 'b', 'c'])).toBe('COUNT(a, b, c)');
      expect(sqliteQuery.count(['a', 'b', 'c'])).toBe('COUNT(a, b, c)');
    });

    it('should generate correct COUNTA expressions', () => {
      expect(postgresQuery.countA(['a', 'b', 'c'])).toBe(
        'COUNT(CASE WHEN a IS NOT NULL THEN 1 END, CASE WHEN b IS NOT NULL THEN 1 END, CASE WHEN c IS NOT NULL THEN 1 END)'
      );
      expect(sqliteQuery.countA(['a', 'b', 'c'])).toBe(
        'COUNT(CASE WHEN a IS NOT NULL THEN 1 END, CASE WHEN b IS NOT NULL THEN 1 END, CASE WHEN c IS NOT NULL THEN 1 END)'
      );
    });

    it('should generate correct COUNTALL expressions', () => {
      expect(postgresQuery.countAll('value')).toBe('COUNT(*)');
      expect(sqliteQuery.countAll('value')).toBe('COUNT(*)');
    });

    it('should generate correct ARRAY_JOIN expressions', () => {
      expect(postgresQuery.arrayJoin('array', 'separator')).toBe(
        `(
      SELECT string_agg(
        CASE
          WHEN json_typeof(value) = 'array' THEN value::text
          ELSE value::text
        END,
        separator
      )
      FROM json_array_elements(array)
    )`
      );
      expect(postgresQuery.arrayJoin('array')).toBe(
        `(
      SELECT string_agg(
        CASE
          WHEN json_typeof(value) = 'array' THEN value::text
          ELSE value::text
        END,
        ','
      )
      FROM json_array_elements(array)
    )`
      );
      expect(sqliteQuery.arrayJoin('array', 'separator')).toBe(
        '(SELECT GROUP_CONCAT(value, separator) FROM json_each(array))'
      );
      expect(sqliteQuery.arrayJoin('array')).toBe(
        '(SELECT GROUP_CONCAT(value, ,) FROM json_each(array))'
      );
    });

    it('should generate correct ARRAY_UNIQUE expressions', () => {
      expect(postgresQuery.arrayUnique('array')).toBe(
        `ARRAY(
      SELECT DISTINCT value::text
      FROM json_array_elements(array)
    )`
      );
      expect(sqliteQuery.arrayUnique('array')).toBe(
        "'[' || (SELECT GROUP_CONCAT('\"' || value || '\"') FROM (SELECT DISTINCT value FROM json_each(array))) || ']'"
      );
    });

    it('should generate correct ARRAY_FLATTEN expressions', () => {
      expect(postgresQuery.arrayFlatten('array')).toBe(
        `ARRAY(
      SELECT value::text
      FROM json_array_elements(array)
    )`
      );
      expect(sqliteQuery.arrayFlatten('array')).toBe('array');
    });

    it('should generate correct ARRAY_COMPACT expressions', () => {
      expect(postgresQuery.arrayCompact('array')).toBe(
        `ARRAY(
      SELECT value::text
      FROM json_array_elements(array)
      WHERE value IS NOT NULL AND value::text != 'null'
    )`
      );
      expect(sqliteQuery.arrayCompact('array')).toBe(
        "'[' || (SELECT GROUP_CONCAT('\"' || value || '\"') FROM json_each(array) WHERE value IS NOT NULL AND value != 'null') || ']'"
      );
    });
  });

  describe('System Functions', () => {
    it('should generate correct RECORD_ID expressions', () => {
      expect(postgresQuery.recordId()).toBe('__id');
      expect(sqliteQuery.recordId()).toBe('__id');
    });

    it('should generate correct AUTONUMBER expressions', () => {
      expect(postgresQuery.autoNumber()).toBe('__auto_number');
      expect(sqliteQuery.autoNumber()).toBe('__auto_number');
    });

    it('should generate correct TEXT_ALL expressions', () => {
      expect(postgresQuery.textAll('value')).toBe('value::text');
      expect(sqliteQuery.textAll('value')).toBe('CAST(value AS TEXT)');
    });
  });

  describe('Binary Operations', () => {
    it('should generate correct arithmetic expressions', () => {
      expect(postgresQuery.add('a', 'b')).toBe('(a + b)');
      expect(postgresQuery.subtract('a', 'b')).toBe('(a - b)');
      expect(postgresQuery.multiply('a', 'b')).toBe('(a * b)');
      expect(postgresQuery.divide('a', 'b')).toBe('(a / b)');
      expect(postgresQuery.modulo('a', 'b')).toBe('(a % b)');

      expect(sqliteQuery.add('a', 'b')).toBe('(a + b)');
      expect(sqliteQuery.subtract('a', 'b')).toBe('(a - b)');
      expect(sqliteQuery.multiply('a', 'b')).toBe('(a * b)');
      expect(sqliteQuery.divide('a', 'b')).toBe('(a / b)');
      expect(sqliteQuery.modulo('a', 'b')).toBe('(a % b)');
    });

    it('should generate correct comparison expressions', () => {
      expect(postgresQuery.equal('a', 'b')).toBe('(a = b)');
      expect(postgresQuery.notEqual('a', 'b')).toBe('(a <> b)');
      expect(postgresQuery.greaterThan('a', 'b')).toBe('(a > b)');
      expect(postgresQuery.lessThan('a', 'b')).toBe('(a < b)');
      expect(postgresQuery.greaterThanOrEqual('a', 'b')).toBe('(a >= b)');
      expect(postgresQuery.lessThanOrEqual('a', 'b')).toBe('(a <= b)');

      expect(sqliteQuery.equal('a', 'b')).toBe('(a = b)');
      expect(sqliteQuery.notEqual('a', 'b')).toBe('(a <> b)');
      expect(sqliteQuery.greaterThan('a', 'b')).toBe('(a > b)');
      expect(sqliteQuery.lessThan('a', 'b')).toBe('(a < b)');
      expect(sqliteQuery.greaterThanOrEqual('a', 'b')).toBe('(a >= b)');
      expect(sqliteQuery.lessThanOrEqual('a', 'b')).toBe('(a <= b)');
    });

    it('should generate correct logical operations', () => {
      expect(postgresQuery.logicalAnd('a', 'b')).toBe('(a AND b)');
      expect(postgresQuery.logicalOr('a', 'b')).toBe('(a OR b)');
      expect(postgresQuery.bitwiseAnd('a', 'b')).toBe('(a::integer & b::integer)');

      expect(sqliteQuery.logicalAnd('a', 'b')).toBe('(a AND b)');
      expect(sqliteQuery.logicalOr('a', 'b')).toBe('(a OR b)');
      expect(sqliteQuery.bitwiseAnd('a', 'b')).toBe('(a & b)');
    });

    it('should generate correct unary operations', () => {
      expect(postgresQuery.unaryMinus('value')).toBe('(-value)');
      expect(sqliteQuery.unaryMinus('value')).toBe('(-value)');
    });
  });

  describe('Literals', () => {
    it('should generate correct string literals', () => {
      expect(postgresQuery.stringLiteral('hello')).toBe("'hello'");
      expect(sqliteQuery.stringLiteral('hello')).toBe("'hello'");
    });

    it('should generate correct string literals with escaping', () => {
      expect(postgresQuery.stringLiteral("it's")).toBe("'it''s'");
      expect(sqliteQuery.stringLiteral("it's")).toBe("'it''s'");
    });

    it('should generate correct number literals', () => {
      expect(postgresQuery.numberLiteral(42)).toBe('42');
      expect(postgresQuery.numberLiteral(3.14)).toBe('3.14');
      expect(postgresQuery.numberLiteral(-10)).toBe('-10');
      expect(sqliteQuery.numberLiteral(42)).toBe('42');
      expect(sqliteQuery.numberLiteral(3.14)).toBe('3.14');
      expect(sqliteQuery.numberLiteral(-10)).toBe('-10');
    });

    it('should generate correct boolean literals', () => {
      expect(postgresQuery.booleanLiteral(true)).toBe('TRUE');
      expect(postgresQuery.booleanLiteral(false)).toBe('FALSE');

      expect(sqliteQuery.booleanLiteral(true)).toBe('1');
      expect(sqliteQuery.booleanLiteral(false)).toBe('0');
    });

    it('should generate correct null literals', () => {
      expect(postgresQuery.nullLiteral()).toBe('NULL');
      expect(sqliteQuery.nullLiteral()).toBe('NULL');
    });
  });

  describe('Field References', () => {
    it('should generate correct field references', () => {
      expect(postgresQuery.fieldReference('field1', 'col_name')).toBe('"col_name"');
      expect(sqliteQuery.fieldReference('field1', 'col_name')).toBe('"col_name"');
    });
  });

  describe('Type Casting', () => {
    it('should generate correct type casts', () => {
      expect(postgresQuery.castToNumber('value')).toBe('value::numeric');
      expect(postgresQuery.castToString('value')).toBe('value::text');
      expect(postgresQuery.castToBoolean('value')).toBe('value::boolean');
      expect(postgresQuery.castToDate('value')).toBe('value::timestamp');

      expect(sqliteQuery.castToNumber('value')).toBe('CAST(value AS REAL)');
      expect(sqliteQuery.castToString('value')).toBe('CAST(value AS TEXT)');
      expect(sqliteQuery.castToBoolean('value')).toBe('CASE WHEN value THEN 1 ELSE 0 END');
      expect(sqliteQuery.castToDate('value')).toBe('DATETIME(value)');
    });
  });

  describe('Utility Functions', () => {
    it('should generate correct NULL checks', () => {
      expect(postgresQuery.isNull('value')).toBe('value IS NULL');
      expect(sqliteQuery.isNull('value')).toBe('value IS NULL');
    });

    it('should generate correct COALESCE expressions', () => {
      expect(postgresQuery.coalesce(['a', 'b', 'c'])).toBe('COALESCE(a, b, c)');
      expect(sqliteQuery.coalesce(['a', 'b', 'c'])).toBe('COALESCE(a, b, c)');
    });

    it('should generate correct parentheses', () => {
      expect(postgresQuery.parentheses('expression')).toBe('(expression)');
      expect(sqliteQuery.parentheses('expression')).toBe('(expression)');
    });
  });

  describe('Context Management', () => {
    it('should set and use context', () => {
      const fieldMap = new Map();
      const field1 = createFieldInstanceByVo({
        id: 'field1',
        name: 'Field 1',
        type: FieldType.SingleLineText,
        dbFieldName: 'col1',
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        options: {},
      });
      fieldMap.set('field1', field1);

      const context: IFormulaConversionContext = {
        fieldMap,
        timeZone: 'UTC',
        isGeneratedColumn: false,
      };

      postgresQuery.setContext(context);
      sqliteQuery.setContext(context);

      // Context should be available for field references and other operations
      expect(postgresQuery.fieldReference('field1', 'col1')).toBe('"col1"');
      expect(sqliteQuery.fieldReference('field1', 'col1')).toBe('"col1"');
    });
  });
});
