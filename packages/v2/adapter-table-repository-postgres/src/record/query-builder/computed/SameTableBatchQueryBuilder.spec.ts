import {
  BaseId,
  DbFieldName,
  createFormulaField,
  createNumberField,
  FieldId,
  FieldName,
  FormulaExpression,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import type { Kysely } from 'kysely';
import { describe, it, expect } from 'vitest';

import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { SameTableBatchQueryBuilder } from './SameTableBatchQueryBuilder';

// Helper to create field IDs
const createFieldId = (id: string) => FieldId.create(id)._unsafeUnwrap();
const createFieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();

// Test type validation strategy
const typeValidationStrategy = new Pg16TypeValidationStrategy();

// Create a minimal mock Kysely instance
const createMockKysely = () => {
  const executor = {
    transformQuery: (node: unknown) => node,
    compileQuery: () => ({ sql: '', parameters: [] }),
    executeQuery: async () => ({ rows: [] }),
    withPlugins: () => executor,
  };

  return {
    getExecutor: () => executor,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as Kysely<DynamicDB>;
};

// Create a simple table with formula fields for testing
const createSingleFormulaTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('TestTable')._unsafeUnwrap();
  const dbTableName = `${baseId.toString()}.${tableId.toString()}`;

  const numberFieldId = createFieldId(`fld${'n'.repeat(16)}`);
  const formulaFieldId = createFieldId(`fld${'f'.repeat(16)}`);

  const numberFieldResult = createNumberField({
    id: numberFieldId,
    name: createFieldName('Value'),
  }).andThen((field) =>
    DbFieldName.rehydrate('Value').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const formulaFieldResult = createFormulaField({
    id: formulaFieldId,
    name: createFieldName('Doubled'),
    expression: FormulaExpression.create(`{${numberFieldId.toString()}} * 2`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('Doubled').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const table = Table.builder()
    .withId(tableId)
    .withName(tableName)
    .withBaseId(baseId)
    .addFieldFromResult(numberFieldResult)
    .addFieldFromResult(formulaFieldResult)
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();

  return { table, numberFieldId, formulaFieldId, dbTableName };
};

// Create a table with parallel formulas at the same level
const createParallelFormulaTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('TestTable')._unsafeUnwrap();
  const dbTableName = `${baseId.toString()}.${tableId.toString()}`;

  const valueAId = createFieldId(`fld${'a'.repeat(16)}`);
  const valueBId = createFieldId(`fld${'b'.repeat(16)}`);
  const doubledAId = createFieldId(`fld${'c'.repeat(16)}`);
  const doubledBId = createFieldId(`fld${'d'.repeat(16)}`);

  const valueAResult = createNumberField({
    id: valueAId,
    name: createFieldName('ValueA'),
  }).andThen((field) =>
    DbFieldName.rehydrate('ValueA').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const valueBResult = createNumberField({
    id: valueBId,
    name: createFieldName('ValueB'),
  }).andThen((field) =>
    DbFieldName.rehydrate('ValueB').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const doubledAResult = createFormulaField({
    id: doubledAId,
    name: createFieldName('DoubledA'),
    expression: FormulaExpression.create(`{${valueAId.toString()}} * 2`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('DoubledA').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const doubledBResult = createFormulaField({
    id: doubledBId,
    name: createFieldName('DoubledB'),
    expression: FormulaExpression.create(`{${valueBId.toString()}} * 2`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('DoubledB').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const table = Table.builder()
    .withId(tableId)
    .withName(tableName)
    .withBaseId(baseId)
    .addFieldFromResult(valueAResult)
    .addFieldFromResult(valueBResult)
    .addFieldFromResult(doubledAResult)
    .addFieldFromResult(doubledBResult)
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();

  return { table, valueAId, valueBId, doubledAId, doubledBId, dbTableName };
};

describe('SameTableBatchQueryBuilder', () => {
  describe('build()', () => {
    it('returns error for empty field levels', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
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
      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
      const { table, formulaFieldId, dbTableName } = createSingleFormulaTable();

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
      expect(tableName).toBe(dbTableName);
    });

    it('builds parallel formulas at same level', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
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
      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
      const { table, formulaFieldId, dbTableName } = createSingleFormulaTable();

      const result = builder.build({
        table,
        fieldLevels: [{ level: 0, fieldIds: [formulaFieldId] }],
      });

      expect(result.isOk()).toBe(true);
      const { tableName } = result._unsafeUnwrap();
      expect(tableName).toBe(dbTableName);
    });
  });

  describe('field mappings', () => {
    it('maps each field to correct CTE and column', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
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
