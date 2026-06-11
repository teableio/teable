import { BaseId, FieldName, Table, TableId, TableName } from '@teable/v2-core';
import type { SqlValueType } from '@teable/v2-formula-sql-pg';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import { describe, expect, it } from 'vitest';

import {
  type ILateralContext,
  ComputedFieldSelectExpressionVisitor,
} from './ComputedFieldSelectExpressionVisitor';

const createTestTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('FormulaVisitorTable')._unsafeUnwrap());

  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();

  return builder.build()._unsafeUnwrap();
};

const lateralStub: ILateralContext = {
  addColumn: () => {
    throw new Error('not used in formula unwrap tests');
  },
  addConditionalColumn: () => {
    throw new Error('not used in formula unwrap tests');
  },
};

const unwrapFormulaArrayToScalar = (valueSql: string, valueType: SqlValueType) => {
  const visitor = new ComputedFieldSelectExpressionVisitor(
    createTestTable(),
    't',
    lateralStub,
    new Pg16TypeValidationStrategy()
  ) as unknown as {
    unwrapFormulaArrayToScalar: (input: string, type: SqlValueType) => string;
  };

  return visitor.unwrapFormulaArrayToScalar(valueSql, valueType);
};

describe('ComputedFieldSelectExpressionVisitor formula unwrap safety', () => {
  it('normalizes NULL arrays before extracting scalar text', () => {
    const sql = unwrapFormulaArrayToScalar('NULL', 'string');

    expect(sql).not.toContain('NULL ->> 0');
    expect(sql).toContain("'[]'::jsonb");
    expect(sql).not.toContain('pg_input_is_valid');
  });

  it('keeps numeric casts while avoiding raw json operators on unknown values', () => {
    const sql = unwrapFormulaArrayToScalar('NULL', 'number');

    expect(sql).toContain('::double precision');
    expect(sql).not.toContain('NULL ->> 0');
    expect(sql).toContain('SELECT CASE');
    expect(sql).toContain('NULL::jsonb');
  });
});
