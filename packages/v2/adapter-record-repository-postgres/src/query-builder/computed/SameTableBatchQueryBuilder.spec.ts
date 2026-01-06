import {
  BaseId,
  DbFieldName,
  DbTableName,
  FieldId,
  FieldName,
  FieldType,
  FormulaExpression,
  FormulaField,
  NumberField,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import type { Kysely } from 'kysely';
import { describe, it, expect, vi } from 'vitest';

import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { SameTableBatchQueryBuilder } from './SameTableBatchQueryBuilder';

// Helper to create field IDs
const createFieldId = (id: string) => FieldId.create(id)._unsafeUnwrap();
const createFieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();

// Create a minimal mock Kysely instance
const createMockKysely = () =>
  ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as unknown as Kysely<DynamicDB>;

// Create a simple table with formula fields for testing
const createSingleFormulaTable = () => {
  const baseId = BaseId.create('bseTestBase123456')._unsafeUnwrap();
  const tableId = TableId.create('tblTestTable123456')._unsafeUnwrap();
  const tableName = TableName.create('TestTable')._unsafeUnwrap();

  const numberFieldId = createFieldId('fldNumber12345678');
  const formulaFieldId = createFieldId('fldFormula1234567');

  const numberField = NumberField.create({
    id: numberFieldId,
    name: createFieldName('Value'),
    tableId,
    isPrimary: false,
  })._unsafeUnwrap();
  numberField.setDbFieldName(DbFieldName.create('Value')._unsafeUnwrap());

  const formulaField = FormulaField.create({
    id: formulaFieldId,
    name: createFieldName('Doubled'),
    tableId,
    isPrimary: false,
    expression: FormulaExpression.create(`{${numberFieldId.toString()}} * 2`)._unsafeUnwrap(),
  })._unsafeUnwrap();
  formulaField.setDbFieldName(DbFieldName.create('Doubled')._unsafeUnwrap());

  const table = Table.builder()
    .id(tableId)
    .name(tableName)
    .baseId(baseId)
    .fields([numberField, formulaField])
    .build()
    ._unsafeUnwrap();

  table.setDbTableName(DbTableName.create('tblTestTable123456')._unsafeUnwrap());

  return { table, numberFieldId, formulaFieldId };
};

// Create a table with parallel formulas at the same level
const createParallelFormulaTable = () => {
  const baseId = BaseId.create('bseTestBase123456')._unsafeUnwrap();
  const tableId = TableId.create('tblTestTable123456')._unsafeUnwrap();
  const tableName = TableName.create('TestTable')._unsafeUnwrap();

  const valueAId = createFieldId('fldValueA12345678');
  const valueBId = createFieldId('fldValueB12345678');
  const doubledAId = createFieldId('fldDoubledA123456');
  const doubledBId = createFieldId('fldDoubledB123456');

  const valueA = NumberField.create({
    id: valueAId,
    name: createFieldName('ValueA'),
    tableId,
    isPrimary: false,
  })._unsafeUnwrap();
  valueA.setDbFieldName(DbFieldName.create('ValueA')._unsafeUnwrap());

  const valueB = NumberField.create({
    id: valueBId,
    name: createFieldName('ValueB'),
    tableId,
    isPrimary: false,
  })._unsafeUnwrap();
  valueB.setDbFieldName(DbFieldName.create('ValueB')._unsafeUnwrap());

  const doubledA = FormulaField.create({
    id: doubledAId,
    name: createFieldName('DoubledA'),
    tableId,
    isPrimary: false,
    expression: FormulaExpression.create(`{${valueAId.toString()}} * 2`)._unsafeUnwrap(),
  })._unsafeUnwrap();
  doubledA.setDbFieldName(DbFieldName.create('DoubledA')._unsafeUnwrap());

  const doubledB = FormulaField.create({
    id: doubledBId,
    name: createFieldName('DoubledB'),
    tableId,
    isPrimary: false,
    expression: FormulaExpression.create(`{${valueBId.toString()}} * 2`)._unsafeUnwrap(),
  })._unsafeUnwrap();
  doubledB.setDbFieldName(DbFieldName.create('DoubledB')._unsafeUnwrap());

  const table = Table.builder()
    .id(tableId)
    .name(tableName)
    .baseId(baseId)
    .fields([valueA, valueB, doubledA, doubledB])
    .build()
    ._unsafeUnwrap();

  table.setDbTableName(DbTableName.create('tblTestTable123456')._unsafeUnwrap());

  return { table, valueAId, valueBId, doubledAId, doubledBId };
};

describe('SameTableBatchQueryBuilder', () => {
  describe('build()', () => {
    it('returns error for empty field levels', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db);
      const { table } = createSingleFormulaTable();

      const result = builder.build({
        table,
        fieldLevels: [],
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('No field levels provided');
    });

    it('builds single-level CTE update query', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db);
      const { table, formulaFieldId } = createSingleFormulaTable();

      const result = builder.build({
        table,
        fieldLevels: [{ level: 0, fieldIds: [formulaFieldId] }],
      });

      expect(result.isOk()).toBe(true);
      const { cteNames, fieldMappings, tableName } = result._unsafeUnwrap();

      expect(cteNames).toHaveLength(1);
      expect(cteNames[0]).toBe('level_0');
      expect(fieldMappings).toHaveLength(1);
      expect(fieldMappings[0].columnName).toBe('Doubled');
      expect(fieldMappings[0].cteName).toBe('level_0');
      expect(tableName).toBe('tblTestTable123456');
    });

    it('builds parallel formulas at same level', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db);
      const { table, doubledAId, doubledBId } = createParallelFormulaTable();

      const result = builder.build({
        table,
        fieldLevels: [{ level: 0, fieldIds: [doubledAId, doubledBId] }],
      });

      expect(result.isOk()).toBe(true);
      const { cteNames, fieldMappings } = result._unsafeUnwrap();

      expect(cteNames).toHaveLength(1);
      expect(cteNames[0]).toBe('level_0');
      expect(fieldMappings).toHaveLength(2);
      expect(fieldMappings.map((m) => m.columnName).sort()).toEqual(['DoubledA', 'DoubledB']);
    });

    it('includes table schema (baseId.tableId) in generated SQL', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db);
      const { table, formulaFieldId } = createSingleFormulaTable();

      const result = builder.build({
        table,
        fieldLevels: [{ level: 0, fieldIds: [formulaFieldId] }],
      });

      expect(result.isOk()).toBe(true);
      const { tableName } = result._unsafeUnwrap();
      expect(tableName).toBe('tblTestTable123456');
    });
  });

  describe('field mappings', () => {
    it('maps each field to correct CTE and column', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db);
      const { table, doubledAId, doubledBId } = createParallelFormulaTable();

      const result = builder.build({
        table,
        fieldLevels: [{ level: 0, fieldIds: [doubledAId, doubledBId] }],
      });

      expect(result.isOk()).toBe(true);
      const { fieldMappings } = result._unsafeUnwrap();

      const mappingA = fieldMappings.find((m) => m.columnName === 'DoubledA');
      const mappingB = fieldMappings.find((m) => m.columnName === 'DoubledB');

      expect(mappingA).toBeDefined();
      expect(mappingA?.cteName).toBe('level_0');
      expect(mappingB).toBeDefined();
      expect(mappingB?.cteName).toBe('level_0');
    });
  });
});
