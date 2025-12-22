import { describe, it, expect } from 'vitest';
import { FunctionCallCollectorVisitor } from './function-call-collector.visitor';
import { parseFormula } from './parse-formula';

describe('FunctionCallCollectorVisitor', () => {
  const extractFunctions = (expression: string) => {
    const tree = parseFormula(expression);
    const visitor = new FunctionCallCollectorVisitor();
    return visitor.visit(tree);
  };

  it('should extract simple function calls', () => {
    const functions = extractFunctions('SUM(1, 2, 3)');
    expect(functions).toEqual([{ name: 'SUM', paramCount: 3 }]);
  });

  it('should extract nested function calls', () => {
    const functions = extractFunctions('ROUND(SQRT(16), 2)');
    expect(functions).toEqual([
      { name: 'ROUND', paramCount: 2 },
      { name: 'SQRT', paramCount: 1 },
    ]);
  });

  it('should extract multiple function calls', () => {
    const functions = extractFunctions('CONCATENATE(UPPER("hello"), " ", LOWER("WORLD"))');
    expect(functions).toEqual([
      { name: 'CONCATENATE', paramCount: 3 },
      { name: 'UPPER', paramCount: 1 },
      { name: 'LOWER', paramCount: 1 },
    ]);
  });

  it('should handle functions with no parameters', () => {
    const functions = extractFunctions('NOW()');
    expect(functions).toEqual([{ name: 'NOW', paramCount: 0 }]);
  });

  it('should handle complex nested expressions', () => {
    const functions = extractFunctions('IF(SUM(1, 2) > 2, UPPER("yes"), LOWER("no"))');
    expect(functions).toEqual([
      { name: 'IF', paramCount: 3 },
      { name: 'SUM', paramCount: 2 },
      { name: 'UPPER', paramCount: 1 },
      { name: 'LOWER', paramCount: 1 },
    ]);
  });

  it('should return empty array for expressions without functions', () => {
    const functions = extractFunctions('1 + 2 * 3');
    expect(functions).toEqual([]);
  });

  it('should return empty array for simple literals', () => {
    expect(extractFunctions('42')).toEqual([]);
    expect(extractFunctions('"hello"')).toEqual([]);
    expect(extractFunctions('true')).toEqual([]);
  });

  it('should handle functions in binary operations', () => {
    const functions = extractFunctions('SUM(1, 2) + MAX(3, 4)');
    expect(functions).toEqual([
      { name: 'SUM', paramCount: 2 },
      { name: 'MAX', paramCount: 2 },
    ]);
  });

  it('should handle functions with field references', () => {
    const functions = extractFunctions('CONCATENATE({field1}, UPPER({field2}))');
    expect(functions).toEqual([
      { name: 'CONCATENATE', paramCount: 2 },
      { name: 'UPPER', paramCount: 1 },
    ]);
  });
});
