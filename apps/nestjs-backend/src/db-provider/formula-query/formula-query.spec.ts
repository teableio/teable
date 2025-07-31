/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { FormulaQueryPostgres } from './postgres/formula-query.postgres';
import { FormulaQuerySqlite } from './sqlite/formula-query.sqlite';

describe('FormulaQuery', () => {
  describe('PostgreSQL Formula Functions', () => {
    let formulaQuery: FormulaQueryPostgres;

    beforeEach(() => {
      formulaQuery = new FormulaQueryPostgres();
    });

    describe('Numeric Functions', () => {
      it.each([
        ['sum', [['column_a', 'column_b', '10']]],
        ['average', [['column_a', 'column_b']]],
        ['max', [['column_a', 'column_b', '100']]],
        ['min', [['column_a', 'column_b', '0']]],
        ['ceiling', ['column_a']],
        ['floor', ['column_a']],
        ['even', ['column_a']],
        ['odd', ['column_a']],
        ['int', ['column_a']],
        ['abs', ['column_a']],
        ['sqrt', ['column_a']],
        ['exp', ['column_a']],
        ['log', ['column_a']],
        ['value', ['column_a']],
      ])('should implement %s function', (functionName, params) => {
        const result = (formulaQuery as any)[functionName](...params);
        expect(result).toMatchSnapshot();
      });

      it.each([
        ['round', ['column_a', '2']],
        ['round', ['column_a']],
        ['roundUp', ['column_a', '2']],
        ['roundUp', ['column_a']],
        ['roundDown', ['column_a', '2']],
        ['roundDown', ['column_a']],
        ['power', ['column_a', '2']],
        ['mod', ['column_a', '3']],
      ])('should implement %s function with parameters', (functionName, params) => {
        const result = (formulaQuery as any)[functionName](...params);
        expect(result).toMatchSnapshot();
      });
    });

    describe('Text Functions', () => {
      it.each([
        ['concatenate', [['column_a', "' - '", 'column_b']]],
        ['mid', ['column_a', '2', '5']],
        ['left', ['column_a', '5']],
        ['right', ['column_a', '3']],
        ['replace', ['column_a', '2', '3', "'new'"]],
        ['regexpReplace', ['column_a', "'pattern'", "'replacement'"]],
        ['lower', ['column_a']],
        ['upper', ['column_a']],
        ['rept', ['column_a', '3']],
        ['trim', ['column_a']],
        ['len', ['column_a']],
        ['t', ['column_a']],
        ['encodeUrlComponent', ['column_a']],
      ])('should implement %s function', (functionName, params) => {
        const result = (formulaQuery as any)[functionName](...params);
        expect(result).toMatchSnapshot();
      });

      it.each([
        ['find', ["'text'", 'column_a']],
        ['find', ["'text'", 'column_a', '5']],
        ['search', ["'text'", 'column_a']],
        ['search', ["'text'", 'column_a', '3']],
        ['substitute', ['column_a', "'old'", "'new'"]],
        ['substitute', ['column_a', "'old'", "'new'", '1']],
      ])('should implement %s function with optional parameters', (functionName, params) => {
        const result = (formulaQuery as any)[functionName](...params);
        expect(result).toMatchSnapshot();
      });
    });

    describe('Date Functions', () => {
      it.each([
        ['now', []],
        ['today', []],
        ['hour', ['column_a']],
        ['minute', ['column_a']],
        ['second', ['column_a']],
        ['day', ['column_a']],
        ['month', ['column_a']],
        ['year', ['column_a']],
        ['weekNum', ['column_a']],
        ['weekday', ['column_a']],
        ['lastModifiedTime', []],
        ['createdTime', []],
      ])('should implement %s function', (functionName, params) => {
        const result = (formulaQuery as any)[functionName](...params);
        expect(result).toMatchSnapshot();
      });

      it.each([
        ['dateAdd', ['column_a', '5', "'days'"]],
        ['datestr', ['column_a']],
        ['datetimeDiff', ['column_a', 'column_b', "'days'"]],
        ['datetimeFormat', ['column_a', "'YYYY-MM-DD'"]],
        ['datetimeParse', ['column_a', "'YYYY-MM-DD'"]],
        ['workday', ['column_a', '5']],
        ['workdayDiff', ['column_a', 'column_b']],
      ])('should implement %s function with parameters', (functionName, params) => {
        const result = (formulaQuery as any)[functionName](...params);
        expect(result).toMatchSnapshot();
      });

      it.each([
        ['isSame', ['column_a', 'column_b']],
        ['isSame', ['column_a', 'column_b', "'day'"]],
        ['isSame', ['column_a', 'column_b', "'month'"]],
        ['isSame', ['column_a', 'column_b', "'year'"]],
      ])('should implement isSame function with different units', (functionName, params) => {
        const result = (formulaQuery as any)[functionName](...params);
        expect(result).toMatchSnapshot();
      });
    });

    describe('Logical Functions', () => {
      it.each([
        ['if', ['column_a > 0', 'column_b', "'N/A'"]],
        ['and', [['condition1', 'condition2', 'condition3']]],
        ['or', [['condition1', 'condition2']]],
        ['not', ['condition']],
        ['blank', []],
        ['isError', ['column_a']],
      ])('should implement %s function', (functionName, params) => {
        const result = (formulaQuery as any)[functionName](...params);
        expect(result).toMatchSnapshot();
      });

      it.each([
        ['xor', [['condition1', 'condition2']]],
        ['xor', [['condition1', 'condition2', 'condition3']]],
      ])(
        'should implement XOR function with different parameter counts',
        (functionName, params) => {
          const result = (formulaQuery as any)[functionName](...params);
          expect(result).toMatchSnapshot();
        }
      );

      it('should implement SWITCH function', () => {
        const cases = [
          { case: '1', result: "'One'" },
          { case: '2', result: "'Two'" },
        ];
        expect(formulaQuery.switch('column_a', cases)).toMatchSnapshot();
        expect(formulaQuery.switch('column_a', cases, "'Default'")).toMatchSnapshot();
      });
    });

    describe('Array Functions', () => {
      it.each([
        ['count', [['column_a', 'column_b', 'column_c']]],
        ['countA', [['column_a', 'column_b']]],
        ['countAll', ['column_a']],
        ['arrayUnique', ['column_a']],
        ['arrayFlatten', ['column_a']],
        ['arrayCompact', ['column_a']],
      ])('should implement %s function', (functionName, params) => {
        const result = (formulaQuery as any)[functionName](...params);
        expect(result).toMatchSnapshot();
      });

      it.each([
        ['arrayJoin', ['column_a']],
        ['arrayJoin', ['column_a', "' | '"]],
      ])('should implement arrayJoin function with optional separator', (functionName, params) => {
        const result = (formulaQuery as any)[functionName](...params);
        expect(result).toMatchSnapshot();
      });
    });

    describe('System Functions', () => {
      it.each([
        ['recordId', []],
        ['autoNumber', []],
        ['textAll', ['column_a']],
      ])('should implement %s function', (functionName, params) => {
        const result = (formulaQuery as any)[functionName](...params);
        expect(result).toMatchSnapshot();
      });
    });

    describe('Type Casting and Operations', () => {
      it.each([
        ['castToNumber', ['column_a']],
        ['castToString', ['column_a']],
        ['castToBoolean', ['column_a']],
        ['castToDate', ['column_a']],
        ['add', ['column_a', 'column_b']],
        ['subtract', ['column_a', 'column_b']],
        ['multiply', ['column_a', 'column_b']],
        ['divide', ['column_a', 'column_b']],
        ['modulo', ['column_a', 'column_b']],
        ['greaterThan', ['column_a', '0']],
        ['lessThan', ['column_a', '100']],
        ['greaterThanOrEqual', ['column_a', '0']],
        ['lessThanOrEqual', ['column_a', '100']],
        ['equal', ['column_a', 'column_b']],
        ['notEqual', ['column_a', 'column_b']],
        ['logicalAnd', ['condition1', 'condition2']],
        ['logicalOr', ['condition1', 'condition2']],
        ['bitwiseAnd', ['column_a', 'column_b']],
        ['unaryMinus', ['column_a']],
        ['parentheses', ['expression']],
      ])('should implement %s operation', (functionName, params) => {
        const result = (formulaQuery as any)[functionName](...params);
        expect(result).toMatchSnapshot();
      });
    });

    describe('Literal Values', () => {
      it.each([
        ['stringLiteral', ['hello']],
        ['stringLiteral', ["it's"]],
        ['numberLiteral', [42]],
        ['numberLiteral', [-3.14]],
        ['booleanLiteral', [true]],
        ['booleanLiteral', [false]],
        ['nullLiteral', []],
      ])('should implement %s', (functionName, params) => {
        const result = (formulaQuery as any)[functionName](...params);
        expect(result).toMatchSnapshot();
      });
    });

    describe('Field References and Context', () => {
      it('should handle field references', () => {
        expect(formulaQuery.fieldReference('fld1', 'column_a')).toMatchSnapshot();
      });

      it('should set and use context', () => {
        const context = {
          fieldMap: { fld1: { columnName: 'test_column' } },
          timeZone: 'UTC',
          isGeneratedColumn: true,
        };
        formulaQuery.setContext(context);
        expect(formulaQuery.fieldReference('fld1', 'test_column')).toMatchSnapshot();
      });
    });

    describe('SQLite Formula Functions', () => {
      let formulaQuery: FormulaQuerySqlite;

      beforeEach(() => {
        formulaQuery = new FormulaQuerySqlite();
      });

      describe('All Functions', () => {
        it.each([
          // Numeric functions
          ['sum', [['column_a', 'column_b', '10']]],
          ['average', [['column_a', 'column_b']]],
          ['max', [['column_a', 'column_b', '100']]],
          ['min', [['column_a', 'column_b', '0']]],
          ['round', ['column_a', '2']],
          ['round', ['column_a']],
          ['roundUp', ['column_a', '2']],
          ['roundUp', ['column_a']],
          ['roundDown', ['column_a', '2']],
          ['roundDown', ['column_a']],
          ['ceiling', ['column_a']],
          ['floor', ['column_a']],
          ['abs', ['column_a']],
          ['sqrt', ['column_a']],
          ['power', ['column_a', '2']],
          ['exp', ['column_a']],
          ['log', ['column_a']],
          ['mod', ['column_a', '3']],

          // Text functions
          ['concatenate', [['column_a', "' - '", 'column_b']]],
          ['find', ["'text'", 'column_a']],
          ['find', ["'text'", 'column_a', '5']],
          ['search', ["'text'", 'column_a']],
          ['search', ["'text'", 'column_a', '3']],
          ['mid', ['column_a', '2', '5']],
          ['left', ['column_a', '5']],
          ['right', ['column_a', '3']],
          ['substitute', ['column_a', "'old'", "'new'"]],
          ['lower', ['column_a']],
          ['upper', ['column_a']],
          ['trim', ['column_a']],
          ['len', ['column_a']],

          // Date functions
          ['now', []],
          ['today', []],
          ['year', ['column_a']],
          ['month', ['column_a']],
          ['day', ['column_a']],

          // Logical functions
          ['if', ['column_a > 0', 'column_b', "'N/A'"]],
          ['isError', ['column_a']],

          // Array functions
          ['count', [['column_a', 'column_b']]],

          // Type casting
          ['castToNumber', ['column_a']],
          ['castToString', ['column_a']],
          ['castToBoolean', ['column_a']],
          ['castToDate', ['column_a']],

          // Field references
          ['fieldReference', ['fld1', 'column_a']],
        ])('should implement %s function for SQLite', (functionName, params) => {
          const result = (formulaQuery as any)[functionName](...params);
          expect(result).toMatchSnapshot();
        });

        it.each([
          ['booleanLiteral', [true]],
          ['booleanLiteral', [false]],
        ])('should implement boolean literals correctly for SQLite', (functionName, params) => {
          const result = (formulaQuery as any)[functionName](...params);
          expect(result).toMatchSnapshot();
        });

        it('should implement SWITCH function for SQLite', () => {
          const cases = [
            { case: '1', result: "'One'" },
            { case: '2', result: "'Two'" },
          ];
          expect(formulaQuery.switch('column_a', cases)).toMatchSnapshot();
          expect(formulaQuery.switch('column_a', cases, "'Default'")).toMatchSnapshot();
        });
      });
    });

    describe('Common Interface and Edge Cases', () => {
      it('should have consistent interface between PostgreSQL and SQLite', () => {
        const pgQuery = new FormulaQueryPostgres();
        const sqliteQuery = new FormulaQuerySqlite();

        const commonMethods = ['sum', 'concatenate', 'if', 'now'];
        commonMethods.forEach((method) => {
          expect(typeof (pgQuery as any)[method]).toBe('function');
          expect(typeof (sqliteQuery as any)[method]).toBe('function');
        });
      });

      it('should handle field references differently', () => {
        const pgQuery = new FormulaQueryPostgres();
        const sqliteQuery = new FormulaQuerySqlite();

        expect(pgQuery.fieldReference('fld1', 'column_a')).toMatchSnapshot();
        expect(sqliteQuery.fieldReference('fld1', 'column_a')).toMatchSnapshot();
      });

      it.each([
        ['PostgreSQL', () => new FormulaQueryPostgres()],
        ['SQLite', () => new FormulaQuerySqlite()],
      ])('should handle edge cases for %s', (dbType, createQuery) => {
        const query = createQuery();

        // Empty arrays
        expect(query.sum([])).toMatchSnapshot();

        // Single parameter arrays
        expect(query.sum(['column_a'])).toMatchSnapshot();

        // Special characters in string literals
        expect(query.stringLiteral("test'quote")).toMatchSnapshot();
        expect(query.stringLiteral('test"double')).toMatchSnapshot();

        // Edge cases in numeric functions
        expect(query.numberLiteral(0)).toMatchSnapshot();
        expect(query.numberLiteral(-3.14)).toMatchSnapshot();
      });

      it('should handle complex nested function calls', () => {
        const pgQuery = new FormulaQueryPostgres();
        const sqliteQuery = new FormulaQuerySqlite();

        const createNestedExpression = (query: any) =>
          query.if(
            query.greaterThan(query.sum(['a', 'b']), '100'),
            query.round(query.divide('a', 'b'), '2'),
            query.concatenate([query.upper('c'), "' - '", query.lower('d')])
          );

        expect(createNestedExpression(pgQuery)).toMatchSnapshot();
        expect(createNestedExpression(sqliteQuery)).toMatchSnapshot();
      });

      it('should handle large parameter arrays', () => {
        const pgQuery = new FormulaQueryPostgres();
        const largeArray = Array.from({ length: 50 }, (_, i) => `col_${i}`);

        const result = pgQuery.sum(largeArray);
        expect(result).toContain('SUM(');
        expect(result).toContain('col_0');
        expect(result).toContain('col_49');
      });

      it('should handle deeply nested expressions', () => {
        const pgQuery = new FormulaQueryPostgres();

        let expression = 'base';
        for (let i = 0; i < 5; i++) {
          expression = pgQuery.parentheses(expression);
        }

        expect(expression).toMatchSnapshot();
      });
    });
  });
});
