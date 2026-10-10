import { describe, expect, it } from 'vitest';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { FormulaExpression } from '../domain/table/fields/types/FormulaExpression';
import { FormulaField } from '../domain/table/fields/types/FormulaField';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { CreateFieldCommand } from './CreateFieldCommand';
import { CreateTableCommand } from './CreateTableCommand';
import { parseUpdateFieldSpec } from './TableFieldUpdateSpecs';

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
  config: { formulaSourceBudget: { astDepth: 3, visitedNodes: 100, policyVersion: 1 } },
};
const nested = 'ABS(ABS(ABS(ABS(1))))';

describe('formula command source admission', () => {
  it('rejects nested and unary sources before table command inference', () => {
    for (const expression of ['('.repeat(1500) + '1' + ')'.repeat(1500), '-'.repeat(1500) + '1']) {
      const result = CreateTableCommand.create({
        baseId: BaseId.generate()._unsafeUnwrap().toString(),
        name: 'Guarded',
        fields: [{ type: 'formula', name: 'Formula', options: { expression } }],
      });
      expect(result._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_depth_max');
    }
  });
  it('rejects short sources with deep reference expansion before dependency sorting', () => {
    const builder = Table.builder()
      .withBaseId(BaseId.generate()._unsafeUnwrap())
      .withName(TableName.create('Reference depth')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    const ids = Array.from({ length: 5 }, () => FieldId.generate()._unsafeUnwrap());
    for (let index = 0; index < ids.length; index++) {
      const source = index === 0 ? '1' : `{${ids[index - 1].toString()}}`;
      builder
        .field()
        .formula()
        .withId(ids[index])
        .withName(FieldName.create(`Formula ${index}`)._unsafeUnwrap())
        .withExpression(
          FormulaExpression.create(source, {
            astDepth: 64,
            visitedNodes: 100,
            referenceDepth: 2,
            policyVersion: 1,
          })._unsafeUnwrap()
        )
        .done();
    }
    builder.view().defaultGrid().done();
    expect(builder.build()._unsafeUnwrapErr().code).toBe(
      'validation.limit.formula_reference_depth_max'
    );
  });

  it('uses injected source policy during create field reference discovery', () => {
    const command = CreateFieldCommand.create({
      baseId: BaseId.generate()._unsafeUnwrap().toString(),
      tableId: TableId.generate()._unsafeUnwrap().toString(),
      field: { type: 'formula', name: 'Formula', options: { expression: nested } },
    })._unsafeUnwrap();
    expect(command.foreignTableReferences(context)._unsafeUnwrapErr().code).toBe(
      'validation.limit.formula_compile_depth_max'
    );
  });

  it('does not readmit an unchanged legacy source, including full no-op update payloads', () => {
    const field = FormulaField.create({
      id: FieldId.generate()._unsafeUnwrap(),
      name: FieldName.create('Legacy')._unsafeUnwrap(),
      expression: FormulaExpression.create(nested)._unsafeUnwrap(),
    })._unsafeUnwrap();
    const noOp = parseUpdateFieldSpec(
      field,
      { options: { expression: nested } },
      { executionContext: context }
    )._unsafeUnwrap();
    expect(noOp.buildSpecs(field)._unsafeUnwrap()).toEqual([]);
    expect(
      parseUpdateFieldSpec(
        field,
        { options: { expression: nested.replace('1', '2') } },
        { executionContext: context }
      )._unsafeUnwrapErr().code
    ).toBe('validation.limit.formula_compile_depth_max');
    expect(
      parseUpdateFieldSpec(
        field,
        { options: { timeZone: 'Asia/Shanghai' } },
        { executionContext: context }
      )._unsafeUnwrapErr().code
    ).toBe('validation.limit.formula_compile_depth_max');
    expect(field.formulaSafetyVersion()._unsafeUnwrap()).toBeUndefined();
  });

  it('consults the injected pure policy before numeric fallback ceilings', () => {
    const policyContext: IExecutionContext = {
      ...context,
      config: {
        formulaSourceBudget: {
          astDepth: 64,
          visitedNodes: 100,
          policyVersion: 1,
          check: (metric, attempted) =>
            metric === 'astDepth' && attempted > 1 ? { max: 1 } : undefined,
        },
      },
    };
    const result = CreateTableCommand.create(
      {
        baseId: BaseId.generate()._unsafeUnwrap().toString(),
        name: 'Policy',
        fields: [{ type: 'formula', name: 'Formula', options: { expression: 'ABS(1)' } }],
      },
      { executionContext: policyContext }
    );
    expect(result._unsafeUnwrapErr().details).toMatchObject({
      metric: 'astDepth',
      max: 1,
      policyVersion: 1,
    });
  });
});
