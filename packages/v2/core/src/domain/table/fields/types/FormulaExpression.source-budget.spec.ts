import { describe, expect, it } from 'vitest';

import { FieldId } from '../FieldId';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';
import { FormulaExpression } from './FormulaExpression';

const sourceBudget = { astDepth: 64, visitedNodes: 32768, policyVersion: 1 };

describe('FormulaExpression source budget', () => {
  it('rejects recursive source during creation without entering the parser', () => {
    const result = FormulaExpression.create('-'.repeat(10000) + '1', sourceBudget);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe('validation.limit.formula_compile_depth_max');
    expect(error.details).toEqual({
      metric: 'astDepth',
      attempted: 65,
      max: 64,
      policyVersion: 1,
    });
  });

  it('retains the budget through deferred parsing and all recursive visitors', () => {
    const source = Array.from({ length: 128 }, () => '1').join('+');
    const expression = FormulaExpression.create(source, sourceBudget)._unsafeUnwrap();
    for (const result of [
      expression.getReferencedFieldIds(),
      expression.hasLastModifiedTimeParams(),
      expression.getParsedValueType([]),
    ]) {
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe('validation.limit.formula_compile_depth_max');
      expect(JSON.stringify(error)).not.toContain(source);
    }
  });

  it('allows retained historical definitions to parse without newly enforcing limits', () => {
    const source = Array.from({ length: 128 }, () => '1').join('+');
    const retained = FormulaExpression.create(source)._unsafeUnwrap();
    expect(retained.getReferencedFieldIds()._unsafeUnwrap()).toEqual([]);
    expect(retained.getParsedValueType([])._unsafeUnwrap().cellValueType.toString()).toBe('number');
    expect(retained.toString()).toBe(source);
  });

  it('preserves normal type inference with a wide budget', () => {
    const id = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
    const expression = FormulaExpression.create(
      `IF({${id.toString()}} > 0, -({${id.toString()}} + 1), 0)`,
      { ...sourceBudget, astDepth: 256 }
    )._unsafeUnwrap();
    const result = expression
      .getParsedValueType([
        {
          id,
          valueType: {
            cellValueType: CellValueType.number(),
            isMultipleCellValue: CellValueMultiplicity.single(),
          },
        },
      ])
      ._unsafeUnwrap();
    expect(result.cellValueType.toString()).toBe('number');
    expect(result.isMultipleCellValue.toBoolean()).toBe(false);
    expect(
      expression
        .getReferencedFieldIds()
        ._unsafeUnwrap()
        .map((field) => field.toString())
    ).toEqual([id.toString()]);
  });

  it('does not let a mutable caller configuration relax a deferred AST check', () => {
    const limits = { ...sourceBudget };
    const expression = FormulaExpression.create(
      Array.from({ length: 128 }, () => '1').join('+'),
      limits
    )._unsafeUnwrap();
    limits.astDepth = 1024;
    expect(expression.getParsedValueType([])._unsafeUnwrapErr().code).toBe(
      'validation.limit.formula_compile_depth_max'
    );
  });

  it('reports shallow node exhaustion separately from depth', () => {
    const result = FormulaExpression.create('SUM(1,2,3,4,5)', {
      ...sourceBudget,
      visitedNodes: 4,
    });
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_nodes_max');
  });
});
