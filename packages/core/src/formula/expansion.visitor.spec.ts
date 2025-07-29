/* eslint-disable sonarjs/no-duplicate-string */
import { describe, it, expect } from 'vitest';
import { FormulaFieldCore } from '../models/field/derivate/formula.field';
import { FormulaExpansionVisitor, type IFieldExpansionMap } from './expansion.visitor';

describe('FormulaExpansionVisitor', () => {
  const parseAndExpand = (expression: string, expansionMap: IFieldExpansionMap): string => {
    const tree = FormulaFieldCore.parse(expression);
    const visitor = new FormulaExpansionVisitor(expansionMap);
    visitor.visit(tree);
    return visitor.getResult();
  };

  describe('basic field reference expansion', () => {
    it('should expand a single field reference', () => {
      const expansionMap = {
        field1: 'expanded_field1',
      };

      const result = parseAndExpand('{field1}', expansionMap);
      expect(result).toBe('expanded_field1');
    });

    it('should expand field references in expressions', () => {
      const expansionMap = {
        field1: '(base_field + 10)',
      };

      const result = parseAndExpand('{field1} * 2', expansionMap);
      expect(result).toBe('(base_field + 10) * 2');
    });

    it('should expand multiple field references', () => {
      const expansionMap = {
        field1: 'expanded_field1',
        field2: 'expanded_field2',
      };

      const result = parseAndExpand('{field1} + {field2}', expansionMap);
      expect(result).toBe('expanded_field1 + expanded_field2');
    });
  });

  describe('complex expressions', () => {
    it('should handle nested parentheses in expansions', () => {
      const expansionMap = {
        field1: '((base + 5) * 2)',
        field2: '(other - 1)',
      };

      const result = parseAndExpand('({field1} + {field2}) / 3', expansionMap);
      expect(result).toBe('(((base + 5) * 2) + (other - 1)) / 3');
    });

    it('should handle function calls with expanded fields', () => {
      const expansionMap = {
        field1: 'SUM(column1)',
        field2: 'AVG(column2)',
      };

      const result = parseAndExpand('MAX({field1}, {field2})', expansionMap);
      expect(result).toBe('MAX(SUM(column1), AVG(column2))');
    });

    it('should handle string literals mixed with field references', () => {
      const expansionMap = {
        field1: 'user_name',
      };

      const result = parseAndExpand('"Hello " + {field1} + "!"', expansionMap);
      expect(result).toBe('"Hello " + user_name + "!"');
    });
  });

  describe('edge cases', () => {
    it('should preserve field references without expansions', () => {
      const expansionMap = {
        field1: 'expanded_field1',
      };

      const result = parseAndExpand('{field1} + {field2}', expansionMap);
      expect(result).toBe('expanded_field1 + {field2}');
    });

    it('should handle empty expansion map', () => {
      const expansionMap = {};

      const result = parseAndExpand('{field1} + {field2}', expansionMap);
      expect(result).toBe('{field1} + {field2}');
    });

    it('should handle expressions without field references', () => {
      const expansionMap = {
        field1: 'expanded_field1',
      };

      const result = parseAndExpand('1 + 2 * 3', expansionMap);
      expect(result).toBe('1 + 2 * 3');
    });

    it('should handle field references in complex nested expressions', () => {
      const expansionMap = {
        a: '(x + y)',
        b: '(z * 2)',
      };

      const result = parseAndExpand('IF({a} > 0, {b}, -{b})', expansionMap);
      expect(result).toBe('IF((x + y) > 0, (z * 2), -(z * 2))');
    });
  });

  describe('visitor reuse', () => {
    it('should allow visitor reuse with reset', () => {
      const visitor = new FormulaExpansionVisitor({ field1: 'expanded' });

      // First use
      const tree1 = FormulaFieldCore.parse('{field1} + 1');
      visitor.visit(tree1);
      const result1 = visitor.getResult();
      expect(result1).toBe('expanded + 1');

      // Reset and reuse
      visitor.reset();
      const tree2 = FormulaFieldCore.parse('{field1} * 2');
      visitor.visit(tree2);
      const result2 = visitor.getResult();
      expect(result2).toBe('expanded * 2');
    });
  });

  describe('real-world formula expansion scenarios', () => {
    it('should handle the JSDoc example scenario', () => {
      // Simulates the scenario described in FormulaExpansionService JSDoc
      const expansionMap = {
        field2: '({field1} + 10)',
      };

      const result = parseAndExpand('{field2} * 2', expansionMap);
      expect(result).toBe('({field1} + 10) * 2');
    });

    it('should handle nested formula expansion', () => {
      // field1 -> field2 -> field3 expansion chain
      const expansionMap = {
        field2: '({field1} + 10)',
        field3: '(({field1} + 10) * 2)',
      };

      const result = parseAndExpand('{field3} + 5', expansionMap);
      expect(result).toBe('(({field1} + 10) * 2) + 5');
    });
  });
});
