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
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, it, expect } from 'vitest';

import { UpdateFromSelectBuilder } from '../../computed/UpdateFromSelectBuilder';
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

const createCompileKysely = () =>
  new Kysely<DynamicDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

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

// Create a table with two identical formulas in one level and a dependent formula in next level.
const createDuplicateFormulaChainTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('DupFormulaTable')._unsafeUnwrap();

  const valueId = createFieldId(`fld${'e'.repeat(16)}`);
  const sameAId = createFieldId(`fld${'f'.repeat(16)}`);
  const sameBId = createFieldId(`fld${'g'.repeat(16)}`);
  const chainId = createFieldId(`fld${'h'.repeat(16)}`);

  const valueResult = createNumberField({
    id: valueId,
    name: createFieldName('Value'),
  }).andThen((field) =>
    DbFieldName.rehydrate('Value').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const sameAResult = createFormulaField({
    id: sameAId,
    name: createFieldName('SameA'),
    expression: FormulaExpression.create(`{${valueId.toString()}} * 2 + 1`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('SameA').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const sameBResult = createFormulaField({
    id: sameBId,
    name: createFieldName('SameB'),
    expression: FormulaExpression.create(`{${valueId.toString()}} * 2 + 1`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('SameB').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const chainResult = createFormulaField({
    id: chainId,
    name: createFieldName('Chain'),
    expression: FormulaExpression.create(`{${sameAId.toString()}} + 10`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('Chain').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const table = Table.builder()
    .withId(tableId)
    .withName(tableName)
    .withBaseId(baseId)
    .addFieldFromResult(valueResult)
    .addFieldFromResult(sameAResult)
    .addFieldFromResult(sameBResult)
    .addFieldFromResult(chainResult)
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();

  return { table, sameAId, sameBId, chainId };
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

  describe('CSE', () => {
    it('deduplicates identical formulas within a level using lateral CSE binding', () => {
      const db = createCompileKysely();
      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
      const { table, sameAId, sameBId, chainId } = createDuplicateFormulaChainTable();

      const result = builder.build({
        table,
        fieldLevels: [
          { level: 0, fieldIds: [sameAId, sameBId] },
          { level: 1, fieldIds: [chainId] },
        ],
      });

      expect(result.isOk()).toBe(true);
      const updateBuilder = new UpdateFromSelectBuilder(db);
      const updateResult = updateBuilder.build({
        table,
        fieldIds: [sameAId, sameBId, chainId],
        selectQuery: result._unsafeUnwrap().selectQuery,
      });

      expect(updateResult.isOk()).toBe(true);
      const sqlText = updateResult._unsafeUnwrap().sql;

      expect(sqlText).toContain('CROSS JOIN LATERAL');
      expect(sqlText).toContain('"__cse"."__cse_0" as "SameA"');
      expect(sqlText).toContain('"__cse"."__cse_0" as "SameB"');
      expect((sqlText.match(/as "__cse_0"/g) ?? []).length).toBe(1);
      expect(sqlText).toMatchInlineSnapshot(`
        "update "bseaaaaaaaaaaaaaaaa"."tblcccccccccccccccc" as "u" set "__version" = "u"."__version" + 1, "SameA" = "c"."__set_SameA", "SameB" = "c"."__set_SameB", "Chain" = "c"."__set_Chain" from (select "c_src"."__id" as "__id", CASE
            WHEN ("c_src"."SameA") IS NULL THEN NULL
            WHEN BTRIM(("c_src"."SameA")::text) ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
              THEN BTRIM(("c_src"."SameA")::text)::double precision
            ELSE NULL
          END as "__set_SameA", CASE
            WHEN ("c_src"."SameB") IS NULL THEN NULL
            WHEN BTRIM(("c_src"."SameB")::text) ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
              THEN BTRIM(("c_src"."SameB")::text)::double precision
            ELSE NULL
          END as "__set_SameB", CASE
            WHEN ("c_src"."Chain") IS NULL THEN NULL
            WHEN BTRIM(("c_src"."Chain")::text) ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
              THEN BTRIM(("c_src"."Chain")::text)::double precision
            ELSE NULL
          END as "__set_Chain" from WITH "level_0" AS (SELECT "t"."__id", "__cse"."__cse_0" as "SameA", "__cse"."__cse_0" as "SameB" FROM "bseaaaaaaaaaaaaaaaa.tblcccccccccccccccc" AS "t" CROSS JOIN LATERAL (SELECT ((COALESCE(((COALESCE(("t"."Value")::double precision, 0) * COALESCE((2)::double precision, 0)))::double precision, 0) + COALESCE((1)::double precision, 0))) as "__cse_0") AS "__cse"), "level_1" AS (SELECT "t"."__id", ((COALESCE(((("level_0"."SameA")::text)::text), '') || COALESCE((((10)::text)::text), ''))) as "Chain" FROM "bseaaaaaaaaaaaaaaaa.tblcccccccccccccccc" AS "t" JOIN "level_0" ON "t"."__id" = "level_0"."__id") SELECT u."__id", "level_0"."SameA" as "SameA", "level_0"."SameB" as "SameB", "level_1"."Chain" as "Chain" FROM "bseaaaaaaaaaaaaaaaa.tblcccccccccccccccc" AS u, "level_0", "level_1" WHERE u."__id" = "level_0"."__id" AND u."__id" = "level_1"."__id" as "c_src") as "c" where "u"."__id" = "c"."__id" and ("u"."SameA" IS DISTINCT FROM "c"."__set_SameA" OR "u"."SameB" IS DISTINCT FROM "c"."__set_SameB" OR "u"."Chain" IS DISTINCT FROM "c"."__set_Chain")"
      `);
    });
  });
});
