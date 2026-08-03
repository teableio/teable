/* eslint-disable sonarjs/no-duplicate-string */
import { DriverClient } from '@teable/core';
import { CustomHttpException } from '../../custom.exception';
import { validateRoleOperations, checkTableAccess } from './utils';

describe('base sql executor utils', () => {
  describe('validateRoleOperations', () => {
    it('should throw an error if the sql contains set role', () => {
      expect(() => validateRoleOperations('set role xxx')).toThrow();
    });

    it('should throw an error if the sql contains set role with semicolon', () => {
      expect(() => validateRoleOperations('set role xxx;')).toThrow();
    });

    it('should throw an error if the sql contains set local role', () => {
      expect(() => validateRoleOperations('set local role xxx')).toThrow();
    });

    it('should throw an error if the sql contains set session role', () => {
      expect(() => validateRoleOperations('set session role xxx')).toThrow();
    });

    it('should throw an error if the sql contains set role with line break', () => {
      expect(() =>
        validateRoleOperations(`set 
        role xxx`)
      ).toThrow();
    });

    it('should throw an error if the sql contains set role with line break', () => {
      expect(() =>
        validateRoleOperations(`set 
        
          \t role xxx`)
      ).toThrow();
    });

    it('should throw an error if the sql contains reset role', () => {
      expect(() => validateRoleOperations('reset role')).toThrow();
    });

    it('should throw an error if the sql contains set session', () => {
      expect(() => validateRoleOperations('set session')).toThrow();
    });

    it('should not throw an error if the sql does not contain set role', () => {
      expect(() => validateRoleOperations('select * from users')).not.toThrow();
    });

    it('should not throw an error if the sql contains set role in the beginning and end with whitespace', () => {
      expect(() =>
        validateRoleOperations("select * from users where name = 'set role'")
      ).not.toThrow();
    });
  });

  describe('checkTableAccess', () => {
    it('check table access', () => {
      const sql = 'with a as (select * from b) select * from a where name = (select * from c)';
      checkTableAccess(sql, {
        tableNames: ['b', 'c'],
        database: DriverClient.Pg,
      });
      checkTableAccess(sql, {
        tableNames: ['a', 'b', 'c'],
        database: DriverClient.Pg,
      });
      expect(() =>
        checkTableAccess(sql, {
          tableNames: ['a', 'c'],
          database: DriverClient.Pg,
        })
      ).toThrow();
    });

    it('check table access with pg schema', () => {
      const sql = 'select * from "bsexxXxxxxx"."shop_order"';
      checkTableAccess(sql, {
        tableNames: ['bsexxXxxxxx.shop_order'],
        database: DriverClient.Pg,
      });
    });

    it('deep with', () => {
      const sql = 'with a as (with b as (select * from c) select * from b) select * from a';
      checkTableAccess(sql, {
        tableNames: ['c'],
        database: DriverClient.Pg,
      });
    });

    it('should report invalid table names when using display name instead of db table name', () => {
      const sql = 'SELECT "Biao_Ti" FROM "bseXXX"."xxx" ORDER BY "Ri_Qi" DESC LIMIT 1';
      expect(() =>
        checkTableAccess(sql, {
          tableNames: ['bseXXX.actual_db_table_name'],
          database: DriverClient.Pg,
        })
      ).toThrow(/Table 'xxx' not found/);
    });

    it('error message shows the correct "schema"."table" example when dbTableName was misused', () => {
      const sql = 'SELECT count(*) FROM "bseXXX"."bseXXX.tblYYY"';
      expect(() =>
        checkTableAccess(sql, {
          tableNames: ['bseXXX.tblYYY'],
          database: DriverClient.Pg,
        })
      ).toThrow(/FROM "bseXXX"\."tblYYY"/);
    });

    it('error message does not enumerate valid table refs (avoid leaking base table list)', () => {
      const sql = 'SELECT count(*) FROM "bseXXX"."bseXXX.tblYYY"';
      expect(() =>
        checkTableAccess(sql, {
          tableNames: ['bseXXX.tblYYY', 'bseXXX.Biao_Ge_5', 'bseXXX.Issue_20management'],
          database: DriverClient.Pg,
        })
      ).toThrow(
        // Should NOT leak the other table names in the base
        expect.objectContaining({
          message: expect.not.stringContaining('Biao_Ge_5'),
        })
      );
    });

    it('should throw CustomHttpException for SQL syntax errors instead of SyntaxError', () => {
      const invalidSql = 'SELEC * FORM users';
      expect(() =>
        checkTableAccess(invalidSql, {
          tableNames: ['users'],
          database: DriverClient.Pg,
        })
      ).toThrow(CustomHttpException);
    });

    it('correctly-split "schema"."table" form passes the whitelist', () => {
      const sql = 'SELECT count(*) FROM "bseXXX"."tblYYY"';
      expect(() =>
        checkTableAccess(sql, {
          tableNames: ['bseXXX.tblYYY'],
          database: DriverClient.Pg,
        })
      ).not.toThrow();
    });

    it.each([
      'SELECT count(*) FROM "bseXXX"."tblYYY"',
      'SELECT sum("amount") FROM "bseXXX"."tblYYY"',
      'SELECT abs("amount") FROM "bseXXX"."tblYYY"',
      'SELECT round("amount", 2) FROM "bseXXX"."tblYYY"',
      'SELECT floor("amount") FROM "bseXXX"."tblYYY"',
      'SELECT ceil("amount") FROM "bseXXX"."tblYYY"',
      'SELECT ceiling("amount") FROM "bseXXX"."tblYYY"',
      'SELECT lower("name") FROM "bseXXX"."tblYYY"',
      'SELECT replace("name", \'a\', \'b\') FROM "bseXXX"."tblYYY"',
      'SELECT regexp_replace("name", \'a\', \'b\') FROM "bseXXX"."tblYYY"',
      'SELECT substring("name" from 1 for 3) FROM "bseXXX"."tblYYY"',
      'SELECT substr("name", 1, 3) FROM "bseXXX"."tblYYY"',
      'SELECT concat("first_name", "last_name") FROM "bseXXX"."tblYYY"',
      'SELECT concat_ws(\' \', "first_name", "last_name") FROM "bseXXX"."tblYYY"',
      'SELECT split_part("name", \'/\', 1) FROM "bseXXX"."tblYYY"',
      'SELECT coalesce("name", \'unknown\') FROM "bseXXX"."tblYYY"',
      'SELECT to_char("created_time", \'YYYY-MM-DD\') FROM "bseXXX"."tblYYY"',
      'SELECT extract(year from "created_time") FROM "bseXXX"."tblYYY"',
      'SELECT json_extract_path_text("payload"::json, \'name\') FROM "bseXXX"."tblYYY"',
    ])('allows explicitly permitted function in %s', (sql) => {
      expect(() =>
        checkTableAccess(sql, {
          tableNames: ['bseXXX.tblYYY'],
          database: DriverClient.Pg,
        })
      ).not.toThrow();
    });

    it.each([
      [
        "SELECT query_to_xml('SELECT rolname FROM pg_catalog.pg_roles', true, false, '')",
        'query_to_xml',
      ],
      [
        "SELECT query_to_xmlschema('SELECT relname FROM pg_catalog.pg_class', true, false, '')",
        'query_to_xmlschema',
      ],
      [
        "SELECT query_to_xml_and_xmlschema('SELECT table_name FROM information_schema.tables', true, false, '')",
        'query_to_xml_and_xmlschema',
      ],
      ["SELECT ts_stat('SELECT to_tsvector(''simple'', ''abc'')')", 'ts_stat'],
      ["SELECT set_config('statement_timeout','0',true)", 'set_config'],
      ['SELECT lo_create(0)', 'lo_create'],
      ["SELECT lo_from_bytea(0, decode('414243','hex'))", 'lo_from_bytea'],
      ['SELECT pg_try_advisory_lock(123456789)', 'pg_try_advisory_lock'],
      ['SELECT pg_advisory_unlock_all()', 'pg_advisory_unlock_all'],
      [
        "WITH n AS (SELECT pg_notify('cuppy_probe', 'blackbox')) SELECT 'ok' AS result FROM n",
        'pg_notify',
      ],
      ["SELECT pg_logical_emit_message(false, 'cuppy_probe', 'hello')", 'pg_logical_emit_message'],
      ['SELECT pg_export_snapshot()', 'pg_export_snapshot'],
      ['SELECT pg_lock_status()', 'pg_lock_status'],
      ['SELECT pg_control_system()', 'pg_control_system'],
      ['SELECT pg_current_wal_lsn()', 'pg_current_wal_lsn'],
      ['SELECT pg_database_size(current_database())', 'pg_database_size'],
      ['SELECT version()', 'version'],
      ["SELECT pg_catalog.pg_notify('cuppy_probe', 'blackbox')", 'pg_notify'],
    ])('blocks unapproved function %s', (sql, functionName) => {
      expect(() =>
        checkTableAccess(sql, {
          tableNames: [],
          database: DriverClient.Pg,
        })
      ).toThrow(new RegExp(`function ${functionName}`));
    });
  });
});
