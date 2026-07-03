import {
  BaseId,
  DbFieldName,
  createCreatedByField,
  createFormulaField,
  createLastModifiedByField,
  createNumberField,
  FieldId,
  FieldName,
  FormulaExpression,
  LinkFieldConfig,
  LookupOptions,
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
import { describe, expect, it } from 'vitest';

import { UpdateFromSelectBuilder } from '../../computed/UpdateFromSelectBuilder';
import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { SameTableBatchQueryBuilder } from './SameTableBatchQueryBuilder';

// Helper to create field IDs
const createFieldId = (id: string) => FieldId.create(id)._unsafeUnwrap();
const createFieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();

// Test type validation strategy
const typeValidationStrategy = new Pg16TypeValidationStrategy();

const createCompileKysely = () =>
  new Kysely<DynamicDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

// Create a minimal Kysely instance that can compile SQL
const createMockKysely = () => createCompileKysely();

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

const createScalarLookupFormulaTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const sourceTableId = TableId.create(`tbl${'s'.repeat(16)}`)._unsafeUnwrap();
  const targetTableId = TableId.create(`tbl${'t'.repeat(16)}`)._unsafeUnwrap();
  const sourcePrimaryFieldId = createFieldId(`fld${'p'.repeat(16)}`);
  const sourceAmountFieldId = createFieldId(`fld${'a'.repeat(16)}`);
  const linkFieldId = createFieldId(`fld${'l'.repeat(16)}`);
  const symmetricFieldId = createFieldId(`fld${'m'.repeat(16)}`);
  const lookupFieldId = createFieldId(`fld${'u'.repeat(16)}`);
  const formulaFieldId = createFieldId(`fld${'f'.repeat(16)}`);

  const sourceBuilder = Table.builder()
    .withId(sourceTableId)
    .withBaseId(baseId)
    .withName(TableName.create('SourceTable')._unsafeUnwrap());
  sourceBuilder
    .field()
    .singleLineText()
    .withId(sourcePrimaryFieldId)
    .withName(createFieldName('SourceName'))
    .primary()
    .done();
  sourceBuilder
    .addFieldFromResult(
      createNumberField({
        id: sourceAmountFieldId,
        name: createFieldName('SourceAmount'),
      }).andThen((field) =>
        DbFieldName.rehydrate('SourceAmount').andThen((dbName) =>
          field.setDbFieldName(dbName).map(() => field)
        )
      )
    )
    .view()
    .defaultGrid()
    .done();
  const sourceTable = sourceBuilder.build()._unsafeUnwrap();

  const linkConfig = LinkFieldConfig.create({
    relationship: 'manyOne',
    foreignTableId: sourceTableId.toString(),
    lookupFieldId: sourcePrimaryFieldId.toString(),
    symmetricFieldId: symmetricFieldId.toString(),
  })._unsafeUnwrap();
  const lookupOptions = LookupOptions.create({
    linkFieldId: linkFieldId.toString(),
    foreignTableId: sourceTableId.toString(),
    lookupFieldId: sourceAmountFieldId.toString(),
  })._unsafeUnwrap();

  const targetBuilder = Table.builder()
    .withId(targetTableId)
    .withBaseId(baseId)
    .withName(TableName.create('TargetTable')._unsafeUnwrap());
  targetBuilder.field().singleLineText().withName(createFieldName('Name')).primary().done();
  targetBuilder
    .field()
    .link()
    .withId(linkFieldId)
    .withName(createFieldName('SourceLink'))
    .withConfig(linkConfig)
    .done();
  targetBuilder
    .field()
    .lookup()
    .withId(lookupFieldId)
    .withName(createFieldName('LookupAmount'))
    .withLookupOptions(lookupOptions)
    .withInnerField(
      sourceTable.getField((field) => field.id().equals(sourceAmountFieldId))._unsafeUnwrap()
    )
    .withIsMultipleCellValue(false)
    .done();
  targetBuilder.addFieldFromResult(
    createFormulaField({
      id: formulaFieldId,
      name: createFieldName('LookupAmountDoubled'),
      expression: FormulaExpression.create(
        `ROUND({${lookupFieldId.toString()}} * 2, 2)`
      )._unsafeUnwrap(),
    }).andThen((field) =>
      DbFieldName.rehydrate('LookupAmountDoubled').andThen((dbName) =>
        field.setDbFieldName(dbName).map(() => field)
      )
    )
  );
  targetBuilder.view().defaultGrid().done();

  const table = targetBuilder.build({ foreignTables: [sourceTable] })._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(lookupFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('LookupAmount')._unsafeUnwrap())
    ._unsafeUnwrap();

  return { table, formulaFieldId };
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

const createChainedFormulaTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('TestTable')._unsafeUnwrap();

  const baseValueId = createFieldId(`fld${'i'.repeat(16)}`);
  const plusOneId = createFieldId(`fld${'j'.repeat(16)}`);
  const plusOneDoubleId = createFieldId(`fld${'k'.repeat(16)}`);

  const baseValueResult = createNumberField({
    id: baseValueId,
    name: createFieldName('BaseValue'),
  }).andThen((field) =>
    DbFieldName.rehydrate('BaseValue').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const plusOneResult = createFormulaField({
    id: plusOneId,
    name: createFieldName('PlusOne'),
    expression: FormulaExpression.create(`{${baseValueId.toString()}} + 1`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('PlusOne').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const plusOneDoubleResult = createFormulaField({
    id: plusOneDoubleId,
    name: createFieldName('PlusOneDouble'),
    expression: FormulaExpression.create(`{${plusOneId.toString()}} * 2`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('PlusOneDouble').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const table = Table.builder()
    .withId(tableId)
    .withName(tableName)
    .withBaseId(baseId)
    .addFieldFromResult(baseValueResult)
    .addFieldFromResult(plusOneResult)
    .addFieldFromResult(plusOneDoubleResult)
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();

  return { table, plusOneId, plusOneDoubleId };
};

const createLinkFormulaTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const mainTableId = TableId.create(`tbl${'l'.repeat(16)}`)._unsafeUnwrap();
  const foreignTableId = TableId.create(`tbl${'r'.repeat(16)}`)._unsafeUnwrap();
  const lookupFieldId = createFieldId(`fld${'p'.repeat(16)}`);
  const linkFieldId = createFieldId(`fld${'q'.repeat(16)}`);
  const formulaFieldId = createFieldId(`fld${'r'.repeat(16)}`);

  const foreignBuilder = Table.builder()
    .withId(foreignTableId)
    .withBaseId(baseId)
    .withName(TableName.create('ForeignTable')._unsafeUnwrap());
  foreignBuilder
    .field()
    .singleLineText()
    .withId(lookupFieldId)
    .withName(createFieldName('Title'))
    .done();
  foreignBuilder.view().defaultGrid().done();

  const foreignTable = foreignBuilder.build()._unsafeUnwrap();
  foreignTable
    .getFields()[0]
    .setDbFieldName(DbFieldName.rehydrate('Title')._unsafeUnwrap())
    ._unsafeUnwrap();

  const linkConfig = LinkFieldConfig.create({
    relationship: 'manyOne',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: lookupFieldId.toString(),
    symmetricFieldId: `fld${'s'.repeat(16)}`,
  })._unsafeUnwrap();

  const mainBuilder = Table.builder()
    .withId(mainTableId)
    .withBaseId(baseId)
    .withName(TableName.create('MainTable')._unsafeUnwrap());
  mainBuilder.field().singleLineText().withName(createFieldName('Name')).done();
  mainBuilder
    .field()
    .link()
    .withId(linkFieldId)
    .withName(createFieldName('Link'))
    .withConfig(linkConfig)
    .done();
  mainBuilder
    .field()
    .formula()
    .withId(formulaFieldId)
    .withName(createFieldName('LinkTitleFormula'))
    .withExpression(FormulaExpression.create(`{${linkFieldId.toString()}}`)._unsafeUnwrap())
    .done();
  mainBuilder.view().defaultGrid().done();

  const table = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
  table
    .getFields()[0]
    .setDbFieldName(DbFieldName.rehydrate('Name')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getFields()[1]
    .setDbFieldName(DbFieldName.rehydrate('Link')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getFields()[2]
    .setDbFieldName(DbFieldName.rehydrate('LinkTitleFormula')._unsafeUnwrap())
    ._unsafeUnwrap();

  return { table, formulaFieldId };
};

const createIsErrorFormulaChainTable = () => {
  const baseId = BaseId.create(`bse${'e'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'e'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('ErrorChainTable')._unsafeUnwrap();

  const nameId = createFieldId(`fld${'l'.repeat(16)}`);
  const alwaysErrorId = createFieldId(`fld${'m'.repeat(16)}`);
  const isErrorAlwaysErrorId = createFieldId(`fld${'o'.repeat(16)}`);

  const nameResult = createNumberField({
    id: nameId,
    name: createFieldName('BaseValue'),
  }).andThen((field) =>
    DbFieldName.rehydrate('BaseValue').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const alwaysErrorResult = createFormulaField({
    id: alwaysErrorId,
    name: createFieldName('AlwaysError'),
    expression: FormulaExpression.create(`ERROR("boom")`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('AlwaysError').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const isErrorAlwaysErrorResult = createFormulaField({
    id: isErrorAlwaysErrorId,
    name: createFieldName('IsErrorAlwaysError'),
    expression: FormulaExpression.create(`IS_ERROR({${alwaysErrorId.toString()}})`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('IsErrorAlwaysError').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const table = Table.builder()
    .withId(tableId)
    .withName(tableName)
    .withBaseId(baseId)
    .addFieldFromResult(nameResult)
    .addFieldFromResult(alwaysErrorResult)
    .addFieldFromResult(isErrorAlwaysErrorResult)
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();

  return { table, alwaysErrorId, isErrorAlwaysErrorId };
};

const createUserSnapshotFormulaTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'u'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('UserSnapshotFormulaTable')._unsafeUnwrap();

  const createdById = createFieldId(`fld${'u'.repeat(16)}`);
  const lastModifiedById = createFieldId(`fld${'v'.repeat(16)}`);
  const createdByFormulaId = createFieldId(`fld${'w'.repeat(16)}`);
  const lastModifiedByFormulaId = createFieldId(`fld${'x'.repeat(16)}`);

  const createdByResult = createCreatedByField({
    id: createdById,
    name: createFieldName('CreatedBy'),
  }).andThen((field) =>
    DbFieldName.rehydrate('CreatedBy').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const lastModifiedByResult = createLastModifiedByField({
    id: lastModifiedById,
    name: createFieldName('LastModifiedBy'),
  }).andThen((field) =>
    DbFieldName.rehydrate('LastModifiedBy').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const createdByFormulaResult = createFormulaField({
    id: createdByFormulaId,
    name: createFieldName('CreatedByName'),
    expression: FormulaExpression.create(`{${createdById.toString()}}`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('CreatedByName').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const lastModifiedByFormulaResult = createFormulaField({
    id: lastModifiedByFormulaId,
    name: createFieldName('LastModifiedByName'),
    expression: FormulaExpression.create(`{${lastModifiedById.toString()}}`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('LastModifiedByName').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const table = Table.builder()
    .withId(tableId)
    .withName(tableName)
    .withBaseId(baseId)
    .addFieldFromResult(createdByResult)
    .addFieldFromResult(lastModifiedByResult)
    .addFieldFromResult(createdByFormulaResult)
    .addFieldFromResult(lastModifiedByFormulaResult)
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();

  return { table, createdByFormulaId, lastModifiedByFormulaId };
};

// Create a table with two identical formulas in one level and a dependent formula in next level.
const createDuplicateFormulaChainTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'d'.repeat(16)}`)._unsafeUnwrap();
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

const createEscapedIdentifierChainTable = () => {
  const baseId = BaseId.create(`bse${'q'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'q'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('EscapedIdentifierTable')._unsafeUnwrap();

  const sourceId = createFieldId(`fld${'u'.repeat(16)}`);
  const firstFormulaId = createFieldId(`fld${'v'.repeat(16)}`);
  const secondFormulaId = createFieldId(`fld${'w'.repeat(16)}`);

  const sourceResult = createNumberField({
    id: sourceId,
    name: createFieldName('Source'),
  }).andThen((field) =>
    DbFieldName.rehydrate('from"amount').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const firstFormulaResult = createFormulaField({
    id: firstFormulaId,
    name: createFieldName('FirstFormula'),
    expression: FormulaExpression.create(`{${sourceId.toString()}} * 2`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('select"discount').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const secondFormulaResult = createFormulaField({
    id: secondFormulaId,
    name: createFieldName('SecondFormula'),
    expression: FormulaExpression.create(`{${firstFormulaId.toString()}} + 1`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('total"from').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const table = Table.builder()
    .withId(tableId)
    .withName(tableName)
    .withBaseId(baseId)
    .addFieldFromResult(sourceResult)
    .addFieldFromResult(firstFormulaResult)
    .addFieldFromResult(secondFormulaResult)
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();

  return { table, firstFormulaId, secondFormulaId };
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

    it('carries forward previous level columns and selects from the last CTE only', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
      const { table, plusOneId, plusOneDoubleId } = createChainedFormulaTable();

      const result = builder.build({
        table,
        fieldLevels: [
          { level: 0, fieldIds: [plusOneId] },
          { level: 1, fieldIds: [plusOneDoubleId] },
        ],
      });

      expect(result.isOk()).toBe(true);
      const { selectQuery, fieldMappings } = result._unsafeUnwrap();
      expect(fieldMappings).toEqual([
        { columnName: 'PlusOne', cteName: 'level_1' },
        { columnName: 'PlusOneDouble', cteName: 'level_1' },
      ]);

      const updateBuilder = new UpdateFromSelectBuilder(db);
      const compiled = updateBuilder.build({
        table,
        fieldIds: [plusOneId, plusOneDoubleId],
        selectQuery,
      });
      expect(compiled.isOk()).toBe(true);
      const sqlText = compiled._unsafeUnwrap().sql;

      expect(sqlText).toContain('"level_0"."PlusOne"');
      expect(sqlText).toContain(
        'FROM "bseaaaaaaaaaaaaaaaa"."tblcccccccccccccccc" AS "u" JOIN "level_1"'
      );
      expect(sqlText).not.toContain(
        'FROM "bseaaaaaaaaaaaaaaaa"."tblcccccccccccccccc" AS u, "level_0", "level_1"'
      );
    });

    it('builds returning updates from a same-table CTE chain', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
      const { table, plusOneId, plusOneDoubleId } = createChainedFormulaTable();

      const result = builder.build({
        table,
        fieldLevels: [
          { level: 0, fieldIds: [plusOneId] },
          { level: 1, fieldIds: [plusOneDoubleId] },
        ],
        dirtyFilter: {
          tableId: table.id().toString(),
          dirtyTableName: 'tmp_computed_dirty',
          tableIdColumn: 'table_id',
          recordIdColumn: 'record_id',
        },
      });

      expect(result.isOk()).toBe(true);
      const updateBuilder = new UpdateFromSelectBuilder(db);
      const compiled = updateBuilder.buildWithReturning({
        table,
        fieldIds: [plusOneId, plusOneDoubleId],
        selectQuery: result._unsafeUnwrap().selectQuery,
      });
      expect(compiled.isOk()).toBe(true);
      const sqlText = compiled._unsafeUnwrap().compiled.sql;

      const sourceAliasIndex = sqlText.lastIndexOf(') as "c"');
      const oldTableIndex = sqlText.indexOf(
        ', "bseaaaaaaaaaaaaaaaa"."tblcccccccccccccccc" as "__old" where "__old"."__id" = "c"."__id"'
      );

      expect(sqlText).toContain('WITH "level_0" AS');
      expect(sqlText).toContain('INNER JOIN "tmp_computed_dirty" AS "__dirty"');
      expect(sqlText).toContain('RETURNING "u"."__id", "u"."__version" - 1 as "__old_version"');
      expect(sqlText).toContain('"__old"."PlusOne" as "__old_PlusOne"');
      expect(sqlText).toContain('"__old"."PlusOneDouble" as "__old_PlusOneDouble"');
      expect(sourceAliasIndex).toBeGreaterThan(-1);
      expect(oldTableIndex).toBeGreaterThan(sourceAliasIndex);
    });

    it('escapes DB field names in CTE field references', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
      const { table, firstFormulaId, secondFormulaId } = createEscapedIdentifierChainTable();

      const result = builder.build({
        table,
        fieldLevels: [
          { level: 0, fieldIds: [firstFormulaId] },
          { level: 1, fieldIds: [secondFormulaId] },
        ],
      });

      expect(result.isOk()).toBe(true);
      const updateBuilder = new UpdateFromSelectBuilder(db);
      const compiled = updateBuilder.build({
        table,
        fieldIds: [firstFormulaId, secondFormulaId],
        selectQuery: result._unsafeUnwrap().selectQuery,
      });
      expect(compiled.isOk()).toBe(true);
      const sqlText = compiled._unsafeUnwrap().sql;

      expect(sqlText).toContain('"t"."from""amount"');
      expect(sqlText).toContain('"level_0"."select""discount"');
      expect(sqlText).toContain('"level_1"."select""discount" as "select""discount"');
      expect(sqlText).not.toContain('"t"."from"amount"');
      expect(sqlText).not.toContain('"level_0"."select"discount"');
    });

    it('uses stored columns for same-table formula dependencies that are not update targets', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
      const { table, plusOneDoubleId } = createChainedFormulaTable();

      const result = builder.build({
        table,
        fieldLevels: [{ level: 0, fieldIds: [plusOneDoubleId] }],
      });

      expect(result.isOk()).toBe(true);
      const { selectQuery, fieldMappings } = result._unsafeUnwrap();
      expect(fieldMappings).toEqual([{ columnName: 'PlusOneDouble', cteName: 'level_0' }]);

      const updateBuilder = new UpdateFromSelectBuilder(db);
      const compiled = updateBuilder.build({
        table,
        fieldIds: [plusOneDoubleId],
        selectQuery,
      });
      expect(compiled.isOk()).toBe(true);
      const sqlText = compiled._unsafeUnwrap().sql;

      expect(sqlText).toContain('"t"."PlusOne"');
      expect(sqlText).toContain('set "__version" = "u"."__version" + 1');
      expect(sqlText).toContain('"PlusOneDouble" = "c"."__set_PlusOneDouble"');
      expect(sqlText).not.toContain('"PlusOne" = "c"."__set_PlusOne"');
    });

    it('applies recordIds filter in first-level CTE when recordIds are provided', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
      const { table, formulaFieldId } = createSingleFormulaTable();
      const recordIdA = `rec${'1'.repeat(16)}`;
      const recordIdB = `rec${'2'.repeat(16)}`;

      const result = builder.build({
        table,
        fieldLevels: [{ level: 0, fieldIds: [formulaFieldId] }],
        recordIds: [recordIdA, recordIdB],
      });

      expect(result.isOk()).toBe(true);
      const updateBuilder = new UpdateFromSelectBuilder(db);
      const compiled = updateBuilder.build({
        table,
        fieldIds: [formulaFieldId],
        selectQuery: result._unsafeUnwrap().selectQuery,
      });
      expect(compiled.isOk()).toBe(true);

      const sqlText = compiled._unsafeUnwrap().sql;
      expect(sqlText).toContain(
        `INNER JOIN (VALUES ('${recordIdA}'), ('${recordIdB}')) AS "__record_ids"("__id")`
      );
    });

    it('keeps formula error metadata when referencing previous CTE formula in IS_ERROR', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
      const { table, isErrorAlwaysErrorId } = createIsErrorFormulaChainTable();

      const result = builder.build({
        table,
        fieldLevels: [{ level: 0, fieldIds: [isErrorAlwaysErrorId] }],
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().fieldMappings).toEqual([
        { columnName: 'IsErrorAlwaysError', cteName: 'level_1' },
      ]);
      const updateBuilder = new UpdateFromSelectBuilder(db);
      const compiled = updateBuilder.build({
        table,
        fieldIds: [isErrorAlwaysErrorId],
        selectQuery: result._unsafeUnwrap().selectQuery,
      });
      expect(compiled.isOk()).toBe(true);

      const sqlText = compiled._unsafeUnwrap().sql;
      expect(sqlText).toContain(`(TRUE) as "__err_AlwaysError"`);
      expect(sqlText).toContain(`"level_0"."__err_AlwaysError" OR`);
      expect(sqlText).toContain(`"level_0"."AlwaysError" LIKE '#ERROR:%'`);
      expect(sqlText).toContain('"IsErrorAlwaysError" = "c"."__set_IsErrorAlwaysError"');
      expect(sqlText).not.toContain('"AlwaysError" = "c"."__set_AlwaysError"');
    });

    it('extracts user snapshot titles when formulas reference createdBy and lastModifiedBy fields', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
      const { table, createdByFormulaId, lastModifiedByFormulaId } =
        createUserSnapshotFormulaTable();

      const result = builder.build({
        table,
        fieldLevels: [{ level: 0, fieldIds: [createdByFormulaId, lastModifiedByFormulaId] }],
      });

      expect(result.isOk()).toBe(true);
      const updateBuilder = new UpdateFromSelectBuilder(db);
      const compiled = updateBuilder.build({
        table,
        fieldIds: [createdByFormulaId, lastModifiedByFormulaId],
        selectQuery: result._unsafeUnwrap().selectQuery,
      });
      expect(compiled.isOk()).toBe(true);

      const sqlText = compiled._unsafeUnwrap().sql;
      expect(sqlText).toContain(`"t"."__created_by"`);
      expect(sqlText).toContain(`"t"."__last_modified_by"`);
      expect(sqlText).toContain(`WHEN "t"."CreatedBy" IS NULL THEN NULL::jsonb`);
      expect(sqlText).toContain(`WHEN "t"."LastModifiedBy" IS NULL THEN NULL::jsonb`);
      expect(sqlText).toContain(`END)->>'title'`);
    });

    it('extracts link title when a same-table formula directly references a link field', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
      const { table, formulaFieldId } = createLinkFormulaTable();

      const result = builder.build({
        table,
        fieldLevels: [{ level: 0, fieldIds: [formulaFieldId] }],
      });

      expect(result.isOk()).toBe(true);
      const updateBuilder = new UpdateFromSelectBuilder(db);
      const compiled = updateBuilder.build({
        table,
        fieldIds: [formulaFieldId],
        selectQuery: result._unsafeUnwrap().selectQuery,
      });
      expect(compiled.isOk()).toBe(true);

      const sqlText = compiled._unsafeUnwrap().sql;
      expect(sqlText).toContain(`COALESCE(("t"."Link")::jsonb->>'title'`);
      expect(sqlText).not.toContain(`"t"."Link" as "LinkTitleFormula"`);
    });

    it('uses scalar lookup columns directly in same-table formula batches', () => {
      const db = createMockKysely();
      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
      const { table, formulaFieldId } = createScalarLookupFormulaTable();

      const result = builder.build({
        table,
        fieldLevels: [{ level: 0, fieldIds: [formulaFieldId] }],
      });

      expect(result.isOk()).toBe(true);
      const updateBuilder = new UpdateFromSelectBuilder(db);
      const compiled = updateBuilder.build({
        table,
        fieldIds: [formulaFieldId],
        selectQuery: result._unsafeUnwrap().selectQuery,
      });
      expect(compiled.isOk()).toBe(true);

      const sqlText = compiled._unsafeUnwrap().sql;
      expect(sqlText).toMatchSnapshot();
      expect(sqlText).toContain(`"t"."LookupAmount"`);
      expect(sqlText).not.toContain('pg_input_is_valid');
      expect(sqlText).not.toContain('jsonb_build_array');
      expect(sqlText).not.toContain('jsonb_typeof');
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
      expect(sqlText).toContain('JOIN "level_1" ON "u"."__id" = "level_1"."__id"');
      expect(sqlText).not.toContain(
        'FROM "bseaaaaaaaaaaaaaaaa"."tbldddddddddddddddd" AS u, "level_0", "level_1"'
      );
    });
  });
});
