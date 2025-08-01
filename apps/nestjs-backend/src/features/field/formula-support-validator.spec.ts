import { GeneratedColumnQuerySupportValidatorPostgres } from '../../db-provider/generated-column-query/generated-column-query.interface';
import { GeneratedColumnQuerySupportValidatorSqlite } from '../../db-provider/generated-column-query/generated-column-query.interface';
import { FormulaSupportValidator } from './formula-support-validator';

describe('FormulaSupportValidator', () => {
  let postgresValidator: FormulaSupportValidator;
  let sqliteValidator: FormulaSupportValidator;

  beforeEach(() => {
    const postgresSupport = new GeneratedColumnQuerySupportValidatorPostgres();
    const sqliteSupport = new GeneratedColumnQuerySupportValidatorSqlite();

    postgresValidator = new FormulaSupportValidator(postgresSupport);
    sqliteValidator = new FormulaSupportValidator(sqliteSupport);
  });

  describe('Basic Formula Support', () => {
    it('should support simple literals', () => {
      expect(postgresValidator.validateFormula('42')).toBe(true);
      expect(postgresValidator.validateFormula('"hello"')).toBe(true);
      expect(postgresValidator.validateFormula('true')).toBe(true);

      expect(sqliteValidator.validateFormula('42')).toBe(true);
      expect(sqliteValidator.validateFormula('"hello"')).toBe(true);
      expect(sqliteValidator.validateFormula('true')).toBe(true);
    });

    it('should support basic arithmetic', () => {
      expect(postgresValidator.validateFormula('1 + 2')).toBe(true);
      expect(postgresValidator.validateFormula('10 - 5')).toBe(true);
      expect(postgresValidator.validateFormula('3 * 4')).toBe(true);

      expect(sqliteValidator.validateFormula('1 + 2')).toBe(true);
      expect(sqliteValidator.validateFormula('10 - 5')).toBe(true);
      expect(sqliteValidator.validateFormula('3 * 4')).toBe(true);
    });

    it('should handle invalid formulas gracefully', () => {
      // Empty string is actually valid (no functions to validate)
      expect(postgresValidator.validateFormula('')).toBe(true);
      expect(postgresValidator.validateFormula('INVALID_SYNTAX(')).toBe(false);

      expect(sqliteValidator.validateFormula('')).toBe(true);
      expect(sqliteValidator.validateFormula('INVALID_SYNTAX(')).toBe(false);
    });

    it('should support basic functions', () => {
      expect(postgresValidator.validateFormula('SUM(1, 2, 3)')).toBe(true);
      expect(postgresValidator.validateFormula('UPPER("hello")')).toBe(true);
      expect(postgresValidator.validateFormula('NOW()')).toBe(true);

      expect(sqliteValidator.validateFormula('SUM(1, 2, 3)')).toBe(true);
      expect(sqliteValidator.validateFormula('UPPER("hello")')).toBe(true);
      expect(sqliteValidator.validateFormula('NOW()')).toBe(true);
    });

    it('should reject unsupported functions', () => {
      // Both databases should reject array functions
      expect(postgresValidator.validateFormula('ARRAY_JOIN([1, 2], ",")')).toBe(false);
      expect(sqliteValidator.validateFormula('ARRAY_JOIN([1, 2], ",")')).toBe(false);

      // SQLite should reject advanced math functions
      expect(sqliteValidator.validateFormula('SQRT(16)')).toBe(false);
      expect(postgresValidator.validateFormula('SQRT(16)')).toBe(true);
    });

    it('should handle nested functions', () => {
      expect(postgresValidator.validateFormula('ROUND(SUM(1, 2, 3), 2)')).toBe(true);
      expect(sqliteValidator.validateFormula('ROUND(SUM(1, 2, 3), 2)')).toBe(true);

      // Should reject if any nested function is unsupported
      expect(postgresValidator.validateFormula('ROUND(ARRAY_JOIN([1, 2], ","), 2)')).toBe(false);
      expect(sqliteValidator.validateFormula('ROUND(SQRT(16), 2)')).toBe(false);
    });
  });
});
