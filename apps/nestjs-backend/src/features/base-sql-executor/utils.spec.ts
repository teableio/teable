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
  });
});
