/* eslint-disable @typescript-eslint/naming-convention */
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import type {
  IExecutionContext,
  ITableRepository,
  ITableSchemaRepository,
  LinkField,
} from '@teable/v2-core';
import {
  ActorId,
  BaseId,
  DbFieldName,
  Field,
  FieldId,
  FieldName,
  FieldSpecBuilder,
  FieldValueTypeVisitor,
  FormulaExpression,
  LinkFieldConfig,
  LinkFieldMeta,
  RatingMax,
  RollupExpression,
  RollupFieldConfig,
  SelectOption,
  Table,
  TableName,
  TableId,
  UserMultiplicity,
  createNewLinkField,
  resolveFormulaFields,
  v2CoreTokens,
  validateForeignTablesForFields,
} from '@teable/v2-core';
import { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  baseRecordColumnNames,
  convertNameToValidCharacter,
  ensureUniqueDbFieldName,
  joinDbTableName,
} from '../naming';

const baseRecordColumnTypes: Record<string, string> = {
  __id: 'text',
  __auto_number: 'int4',
  __created_time: 'timestamptz',
  __last_modified_time: 'timestamptz',
  __created_by: 'text',
  __last_modified_by: 'text',
  __version: 'int4',
};

const buildFieldSpec = (build: (builder: FieldSpecBuilder) => FieldSpecBuilder) =>
  build(FieldSpecBuilder.create()).build()._unsafeUnwrap();

const getFieldById = (table: Table, fieldId: FieldId) =>
  table.getFields(buildFieldSpec((builder) => builder.withFieldId(fieldId)))[0];

const jsonSpecResult = Field.specs().isJson().build();

const fieldIsJson = (field: Field): boolean => {
  if (jsonSpecResult.isErr()) return false;
  return jsonSpecResult.value.isSatisfiedBy(field);
};

const resolveExpectedUdtName = (
  field: Field,
  cellValueType: string,
  isMultipleCellValue: boolean
): string => {
  if (isMultipleCellValue) return 'jsonb';
  if (fieldIsJson(field)) return 'jsonb';

  switch (cellValueType) {
    case 'number':
      return 'float8';
    case 'dateTime':
      return 'timestamptz';
    case 'boolean':
      return 'bool';
    case 'string':
    default:
      return 'text';
  }
};

const fetchColumnTypes = async (
  db: Kysely<V1TeableDatabase>,
  tableName: string,
  schemaName = 'public'
): Promise<Map<string, string>> => {
  const columnsResult = await sql<{ columnName: string; udtName: string }>`
    select column_name as "columnName", udt_name as "udtName"
    from information_schema.columns
    where table_schema = ${schemaName}
      and table_name = ${tableName}
  `.execute(db);
  return new Map(columnsResult.rows.map((row) => [row.columnName, row.udtName]));
};

type IndexInfo = {
  indexName: string;
  isUnique: boolean;
  columnNames: string[];
};

const fetchIndexes = async (
  db: Kysely<V1TeableDatabase>,
  tableName: string,
  schemaName = 'public'
): Promise<IndexInfo[]> => {
  const indexesResult = await sql<{
    indexName: string;
    isUnique: boolean;
    columnName: string;
  }>`
    select
      i.relname as "indexName",
      ix.indisunique as "isUnique",
      a.attname as "columnName"
    from pg_class t
    join pg_index ix on t.oid = ix.indrelid
    join pg_class i on i.oid = ix.indexrelid
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(ix.indkey)
    join pg_namespace n on n.oid = t.relnamespace
    where t.relkind = 'r'
      and n.nspname = ${schemaName}
      and t.relname = ${tableName}
    order by i.relname, a.attnum
  `.execute(db);

  const indexMap = new Map<string, IndexInfo>();
  for (const row of indexesResult.rows) {
    if (!indexMap.has(row.indexName)) {
      indexMap.set(row.indexName, {
        indexName: row.indexName,
        isUnique: row.isUnique,
        columnNames: [],
      });
    }
    indexMap.get(row.indexName)!.columnNames.push(row.columnName);
  }
  return Array.from(indexMap.values());
};

describe('PostgresTableSchemaRepository (pg)', () => {
  let testContainer: IV2NodeTestContainer;

  beforeAll(async () => {
    testContainer = await createV2NodeTestContainer();
  });

  afterAll(async () => {
    await testContainer.dispose();
  });

  it('creates record table and field columns', async () => {
    const c = testContainer.container;

    const db = testContainer.db;
    const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

    try {
      const baseIdResult = BaseId.generate();
      baseIdResult._unsafeUnwrap();
      const baseId = baseIdResult._unsafeUnwrap();

      const tableNameResult = TableName.create('Project Items');
      const titleNameResult = FieldName.create('Task Name');
      const ratingNameResult = FieldName.create('Priority Level');
      const statusNameResult = FieldName.create('Status');
      [tableNameResult, titleNameResult, ratingNameResult, statusNameResult].forEach((r) =>
        r._unsafeUnwrap()
      );
      const tableName = tableNameResult._unsafeUnwrap();
      const titleName = titleNameResult._unsafeUnwrap();
      const ratingName = ratingNameResult._unsafeUnwrap();
      const statusName = statusNameResult._unsafeUnwrap();

      const todoOptionResult = SelectOption.create({ name: 'Todo', color: 'blue' });
      const doneOptionResult = SelectOption.create({ name: 'Done', color: 'red' });
      [todoOptionResult, doneOptionResult].forEach((r) => r._unsafeUnwrap());
      const todoOption = todoOptionResult._unsafeUnwrap();
      const doneOption = doneOptionResult._unsafeUnwrap();

      const builder = Table.builder().withBaseId(baseId).withName(tableName);
      builder.field().singleLineText().withName(titleName).done();
      builder.field().rating().withName(ratingName).withMax(RatingMax.five()).done();
      builder
        .field()
        .singleSelect()
        .withName(statusName)
        .withOptions([todoOption, doneOption])
        .done();
      builder.view().defaultGrid().done();

      const tableResult = builder.build();
      tableResult._unsafeUnwrap();
      const table = tableResult._unsafeUnwrap();

      const dbTableNameValue = table.dbTableName()._unsafeUnwrap();
      const reservedNames = new Set(baseRecordColumnNames);
      const fieldDbNames: string[] = [];

      dbTableNameValue.value()._unsafeUnwrap();

      for (const field of table.getFields()) {
        const baseName = convertNameToValidCharacter(field.name().toString(), 40);
        const dbFieldName = ensureUniqueDbFieldName(baseName, reservedNames);
        reservedNames.add(dbFieldName);
        fieldDbNames.push(dbFieldName);
        const dbFieldNameResult = DbFieldName.rehydrate(dbFieldName);
        dbFieldNameResult._unsafeUnwrap();
        const dbFieldNameValue = dbFieldNameResult._unsafeUnwrap();
        const setFieldDbNameResult = field.setDbFieldName(dbFieldNameValue);
        setFieldDbNameResult._unsafeUnwrap();
        setFieldDbNameResult._unsafeUnwrap();
      }

      const actorIdResult = ActorId.create('system');
      actorIdResult._unsafeUnwrap();
      const context: IExecutionContext = { actorId: actorIdResult._unsafeUnwrap() };

      const insertResult = await repo.insert(context, table);
      insertResult._unsafeUnwrap();
      insertResult._unsafeUnwrap();

      const expectedBaseColumns = baseRecordColumnNames;
      const expectedFieldColumns = fieldDbNames;

      const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
      splitResult._unsafeUnwrap();
      const { schema, tableName: dbTableNameFromSplit } = splitResult._unsafeUnwrap();
      const actualSchemaName = schema ?? 'public';
      const columnsResult = await sql<{ columnName: string }>`
        select column_name as "columnName"
        from information_schema.columns
        where table_schema = ${actualSchemaName}
          and table_name = ${dbTableNameFromSplit}
      `.execute(db);

      const actualColumns = columnsResult.rows.map((r) => r.columnName);
      for (const columnName of [...expectedBaseColumns, ...expectedFieldColumns]) {
        expect(actualColumns).toContain(columnName);
      }
    } finally {
      // no cleanup required
      void 0;
    }
  });

  it('creates rollup columns and reference entries', async () => {
    const c = testContainer.container;

    const db = testContainer.db;
    const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

    try {
      const baseId = BaseId.generate()._unsafeUnwrap();

      const foreignTableName = TableName.create('Foreign')._unsafeUnwrap();
      const foreignBuilder = Table.builder().withBaseId(baseId).withName(foreignTableName);
      const foreignLookupFieldId = FieldId.generate()._unsafeUnwrap();
      foreignBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .primary()
        .done();
      foreignBuilder
        .field()
        .number()
        .withName(FieldName.create('Amount')._unsafeUnwrap())
        .withId(foreignLookupFieldId)
        .done();
      foreignBuilder.view().defaultGrid().done();
      const foreignTable = foreignBuilder.build()._unsafeUnwrap();

      const hostTableName = TableName.create('Host')._unsafeUnwrap();
      const hostBuilder = Table.builder().withBaseId(baseId).withName(hostTableName);
      const linkFieldId = FieldId.generate()._unsafeUnwrap();
      const linkConfig = LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignLookupFieldId.toString(),
        fkHostTableName: joinDbTableName(baseId.toString(), 'link_relations_rollup'),
        selfKeyName: '__self_id',
        foreignKeyName: '__foreign_id',
      })._unsafeUnwrap();
      hostBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .primary()
        .done();
      hostBuilder
        .field()
        .link()
        .withName(FieldName.create('Links')._unsafeUnwrap())
        .withId(linkFieldId)
        .withConfig(linkConfig)
        .done();
      const rollupConfig = RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignLookupFieldId.toString(),
      })._unsafeUnwrap();
      const valuesField = getFieldById(foreignTable, foreignLookupFieldId);
      expect(valuesField).toBeTruthy();
      if (!valuesField) return;

      hostBuilder
        .field()
        .rollup()
        .withName(FieldName.create('Total')._unsafeUnwrap())
        .withConfig(rollupConfig)
        .withExpression(RollupExpression.create('countall({values})')._unsafeUnwrap())
        .withValuesField(valuesField)
        .done();
      hostBuilder.view().defaultGrid().done();
      const hostTable = hostBuilder.build()._unsafeUnwrap();

      const rollupFields = hostTable.getFields(buildFieldSpec((builder) => builder.isRollup()));
      const resolveRollupResult = validateForeignTablesForFields(rollupFields, {
        hostTable,
        foreignTables: [foreignTable],
      });
      resolveRollupResult._unsafeUnwrap();

      const dbTableNameValue = hostTable.dbTableName()._unsafeUnwrap();

      const reservedNames = new Set(baseRecordColumnNames);
      for (const field of hostTable.getFields()) {
        const baseName = convertNameToValidCharacter(field.name().toString(), 40);
        const dbFieldName = ensureUniqueDbFieldName(baseName, reservedNames);
        reservedNames.add(dbFieldName);
        const dbFieldNameValue = DbFieldName.rehydrate(dbFieldName)._unsafeUnwrap();
        field.setDbFieldName(dbFieldNameValue)._unsafeUnwrap();
      }

      const context: IExecutionContext = { actorId: ActorId.create('system')._unsafeUnwrap() };
      const insertResult = await repo.insert(context, hostTable);
      insertResult._unsafeUnwrap();

      const rollupField = hostTable.getFields(buildFieldSpec((builder) => builder.isRollup()))[0];
      expect(rollupField).toBeTruthy();
      if (!rollupField) return;
      const rollupDbNameResult = rollupField.dbFieldName().andThen((name) => name.value());
      rollupDbNameResult._unsafeUnwrap();

      const rollupDbName = rollupDbNameResult._unsafeUnwrap();

      const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
      splitResult._unsafeUnwrap();
      const { schema, tableName: dbTableNameFromSplit } = splitResult._unsafeUnwrap();
      const actualSchemaName = schema ?? 'public';
      const columnTypes = await fetchColumnTypes(db, dbTableNameFromSplit, actualSchemaName);

      const rollupValueTypeResult = rollupField.accept(new FieldValueTypeVisitor());
      rollupValueTypeResult._unsafeUnwrap();

      const expectedUdtName = resolveExpectedUdtName(
        rollupField,
        rollupValueTypeResult._unsafeUnwrap().cellValueType.toString(),
        rollupValueTypeResult._unsafeUnwrap().isMultipleCellValue.toBoolean()
      );
      expect(columnTypes.get(rollupDbName)).toBe(expectedUdtName);

      const references = await db
        .selectFrom('reference')
        .select(['from_field_id'])
        .where('to_field_id', '=', rollupField.id().toString())
        .execute();
      const fromFieldIds = references
        .map((row: { from_field_id: string }) => row.from_field_id)
        .sort();
      expect(fromFieldIds).toEqual(
        [linkFieldId.toString(), foreignLookupFieldId.toString()].sort()
      );
    } finally {
      // no cleanup required
      void 0;
    }
  });

  it('uses v1-compatible column types for fields', async () => {
    const c = testContainer.container;

    const db = testContainer.db;
    const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);
    let tableForCleanup: Table | undefined;
    let contextForCleanup: IExecutionContext | undefined;

    try {
      const baseIdResult = BaseId.generate();
      baseIdResult._unsafeUnwrap();
      const baseId = baseIdResult._unsafeUnwrap();

      const tableNameResult = TableName.create('DDL Column Types');
      const titleNameResult = FieldName.create('Title');
      const descriptionNameResult = FieldName.create('Description');
      const amountNameResult = FieldName.create('Amount');
      const ratingNameResult = FieldName.create('Rating');
      const scoreNameResult = FieldName.create('Score');
      const scoreLabelNameResult = FieldName.create('Score Label');
      const statusNameResult = FieldName.create('Status');
      const tagsNameResult = FieldName.create('Tags');
      const doneNameResult = FieldName.create('Done');
      const filesNameResult = FieldName.create('Files');
      const dueNameResult = FieldName.create('Due Date');
      const ownerNameResult = FieldName.create('Owner');
      const actionNameResult = FieldName.create('Action');

      const titleFieldIdResult = FieldId.generate();
      const amountFieldIdResult = FieldId.generate();
      const scoreExpressionResult = amountFieldIdResult.andThen((fieldId) =>
        FormulaExpression.create(`{${fieldId.toString()}} * 2`)
      );
      const scoreLabelExpressionResult = titleFieldIdResult.andThen((fieldId) =>
        FormulaExpression.create(`CONCATENATE("Label: ", {${fieldId.toString()}})`)
      );

      const todoOptionResult = SelectOption.create({ name: 'Todo', color: 'blue' });
      const doneOptionResult = SelectOption.create({ name: 'Done', color: 'green' });
      const bugOptionResult = SelectOption.create({ name: 'Bug', color: 'red' });
      const featureOptionResult = SelectOption.create({ name: 'Feature', color: 'yellow' });

      const tableName = tableNameResult._unsafeUnwrap();
      const titleName = titleNameResult._unsafeUnwrap();
      const descriptionName = descriptionNameResult._unsafeUnwrap();
      const amountName = amountNameResult._unsafeUnwrap();
      const ratingName = ratingNameResult._unsafeUnwrap();
      const scoreName = scoreNameResult._unsafeUnwrap();
      const scoreLabelName = scoreLabelNameResult._unsafeUnwrap();
      const statusName = statusNameResult._unsafeUnwrap();
      const tagsName = tagsNameResult._unsafeUnwrap();
      const doneName = doneNameResult._unsafeUnwrap();
      const filesName = filesNameResult._unsafeUnwrap();
      const dueName = dueNameResult._unsafeUnwrap();
      const ownerName = ownerNameResult._unsafeUnwrap();
      const actionName = actionNameResult._unsafeUnwrap();
      const titleFieldId = titleFieldIdResult._unsafeUnwrap();
      const amountFieldId = amountFieldIdResult._unsafeUnwrap();
      const scoreExpression = scoreExpressionResult._unsafeUnwrap();
      const scoreLabelExpression = scoreLabelExpressionResult._unsafeUnwrap();
      const todoOption = todoOptionResult._unsafeUnwrap();
      const doneOption = doneOptionResult._unsafeUnwrap();
      const bugOption = bugOptionResult._unsafeUnwrap();
      const featureOption = featureOptionResult._unsafeUnwrap();

      const builder = Table.builder().withBaseId(baseId).withName(tableName);
      builder.field().singleLineText().withName(titleName).withId(titleFieldId).primary().done();
      builder.field().longText().withName(descriptionName).done();
      builder.field().number().withName(amountName).withId(amountFieldId).done();
      builder.field().rating().withName(ratingName).withMax(RatingMax.five()).done();
      builder.field().formula().withName(scoreName).withExpression(scoreExpression).done();
      builder
        .field()
        .formula()
        .withName(scoreLabelName)
        .withExpression(scoreLabelExpression)
        .done();
      builder
        .field()
        .singleSelect()
        .withName(statusName)
        .withOptions([todoOption, doneOption])
        .done();
      builder
        .field()
        .multipleSelect()
        .withName(tagsName)
        .withOptions([bugOption, featureOption])
        .done();
      builder.field().checkbox().withName(doneName).done();
      builder.field().attachment().withName(filesName).done();
      builder.field().date().withName(dueName).done();
      builder
        .field()
        .user()
        .withName(ownerName)
        .withMultiplicity(UserMultiplicity.multiple())
        .done();
      builder.field().button().withName(actionName).done();
      builder.view().defaultGrid().done();

      const tableResult = builder.build();
      tableResult._unsafeUnwrap();
      const table = tableResult._unsafeUnwrap();

      const resolveResult = resolveFormulaFields(table);
      resolveResult._unsafeUnwrap();
      resolveResult._unsafeUnwrap();

      const dbTableNameValue = table.dbTableName()._unsafeUnwrap();
      tableForCleanup = table;

      const reservedNames = new Set(baseRecordColumnNames);
      for (const field of table.getFields()) {
        const baseName = convertNameToValidCharacter(field.name().toString(), 40);
        const dbFieldName = ensureUniqueDbFieldName(baseName, reservedNames);
        reservedNames.add(dbFieldName);
        const dbFieldNameResult = DbFieldName.rehydrate(dbFieldName);
        dbFieldNameResult._unsafeUnwrap();
        const dbFieldNameValue = dbFieldNameResult._unsafeUnwrap();
        const setFieldDbNameResult = field.setDbFieldName(dbFieldNameValue);
        setFieldDbNameResult._unsafeUnwrap();
        setFieldDbNameResult._unsafeUnwrap();
      }

      const actorIdResult = ActorId.create('system');
      actorIdResult._unsafeUnwrap();
      const context: IExecutionContext = { actorId: actorIdResult._unsafeUnwrap() };
      contextForCleanup = context;

      const insertResult = await repo.insert(context, table);
      insertResult._unsafeUnwrap();
      insertResult._unsafeUnwrap();

      const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
      splitResult._unsafeUnwrap();
      const { schema, tableName: dbTableNameFromSplit } = splitResult._unsafeUnwrap();
      const actualSchemaName = schema ?? 'public';
      const columnsResult = await sql<{ columnName: string; udtName: string }>`
        select column_name as "columnName", udt_name as "udtName"
        from information_schema.columns
        where table_schema = ${actualSchemaName}
          and table_name = ${dbTableNameFromSplit}
      `.execute(db);

      const actualTypes = new Map(columnsResult.rows.map((row) => [row.columnName, row.udtName]));
      const expectedTypes = new Map<string, string>(Object.entries(baseRecordColumnTypes));
      const valueTypeVisitor = new FieldValueTypeVisitor();

      for (const field of table.getFields()) {
        const dbFieldNameResult = field.dbFieldName().andThen((name) => name.value());
        dbFieldNameResult._unsafeUnwrap();
        const valueTypeResult = field.accept(valueTypeVisitor);
        valueTypeResult._unsafeUnwrap();
        const dbFieldNameValue = dbFieldNameResult._unsafeUnwrap();
        const valueType = valueTypeResult._unsafeUnwrap();

        const expectedType = resolveExpectedUdtName(
          field,
          valueType.cellValueType.toString(),
          valueType.isMultipleCellValue.toBoolean()
        );
        expectedTypes.set(dbFieldNameValue, expectedType);
      }

      const mismatches: string[] = [];
      for (const [columnName, expectedType] of expectedTypes) {
        const actualType = actualTypes.get(columnName);
        if (!actualType) {
          mismatches.push(`missing ${columnName}`);
          continue;
        }
        if (actualType !== expectedType) {
          mismatches.push(`${columnName}: expected ${expectedType}, got ${actualType}`);
        }
      }
      expect(mismatches).toEqual([]);
    } finally {
      if (tableForCleanup && contextForCleanup) {
        await repo.delete(contextForCleanup, tableForCleanup);
      }
    }
  });

  describe('link fields ddl', () => {
    it('persists link order meta after schema insert', async () => {
      const c = testContainer.container;

      const db = testContainer.db;
      const tableRepo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);
      const schemaRepo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

      const baseIdResult = BaseId.generate();
      const tableNameResult = TableName.create('Link Meta Table');
      const primaryNameResult = FieldName.create('Title');
      const linkNameResult = FieldName.create('Related');
      const primaryFieldIdResult = FieldId.generate();
      const linkFieldIdResult = FieldId.generate();
      const foreignTableIdResult = TableId.generate();
      const lookupFieldIdResult = FieldId.generate();
      const baseId = baseIdResult._unsafeUnwrap();
      const tableName = tableNameResult._unsafeUnwrap();
      const primaryName = primaryNameResult._unsafeUnwrap();
      const linkName = linkNameResult._unsafeUnwrap();
      const primaryFieldId = primaryFieldIdResult._unsafeUnwrap();
      const linkFieldId = linkFieldIdResult._unsafeUnwrap();
      const foreignTableId = foreignTableIdResult._unsafeUnwrap();
      const lookupFieldId = lookupFieldIdResult._unsafeUnwrap();

      const linkConfigResult = LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        fkHostTableName: joinDbTableName(baseId.toString(), 'link_relations_meta'),
        selfKeyName: '__self_id',
        foreignKeyName: '__foreign_id',
      });
      linkConfigResult._unsafeUnwrap();
      const linkConfig = linkConfigResult._unsafeUnwrap();

      const builder = Table.builder().withBaseId(baseId).withName(tableName);
      builder
        .field()
        .singleLineText()
        .withName(primaryName)
        .withId(primaryFieldId)
        .primary()
        .done();
      builder.view().defaultGrid().done();
      const baseTableResult = builder.build();
      baseTableResult._unsafeUnwrap();
      const baseTable = baseTableResult._unsafeUnwrap();

      const linkFieldResult = createNewLinkField({
        id: linkFieldId,
        name: linkName,
        config: linkConfig,
        baseId,
        hostTableId: baseTable.id(),
      });
      linkFieldResult._unsafeUnwrap();
      const linkFieldValue = linkFieldResult._unsafeUnwrap();

      const tableResult = baseTable.addField(linkFieldValue);
      tableResult._unsafeUnwrap();
      const table = tableResult._unsafeUnwrap();

      const actorIdResult = ActorId.create('system');
      actorIdResult._unsafeUnwrap();
      const context: IExecutionContext = { actorId: actorIdResult._unsafeUnwrap() };

      const persistedTableResult = await tableRepo.insert(context, table);
      persistedTableResult._unsafeUnwrap();
      const persistedTable = persistedTableResult._unsafeUnwrap();

      const schemaInsertResult = await schemaRepo.insert(context, persistedTable);
      schemaInsertResult._unsafeUnwrap();
      schemaInsertResult._unsafeUnwrap();

      const metaRow = await db
        .selectFrom('field')
        .select(['meta'])
        .where('id', '=', linkFieldId.toString())
        .executeTakeFirst();
      const meta = metaRow?.meta ? JSON.parse(metaRow.meta) : null;
      expect(meta).toEqual({ hasOrderColumn: true });
    });

    it('creates manyMany join table columns', async () => {
      const c = testContainer.container;

      const db = testContainer.db;
      const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

      try {
        const baseIdResult = BaseId.generate();
        const tableNameResult = TableName.create('Link Host ManyMany');
        const primaryNameResult = FieldName.create('Title');
        const linkNameResult = FieldName.create('Related');
        const primaryFieldIdResult = FieldId.generate();
        const linkFieldIdResult = FieldId.generate();
        const foreignTableIdResult = TableId.generate();
        const lookupFieldIdResult = FieldId.generate();
        const linkMetaResult = LinkFieldMeta.create({ hasOrderColumn: true });
        [
          baseIdResult,
          tableNameResult,
          primaryNameResult,
          linkNameResult,
          primaryFieldIdResult,
          linkFieldIdResult,
          foreignTableIdResult,
          lookupFieldIdResult,
          linkMetaResult,
        ].forEach((r) => r._unsafeUnwrap());
        const baseId = baseIdResult._unsafeUnwrap();
        const tableName = tableNameResult._unsafeUnwrap();
        const primaryName = primaryNameResult._unsafeUnwrap();
        const linkName = linkNameResult._unsafeUnwrap();
        const primaryFieldId = primaryFieldIdResult._unsafeUnwrap();
        const linkFieldId = linkFieldIdResult._unsafeUnwrap();
        const foreignTableId = foreignTableIdResult._unsafeUnwrap();
        const lookupFieldId = lookupFieldIdResult._unsafeUnwrap();
        const linkMeta = linkMetaResult._unsafeUnwrap();

        const linkConfigResult = LinkFieldConfig.create({
          relationship: 'manyMany',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupFieldId.toString(),
          fkHostTableName: joinDbTableName(baseId.toString(), 'link_relations_mm'),
          selfKeyName: '__self_id',
          foreignKeyName: '__foreign_id',
        });
        linkConfigResult._unsafeUnwrap();
        const linkConfig = linkConfigResult._unsafeUnwrap();

        const builder = Table.builder().withBaseId(baseId).withName(tableName);
        builder
          .field()
          .singleLineText()
          .withName(primaryName)
          .withId(primaryFieldId)
          .primary()
          .done();
        builder.view().defaultGrid().done();
        const baseTableResult = builder.build();
        baseTableResult._unsafeUnwrap();
        const baseTable = baseTableResult._unsafeUnwrap();

        const linkFieldResult = createNewLinkField({
          id: linkFieldId,
          name: linkName,
          config: linkConfig,
          meta: linkMeta,
          baseId,
          hostTableId: baseTable.id(),
        });
        linkFieldResult._unsafeUnwrap();
        const linkFieldValue = linkFieldResult._unsafeUnwrap() as LinkField;

        const tableResult = baseTable.addField(linkFieldValue);
        tableResult._unsafeUnwrap();
        const table = tableResult._unsafeUnwrap();

        const dbTableNameValue = table.dbTableName()._unsafeUnwrap();

        const primaryField = getFieldById(table, primaryFieldId);
        const linkField = getFieldById(table, linkFieldId);
        expect(primaryField).toBeDefined();
        expect(linkField).toBeDefined();
        if (!primaryField || !linkField) return;

        const primaryDbNameResult = DbFieldName.rehydrate('title');
        const linkDbNameResult = DbFieldName.rehydrate('link_value_mm');
        [primaryDbNameResult, linkDbNameResult].forEach((r) => r._unsafeUnwrap());
        const primaryDbName = primaryDbNameResult._unsafeUnwrap();
        const linkDbName = linkDbNameResult._unsafeUnwrap();
        primaryField.setDbFieldName(primaryDbName)._unsafeUnwrap();
        linkField.setDbFieldName(linkDbName)._unsafeUnwrap();

        const actorIdResult = ActorId.create('system');
        actorIdResult._unsafeUnwrap();
        const context: IExecutionContext = { actorId: actorIdResult._unsafeUnwrap() };

        const insertResult = await repo.insert(context, table);
        insertResult._unsafeUnwrap();
        insertResult._unsafeUnwrap();

        const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
        splitResult._unsafeUnwrap();
        const { schema, tableName: dbTableNameFromSplit } = splitResult._unsafeUnwrap();
        const actualSchemaName = schema ?? 'public';
        const hostColumns = await fetchColumnTypes(db, dbTableNameFromSplit, actualSchemaName);
        expect(hostColumns.get('link_value_mm')).toBe('jsonb');
        expect(hostColumns.has('__self_id')).toBe(false);
        expect(hostColumns.has('__foreign_id')).toBe(false);

        const joinTableDbName = linkFieldValue.fkHostTableName();
        const joinTable = joinTableDbName.split({ defaultSchema: 'public' });
        joinTable._unsafeUnwrap();
        const joinTableInfo = joinTable._unsafeUnwrap();
        const joinSchema = joinTableInfo.schema ?? 'public';
        const joinColumns = await fetchColumnTypes(db, joinTableInfo.tableName, joinSchema);
        expect(joinColumns.get('__self_id')).toBe('text');
        expect(joinColumns.get('__foreign_id')).toBe('text');
        expect(joinColumns.get('__order')).toBe('float8');

        // Verify indexes on junction table
        const joinIndexes = await fetchIndexes(db, joinTableInfo.tableName, joinSchema);
        const selfKeyIndex = joinIndexes.find((idx) => idx.indexName === 'index___self_id');
        const foreignKeyIndex = joinIndexes.find((idx) => idx.indexName === 'index___foreign_id');
        expect(selfKeyIndex).toBeDefined();
        expect(selfKeyIndex?.columnNames).toEqual(['__self_id']);
        expect(selfKeyIndex?.isUnique).toBe(false);
        expect(foreignKeyIndex).toBeDefined();
        expect(foreignKeyIndex?.columnNames).toEqual(['__foreign_id']);
        expect(foreignKeyIndex?.isUnique).toBe(false);
      } finally {
        // no cleanup required
        void 0;
      }
    });

    it('creates oneMany foreign key columns on host table', async () => {
      const c = testContainer.container;

      const db = testContainer.db;
      const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

      try {
        const baseIdResult = BaseId.generate();
        const tableNameResult = TableName.create('Link Host OneMany');
        const primaryNameResult = FieldName.create('Title');
        const linkNameResult = FieldName.create('Related');
        const primaryFieldIdResult = FieldId.generate();
        const linkFieldIdResult = FieldId.generate();
        const foreignTableIdResult = TableId.generate();
        const lookupFieldIdResult = FieldId.generate();
        const linkMetaResult = LinkFieldMeta.create({ hasOrderColumn: true });
        [
          baseIdResult,
          tableNameResult,
          primaryNameResult,
          linkNameResult,
          primaryFieldIdResult,
          linkFieldIdResult,
          foreignTableIdResult,
          lookupFieldIdResult,
          linkMetaResult,
        ].forEach((r) => r._unsafeUnwrap());
        const baseId = baseIdResult._unsafeUnwrap();
        const tableName = tableNameResult._unsafeUnwrap();
        const primaryName = primaryNameResult._unsafeUnwrap();
        const linkName = linkNameResult._unsafeUnwrap();
        const primaryFieldId = primaryFieldIdResult._unsafeUnwrap();
        const linkFieldId = linkFieldIdResult._unsafeUnwrap();
        const foreignTableId = foreignTableIdResult._unsafeUnwrap();
        const lookupFieldId = lookupFieldIdResult._unsafeUnwrap();
        const linkMeta = linkMetaResult._unsafeUnwrap();

        const builder = Table.builder().withBaseId(baseId).withName(tableName);
        builder
          .field()
          .singleLineText()
          .withName(primaryName)
          .withId(primaryFieldId)
          .primary()
          .done();
        builder.view().defaultGrid().done();
        const baseTableResult = builder.build();
        baseTableResult._unsafeUnwrap();
        const baseTable = baseTableResult._unsafeUnwrap();

        const hostDbTableName = baseTable
          .dbTableName()
          .andThen((name) => name.value())
          ._unsafeUnwrap();
        const linkConfig = LinkFieldConfig.create({
          relationship: 'oneMany',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupFieldId.toString(),
          fkHostTableName: hostDbTableName,
          selfKeyName: '__self_id',
          foreignKeyName: '__foreign_id',
        })._unsafeUnwrap();

        const linkFieldResult = createNewLinkField({
          id: linkFieldId,
          name: linkName,
          config: linkConfig,
          meta: linkMeta,
          baseId,
          hostTableId: baseTable.id(),
        });
        linkFieldResult._unsafeUnwrap();
        const linkFieldValue = linkFieldResult._unsafeUnwrap() as LinkField;

        const tableResult = baseTable.addField(linkFieldValue);
        tableResult._unsafeUnwrap();
        const table = tableResult._unsafeUnwrap();

        const dbTableNameValue = table.dbTableName()._unsafeUnwrap();

        const primaryField = getFieldById(table, primaryFieldId);
        const linkField = getFieldById(table, linkFieldId);
        expect(primaryField).toBeDefined();
        expect(linkField).toBeDefined();
        if (!primaryField || !linkField) return;

        const primaryDbNameResult = DbFieldName.rehydrate('title');
        const linkDbNameResult = DbFieldName.rehydrate('link_value_om');
        [primaryDbNameResult, linkDbNameResult].forEach((r) => r._unsafeUnwrap());
        const primaryDbName = primaryDbNameResult._unsafeUnwrap();
        const linkDbName = linkDbNameResult._unsafeUnwrap();
        primaryField.setDbFieldName(primaryDbName)._unsafeUnwrap();
        linkField.setDbFieldName(linkDbName)._unsafeUnwrap();

        const actorIdResult = ActorId.create('system');
        actorIdResult._unsafeUnwrap();
        const context: IExecutionContext = { actorId: actorIdResult._unsafeUnwrap() };

        const insertResult = await repo.insert(context, table);
        insertResult._unsafeUnwrap();
        insertResult._unsafeUnwrap();

        const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
        splitResult._unsafeUnwrap();
        const { schema, tableName: dbTableNameFromSplit } = splitResult._unsafeUnwrap();
        const actualSchemaName = schema ?? 'public';
        const hostColumns = await fetchColumnTypes(db, dbTableNameFromSplit, actualSchemaName);
        expect(hostColumns.get('link_value_om')).toBe('jsonb');
        expect(hostColumns.get('__self_id')).toBe('text');
        expect(hostColumns.get('__self_id_order')).toBe('float8');

        // Verify index on FK column
        const hostIndexes = await fetchIndexes(db, dbTableNameFromSplit, actualSchemaName);
        const selfKeyIndex = hostIndexes.find((idx) => idx.indexName === 'index___self_id');
        expect(selfKeyIndex).toBeDefined();
        expect(selfKeyIndex?.columnNames).toEqual(['__self_id']);
        expect(selfKeyIndex?.isUnique).toBe(false);
      } finally {
        // no cleanup required
        void 0;
      }
    });

    it('creates oneMany one-way join table columns', async () => {
      const c = testContainer.container;

      const db = testContainer.db;
      const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

      try {
        const baseIdResult = BaseId.generate();
        const tableNameResult = TableName.create('Link Host OneMany OneWay');
        const primaryNameResult = FieldName.create('Title');
        const linkNameResult = FieldName.create('Related');
        const primaryFieldIdResult = FieldId.generate();
        const linkFieldIdResult = FieldId.generate();
        const foreignTableIdResult = TableId.generate();
        const lookupFieldIdResult = FieldId.generate();
        [
          baseIdResult,
          tableNameResult,
          primaryNameResult,
          linkNameResult,
          primaryFieldIdResult,
          linkFieldIdResult,
          foreignTableIdResult,
          lookupFieldIdResult,
        ].forEach((r) => r._unsafeUnwrap());
        const baseId = baseIdResult._unsafeUnwrap();
        const tableName = tableNameResult._unsafeUnwrap();
        const primaryName = primaryNameResult._unsafeUnwrap();
        const linkName = linkNameResult._unsafeUnwrap();
        const primaryFieldId = primaryFieldIdResult._unsafeUnwrap();
        const linkFieldId = linkFieldIdResult._unsafeUnwrap();
        const foreignTableId = foreignTableIdResult._unsafeUnwrap();
        const lookupFieldId = lookupFieldIdResult._unsafeUnwrap();

        const builder = Table.builder().withBaseId(baseId).withName(tableName);
        builder
          .field()
          .singleLineText()
          .withName(primaryName)
          .withId(primaryFieldId)
          .primary()
          .done();
        builder.view().defaultGrid().done();
        const baseTableResult = builder.build();
        baseTableResult._unsafeUnwrap();
        const baseTable = baseTableResult._unsafeUnwrap();

        const linkConfig = LinkFieldConfig.create({
          relationship: 'oneMany',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupFieldId.toString(),
          isOneWay: true,
          fkHostTableName: joinDbTableName(baseId.toString(), 'link_relations_om_oneway'),
          selfKeyName: '__self_id',
          foreignKeyName: '__foreign_id',
        })._unsafeUnwrap();

        const linkFieldResult = createNewLinkField({
          id: linkFieldId,
          name: linkName,
          config: linkConfig,
          baseId,
          hostTableId: baseTable.id(),
        });
        linkFieldResult._unsafeUnwrap();
        const linkFieldValue = linkFieldResult._unsafeUnwrap() as LinkField;

        const tableResult = baseTable.addField(linkFieldValue);
        tableResult._unsafeUnwrap();
        const table = tableResult._unsafeUnwrap();

        const dbTableNameValue = table.dbTableName()._unsafeUnwrap();

        const primaryField = getFieldById(table, primaryFieldId);
        const linkField = getFieldById(table, linkFieldId);
        expect(primaryField).toBeDefined();
        expect(linkField).toBeDefined();
        if (!primaryField || !linkField) return;

        const primaryDbNameResult = DbFieldName.rehydrate('title');
        const linkDbNameResult = DbFieldName.rehydrate('link_value_om_oneway');
        [primaryDbNameResult, linkDbNameResult].forEach((r) => r._unsafeUnwrap());
        const primaryDbName = primaryDbNameResult._unsafeUnwrap();
        const linkDbName = linkDbNameResult._unsafeUnwrap();
        primaryField.setDbFieldName(primaryDbName)._unsafeUnwrap();
        linkField.setDbFieldName(linkDbName)._unsafeUnwrap();

        const actorIdResult = ActorId.create('system');
        actorIdResult._unsafeUnwrap();
        const context: IExecutionContext = { actorId: actorIdResult._unsafeUnwrap() };

        const insertResult = await repo.insert(context, table);
        insertResult._unsafeUnwrap();
        insertResult._unsafeUnwrap();

        const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
        splitResult._unsafeUnwrap();
        const { schema, tableName: dbTableNameFromSplit } = splitResult._unsafeUnwrap();
        const actualSchemaName = schema ?? 'public';
        const hostColumns = await fetchColumnTypes(db, dbTableNameFromSplit, actualSchemaName);
        expect(hostColumns.get('link_value_om_oneway')).toBe('jsonb');
        expect(hostColumns.has('__self_id')).toBe(false);
        expect(hostColumns.has('__foreign_id')).toBe(false);

        const joinTableDbName = linkFieldValue.fkHostTableName();
        const joinTable = joinTableDbName.split({ defaultSchema: 'public' });
        joinTable._unsafeUnwrap();
        const joinTableInfo = joinTable._unsafeUnwrap();
        const joinSchema = joinTableInfo.schema ?? 'public';
        const joinColumns = await fetchColumnTypes(db, joinTableInfo.tableName, joinSchema);
        expect(joinColumns.has('__id')).toBe(true);
        expect(joinColumns.get('__self_id')).toBe('text');
        expect(joinColumns.get('__foreign_id')).toBe('text');
        expect(joinColumns.has('__order')).toBe(false);
      } finally {
        // no cleanup required
        void 0;
      }
    });

    it('creates manyOne foreign key columns on host table', async () => {
      const c = testContainer.container;

      const db = testContainer.db;
      const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

      try {
        const baseIdResult = BaseId.generate();
        const tableNameResult = TableName.create('Link Host ManyOne');
        const primaryNameResult = FieldName.create('Title');
        const linkNameResult = FieldName.create('Related');
        const primaryFieldIdResult = FieldId.generate();
        const linkFieldIdResult = FieldId.generate();
        const foreignTableIdResult = TableId.generate();
        const lookupFieldIdResult = FieldId.generate();
        [
          baseIdResult,
          tableNameResult,
          primaryNameResult,
          linkNameResult,
          primaryFieldIdResult,
          linkFieldIdResult,
          foreignTableIdResult,
          lookupFieldIdResult,
        ].forEach((r) => r._unsafeUnwrap());
        const baseId = baseIdResult._unsafeUnwrap();
        const tableName = tableNameResult._unsafeUnwrap();
        const primaryName = primaryNameResult._unsafeUnwrap();
        const linkName = linkNameResult._unsafeUnwrap();
        const primaryFieldId = primaryFieldIdResult._unsafeUnwrap();
        const linkFieldId = linkFieldIdResult._unsafeUnwrap();
        const foreignTableId = foreignTableIdResult._unsafeUnwrap();
        const lookupFieldId = lookupFieldIdResult._unsafeUnwrap();

        const builder = Table.builder().withBaseId(baseId).withName(tableName);
        builder
          .field()
          .singleLineText()
          .withName(primaryName)
          .withId(primaryFieldId)
          .primary()
          .done();
        builder.view().defaultGrid().done();
        const baseTableResult = builder.build();
        baseTableResult._unsafeUnwrap();
        const baseTable = baseTableResult._unsafeUnwrap();

        const hostDbTableName = baseTable
          .dbTableName()
          .andThen((name) => name.value())
          ._unsafeUnwrap();
        const linkConfig = LinkFieldConfig.create({
          relationship: 'manyOne',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupFieldId.toString(),
          fkHostTableName: hostDbTableName,
          selfKeyName: '__self_id',
          foreignKeyName: '__foreign_id',
        })._unsafeUnwrap();

        const linkFieldResult = createNewLinkField({
          id: linkFieldId,
          name: linkName,
          config: linkConfig,
          baseId,
          hostTableId: baseTable.id(),
        });
        linkFieldResult._unsafeUnwrap();
        const linkFieldValue = linkFieldResult._unsafeUnwrap() as LinkField;

        const tableResult = baseTable.addField(linkFieldValue);
        tableResult._unsafeUnwrap();
        const table = tableResult._unsafeUnwrap();

        const dbTableNameValue = table.dbTableName()._unsafeUnwrap();

        const primaryField = getFieldById(table, primaryFieldId);
        const linkField = getFieldById(table, linkFieldId);
        expect(primaryField).toBeDefined();
        expect(linkField).toBeDefined();
        if (!primaryField || !linkField) return;

        const primaryDbNameResult = DbFieldName.rehydrate('title');
        const linkDbNameResult = DbFieldName.rehydrate('link_value_mo');
        [primaryDbNameResult, linkDbNameResult].forEach((r) => r._unsafeUnwrap());
        const primaryDbName = primaryDbNameResult._unsafeUnwrap();
        const linkDbName = linkDbNameResult._unsafeUnwrap();
        primaryField.setDbFieldName(primaryDbName)._unsafeUnwrap();
        linkField.setDbFieldName(linkDbName)._unsafeUnwrap();

        const actorIdResult = ActorId.create('system');
        actorIdResult._unsafeUnwrap();
        const context: IExecutionContext = { actorId: actorIdResult._unsafeUnwrap() };

        const insertResult = await repo.insert(context, table);
        insertResult._unsafeUnwrap();
        insertResult._unsafeUnwrap();

        const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
        splitResult._unsafeUnwrap();
        const { schema, tableName: dbTableNameFromSplit } = splitResult._unsafeUnwrap();
        const actualSchemaName = schema ?? 'public';
        const hostColumns = await fetchColumnTypes(db, dbTableNameFromSplit, actualSchemaName);
        expect(hostColumns.get('link_value_mo')).toBe('jsonb');
        expect(hostColumns.get('__foreign_id')).toBe('text');

        // Verify index on FK column
        const hostIndexes = await fetchIndexes(db, dbTableNameFromSplit, actualSchemaName);
        const foreignKeyIndex = hostIndexes.find((idx) => idx.indexName === 'index___foreign_id');
        expect(foreignKeyIndex).toBeDefined();
        expect(foreignKeyIndex?.columnNames).toEqual(['__foreign_id']);
        expect(foreignKeyIndex?.isUnique).toBe(false);
      } finally {
        // no cleanup required
        void 0;
      }
    });

    it('creates oneOne foreign key columns on host table', async () => {
      const c = testContainer.container;

      const db = testContainer.db;
      const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

      try {
        const baseIdResult = BaseId.generate();
        const tableNameResult = TableName.create('Link Host OneOne');
        const primaryNameResult = FieldName.create('Title');
        const linkNameResult = FieldName.create('Related');
        const primaryFieldIdResult = FieldId.generate();
        const linkFieldIdResult = FieldId.generate();
        const foreignTableIdResult = TableId.generate();
        const lookupFieldIdResult = FieldId.generate();
        [
          baseIdResult,
          tableNameResult,
          primaryNameResult,
          linkNameResult,
          primaryFieldIdResult,
          linkFieldIdResult,
          foreignTableIdResult,
          lookupFieldIdResult,
        ].forEach((r) => r._unsafeUnwrap());
        const baseId = baseIdResult._unsafeUnwrap();
        const tableName = tableNameResult._unsafeUnwrap();
        const primaryName = primaryNameResult._unsafeUnwrap();
        const linkName = linkNameResult._unsafeUnwrap();
        const primaryFieldId = primaryFieldIdResult._unsafeUnwrap();
        const linkFieldId = linkFieldIdResult._unsafeUnwrap();
        const foreignTableId = foreignTableIdResult._unsafeUnwrap();
        const lookupFieldId = lookupFieldIdResult._unsafeUnwrap();

        const builder = Table.builder().withBaseId(baseId).withName(tableName);
        builder
          .field()
          .singleLineText()
          .withName(primaryName)
          .withId(primaryFieldId)
          .primary()
          .done();
        builder.view().defaultGrid().done();
        const baseTableResult = builder.build();
        baseTableResult._unsafeUnwrap();
        const baseTable = baseTableResult._unsafeUnwrap();

        const hostDbTableName = baseTable
          .dbTableName()
          .andThen((name) => name.value())
          ._unsafeUnwrap();
        const linkConfig = LinkFieldConfig.create({
          relationship: 'oneOne',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupFieldId.toString(),
          fkHostTableName: hostDbTableName,
          selfKeyName: '__self_id',
          foreignKeyName: '__foreign_id',
        })._unsafeUnwrap();

        const linkFieldResult = createNewLinkField({
          id: linkFieldId,
          name: linkName,
          config: linkConfig,
          baseId,
          hostTableId: baseTable.id(),
        });
        linkFieldResult._unsafeUnwrap();
        const linkFieldValue = linkFieldResult._unsafeUnwrap() as LinkField;

        const tableResult = baseTable.addField(linkFieldValue);
        tableResult._unsafeUnwrap();
        const table = tableResult._unsafeUnwrap();

        const dbTableNameValue = table.dbTableName()._unsafeUnwrap();

        const primaryField = getFieldById(table, primaryFieldId);
        const linkField = getFieldById(table, linkFieldId);
        expect(primaryField).toBeDefined();
        expect(linkField).toBeDefined();
        if (!primaryField || !linkField) return;

        const primaryDbNameResult = DbFieldName.rehydrate('title');
        const linkDbNameResult = DbFieldName.rehydrate('link_value_oo');
        [primaryDbNameResult, linkDbNameResult].forEach((r) => r._unsafeUnwrap());
        const primaryDbName = primaryDbNameResult._unsafeUnwrap();
        const linkDbName = linkDbNameResult._unsafeUnwrap();
        primaryField.setDbFieldName(primaryDbName)._unsafeUnwrap();
        linkField.setDbFieldName(linkDbName)._unsafeUnwrap();

        const actorIdResult = ActorId.create('system');
        actorIdResult._unsafeUnwrap();
        const context: IExecutionContext = { actorId: actorIdResult._unsafeUnwrap() };

        const insertResult = await repo.insert(context, table);
        insertResult._unsafeUnwrap();
        insertResult._unsafeUnwrap();

        const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
        splitResult._unsafeUnwrap();
        const { schema, tableName: dbTableNameFromSplit } = splitResult._unsafeUnwrap();
        const actualSchemaName = schema ?? 'public';
        const hostColumns = await fetchColumnTypes(db, dbTableNameFromSplit, actualSchemaName);
        expect(hostColumns.get('link_value_oo')).toBe('jsonb');
        expect(hostColumns.get('__foreign_id')).toBe('text');

        // Verify UNIQUE index on FK column for oneOne relationship
        const hostIndexes = await fetchIndexes(db, dbTableNameFromSplit, actualSchemaName);
        const foreignKeyIndex = hostIndexes.find((idx) => idx.indexName === 'index___foreign_id');
        expect(foreignKeyIndex).toBeDefined();
        expect(foreignKeyIndex?.columnNames).toEqual(['__foreign_id']);
        expect(foreignKeyIndex?.isUnique).toBe(true);
      } finally {
        // shared container disposed in afterAll
      }
    });

    it('creates self-referencing link fields for all relationships', async () => {
      const c = testContainer.container;

      const db = testContainer.db;
      const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

      const cases = [
        {
          relationship: 'manyMany',
          tableLabel: 'Link Self ManyMany',
          joinTableName: 'link_relations_mm_self',
          linkColumn: 'link_value_mm_self',
          includeOrder: true,
          expectHostTypes: {
            link_value_mm_self: 'jsonb',
          },
          expectJoin: true,
        },
        {
          relationship: 'oneMany',
          tableLabel: 'Link Self OneMany',
          linkColumn: 'link_value_om_self',
          includeOrder: true,
          expectHostTypes: {
            link_value_om_self: 'jsonb',
            __self_id: 'text',
            __self_id_order: 'float8',
          },
          expectJoin: false,
        },
        {
          relationship: 'manyOne',
          tableLabel: 'Link Self ManyOne',
          linkColumn: 'link_value_mo_self',
          includeOrder: false,
          expectHostTypes: {
            link_value_mo_self: 'jsonb',
            __foreign_id: 'text',
          },
          expectJoin: false,
        },
        {
          relationship: 'oneOne',
          tableLabel: 'Link Self OneOne',
          linkColumn: 'link_value_oo_self',
          includeOrder: false,
          expectHostTypes: {
            link_value_oo_self: 'jsonb',
            __foreign_id: 'text',
          },
          expectJoin: false,
        },
      ] as const;

      for (const entry of cases) {
        const baseIdResult = BaseId.generate();
        const tableNameResult = TableName.create(entry.tableLabel);
        const primaryNameResult = FieldName.create('Title');
        const linkNameResult = FieldName.create('Related');
        const primaryFieldIdResult = FieldId.generate();
        const linkFieldIdResult = FieldId.generate();
        const lookupFieldIdResult = FieldId.generate();
        const linkMetaResult = entry.includeOrder
          ? LinkFieldMeta.create({ hasOrderColumn: true })
          : ok(undefined);

        [
          baseIdResult,
          tableNameResult,
          primaryNameResult,
          linkNameResult,
          primaryFieldIdResult,
          linkFieldIdResult,
          lookupFieldIdResult,
          linkMetaResult,
        ].forEach((r) => r._unsafeUnwrap());
        baseIdResult._unsafeUnwrap();
        tableNameResult._unsafeUnwrap();
        primaryNameResult._unsafeUnwrap();
        linkNameResult._unsafeUnwrap();
        primaryFieldIdResult._unsafeUnwrap();
        linkFieldIdResult._unsafeUnwrap();
        lookupFieldIdResult._unsafeUnwrap();
        linkMetaResult._unsafeUnwrap();

        const baseId = baseIdResult._unsafeUnwrap();
        const tableName = tableNameResult._unsafeUnwrap();
        const primaryName = primaryNameResult._unsafeUnwrap();
        const linkName = linkNameResult._unsafeUnwrap();
        const primaryFieldId = primaryFieldIdResult._unsafeUnwrap();
        const linkFieldId = linkFieldIdResult._unsafeUnwrap();
        const lookupFieldId = lookupFieldIdResult._unsafeUnwrap();
        const linkMeta = linkMetaResult._unsafeUnwrap();

        const builder = Table.builder().withBaseId(baseId).withName(tableName);
        builder
          .field()
          .singleLineText()
          .withName(primaryName)
          .withId(primaryFieldId)
          .primary()
          .done();
        builder.view().defaultGrid().done();
        const baseTableResult = builder.build();
        baseTableResult._unsafeUnwrap();

        const baseTable = baseTableResult._unsafeUnwrap();

        const hostDbTableName = baseTable
          .dbTableName()
          .andThen((name) => name.value())
          ._unsafeUnwrap();
        const fkHostTableName = entry.expectJoin
          ? joinDbTableName(baseId.toString(), entry.joinTableName ?? 'link_relations')
          : hostDbTableName;

        const linkConfigResult = LinkFieldConfig.create({
          relationship: entry.relationship,
          foreignTableId: baseTable.id().toString(),
          lookupFieldId: lookupFieldId.toString(),
          fkHostTableName,
          selfKeyName: '__self_id',
          foreignKeyName: '__foreign_id',
        });
        linkConfigResult._unsafeUnwrap();

        const linkConfig = linkConfigResult._unsafeUnwrap();

        const linkFieldResult = createNewLinkField({
          id: linkFieldId,
          name: linkName,
          config: linkConfig,
          meta: linkMeta,
          baseId,
          hostTableId: baseTable.id(),
        });
        linkFieldResult._unsafeUnwrap();

        const linkFieldValue = linkFieldResult._unsafeUnwrap() as LinkField;

        const tableResult = baseTable.addField(linkFieldValue);
        tableResult._unsafeUnwrap();

        const table = tableResult._unsafeUnwrap();

        const dbTableNameValue = table.dbTableName()._unsafeUnwrap();

        const primaryField = getFieldById(table, primaryFieldId);
        const linkField = getFieldById(table, linkFieldId);
        expect(primaryField).toBeDefined();
        expect(linkField).toBeDefined();
        if (!primaryField || !linkField) continue;

        const primaryDbNameResult = DbFieldName.rehydrate('title');
        const linkDbNameResult = DbFieldName.rehydrate(entry.linkColumn);
        [primaryDbNameResult, linkDbNameResult].forEach((r) => r._unsafeUnwrap());
        primaryDbNameResult._unsafeUnwrap();
        linkDbNameResult._unsafeUnwrap();
        const primaryDbName = primaryDbNameResult._unsafeUnwrap();
        const linkDbName = linkDbNameResult._unsafeUnwrap();
        primaryField.setDbFieldName(primaryDbName)._unsafeUnwrap();
        linkField.setDbFieldName(linkDbName)._unsafeUnwrap();

        const actorIdResult = ActorId.create('system');
        actorIdResult._unsafeUnwrap();

        const context: IExecutionContext = { actorId: actorIdResult._unsafeUnwrap() };

        const insertResult = await repo.insert(context, table);
        insertResult._unsafeUnwrap();
        insertResult._unsafeUnwrap();

        const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
        splitResult._unsafeUnwrap();

        const { schema, tableName: dbTableNameFromSplit } = splitResult._unsafeUnwrap();
        const actualSchemaName = schema ?? 'public';
        const hostColumns = await fetchColumnTypes(db, dbTableNameFromSplit, actualSchemaName);
        for (const [column, expectedType] of Object.entries(entry.expectHostTypes)) {
          const actualType = hostColumns.get(column);
          expect(actualType).toBe(expectedType);
        }

        if (entry.expectJoin) {
          const joinTableDbName = linkFieldValue.fkHostTableName();
          const joinTable = joinTableDbName.split({ defaultSchema: 'public' });
          joinTable._unsafeUnwrap();

          const joinInfo = joinTable._unsafeUnwrap();
          const joinSchema = joinInfo.schema ?? 'public';
          const joinColumns = await fetchColumnTypes(db, joinInfo.tableName, joinSchema);
          expect(joinColumns.get('__self_id')).toBe('text');
          expect(joinColumns.get('__foreign_id')).toBe('text');
          expect(joinColumns.get('__order')).toBe('float8');
        }
      }
    });
  });
});
