import { DriverClient } from '@teable/core';
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
  });
});
