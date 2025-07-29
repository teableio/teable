import { FormulaQueryPostgres } from './postgres/formula-query.postgres';
import { FormulaQuerySqlite } from './sqlite/formula-query.sqlite';

describe('FormulaQuery', () => {
  describe('PostgreSQL Formula Functions', () => {
    let formulaQuery: FormulaQueryPostgres;

    beforeEach(() => {
      formulaQuery = new FormulaQueryPostgres();
    });

    it('should implement SUM function', () => {
      const result = formulaQuery.sum(['column_a', 'column_b', '10']);
      expect(result).toBe('SUM(column_a, column_b, 10)');
    });

    it('should implement CONCATENATE function', () => {
      const result = formulaQuery.concatenate(['column_a', "' - '", 'column_b']);
      expect(result).toBe("CONCAT(column_a, ' - ', column_b)");
    });

    it('should implement IF function', () => {
      const result = formulaQuery.if('column_a > 0', 'column_b', "'N/A'");
      expect(result).toBe("CASE WHEN column_a > 0 THEN column_b ELSE 'N/A' END");
    });

    it('should implement ROUND function with precision', () => {
      const result = formulaQuery.round('column_a', '2');
      expect(result).toBe('ROUND(column_a::numeric, 2::integer)');
    });

    it('should implement NOW function', () => {
      const result = formulaQuery.now();
      expect(result).toBe('NOW()');
    });

    it('should implement UPPER function', () => {
      const result = formulaQuery.upper('column_a');
      expect(result).toBe('UPPER(column_a)');
    });

    it('should implement arithmetic operations', () => {
      expect(formulaQuery.add('column_a', 'column_b')).toBe('(column_a + column_b)');
      expect(formulaQuery.subtract('column_a', 'column_b')).toBe('(column_a - column_b)');
      expect(formulaQuery.multiply('column_a', 'column_b')).toBe('(column_a * column_b)');
      expect(formulaQuery.divide('column_a', 'column_b')).toBe('(column_a / column_b)');
    });

    it('should implement comparison operations', () => {
      expect(formulaQuery.greaterThan('column_a', '0')).toBe('(column_a > 0)');
      expect(formulaQuery.equal('column_a', 'column_b')).toBe('(column_a = column_b)');
      expect(formulaQuery.notEqual('column_a', 'column_b')).toBe('(column_a <> column_b)');
    });

    it('should implement logical operations', () => {
      expect(formulaQuery.and(['condition1', 'condition2'])).toBe('(condition1 AND condition2)');
      expect(formulaQuery.or(['condition1', 'condition2'])).toBe('(condition1 OR condition2)');
      expect(formulaQuery.not('condition')).toBe('NOT (condition)');
    });

    it('should implement literal values', () => {
      expect(formulaQuery.stringLiteral('hello')).toBe("'hello'");
      expect(formulaQuery.numberLiteral(42)).toBe('42');
      expect(formulaQuery.booleanLiteral(true)).toBe('TRUE');
      expect(formulaQuery.booleanLiteral(false)).toBe('FALSE');
      expect(formulaQuery.nullLiteral()).toBe('NULL');
    });
  });

  describe('SQLite Formula Functions', () => {
    let formulaQuery: FormulaQuerySqlite;

    beforeEach(() => {
      formulaQuery = new FormulaQuerySqlite();
    });

    it('should implement SUM function', () => {
      const result = formulaQuery.sum(['column_a', 'column_b', '10']);
      expect(result).toBe('SUM(column_a, column_b, 10)');
    });

    it('should implement CONCATENATE function', () => {
      const result = formulaQuery.concatenate(['column_a', "' - '", 'column_b']);
      expect(result).toBe("(column_a || ' - ' || column_b)");
    });

    it('should implement IF function', () => {
      const result = formulaQuery.if('column_a > 0', 'column_b', "'N/A'");
      expect(result).toBe("CASE WHEN column_a > 0 THEN column_b ELSE 'N/A' END");
    });

    it('should implement ROUND function with precision', () => {
      const result = formulaQuery.round('column_a', '2');
      expect(result).toBe('ROUND(column_a, 2)');
    });

    it('should implement NOW function', () => {
      const result = formulaQuery.now();
      expect(result).toBe("DATETIME('now')");
    });

    it('should implement boolean literals correctly', () => {
      expect(formulaQuery.booleanLiteral(true)).toBe('1');
      expect(formulaQuery.booleanLiteral(false)).toBe('0');
    });
  });

  describe('Common Interface Tests', () => {
    it('should have consistent interface between PostgreSQL and SQLite', () => {
      const pgQuery = new FormulaQueryPostgres();
      const sqliteQuery = new FormulaQuerySqlite();

      // Test that both implement the same methods
      expect(typeof pgQuery.sum).toBe('function');
      expect(typeof sqliteQuery.sum).toBe('function');

      expect(typeof pgQuery.concatenate).toBe('function');
      expect(typeof sqliteQuery.concatenate).toBe('function');

      expect(typeof pgQuery.if).toBe('function');
      expect(typeof sqliteQuery.if).toBe('function');

      expect(typeof pgQuery.now).toBe('function');
      expect(typeof sqliteQuery.now).toBe('function');
    });

    it('should handle field references', () => {
      const pgQuery = new FormulaQueryPostgres();
      const sqliteQuery = new FormulaQuerySqlite();

      expect(pgQuery.fieldReference('fld1', 'column_a')).toMatchInlineSnapshot(`""column_a""`);
      expect(sqliteQuery.fieldReference('fld1', 'column_a')).toMatchInlineSnapshot(
        `"\`column_a\`"`
      );
    });

    it('should handle variables', () => {
      const pgQuery = new FormulaQueryPostgres();
      const sqliteQuery = new FormulaQuerySqlite();

      expect(pgQuery.sum(['{var1}', '1'])).toMatchInlineSnapshot(`"SUM({var1}, 1)"`);
      expect(sqliteQuery.sum(['{var1}', '1'])).toMatchInlineSnapshot(`"SUM({var1}, 1)"`);
    });

    it('should handle parentheses', () => {
      const pgQuery = new FormulaQueryPostgres();
      const sqliteQuery = new FormulaQuerySqlite();

      expect(pgQuery.parentheses('expression')).toBe('(expression)');
      expect(sqliteQuery.parentheses('expression')).toBe('(expression)');
    });
  });
});
