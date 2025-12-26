/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import type { IExecutionContext, ITableSchemaRepository } from '@teable/v2-core';
import {
  ActorId,
  BaseId,
  DbFieldName,
  DbTableName,
  FieldId,
  FieldName,
  FieldValueTypeVisitor,
  FormulaExpression,
  LinkFieldConfig,
  LinkFieldMeta,
  RatingMax,
  SelectOption,
  Table,
  TableName,
  TableId,
  createNewLinkField,
  getRandomString,
  UserMultiplicity,
  v2CoreTokens,
  resolveFormulaFields,
} from '@teable/v2-core';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
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

const unwrapResult = <T>(result: Result<T, string>): T => {
  const unwrapped = safeTry<T, string>(function* () {
    const value = yield* result;
    return ok(value);
  });
  if (unwrapped.isOk()) return unwrapped.value;
  throw new Error(unwrapped.error);
};

const resolveExpectedUdtName = (
  fieldType: string,
  cellValueType: string,
  isMultipleCellValue: boolean
): string => {
  if (isMultipleCellValue) return 'jsonb';
  if (['attachment', 'user', 'button'].includes(fieldType)) return 'jsonb';

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
  db: Kysely<unknown>,
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

describe('PostgresTableSchemaRepository (pg)', () => {
  let testContainer: IV2NodeTestContainer;
  const createSchemaName = (): string => `t_${getRandomString(8)}`;

  beforeAll(async () => {
    testContainer = await createV2NodeTestContainer();
  });

  afterAll(async () => {
    await testContainer.dispose();
  });

  it('creates record table and field columns', async () => {
    const c = testContainer.container;

    const db = c.resolve<Kysely<unknown>>(v2PostgresDbTokens.db);
    const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

    try {
      const testSchemaName = createSchemaName();
      const baseIdResult = BaseId.generate();
      expect(baseIdResult.isOk()).toBe(true);
      const baseId = unwrapResult(baseIdResult);

      const tableNameResult = TableName.create('Project Items');
      const titleNameResult = FieldName.create('Task Name');
      const ratingNameResult = FieldName.create('Priority Level');
      const statusNameResult = FieldName.create('Status');
      expect(
        [tableNameResult, titleNameResult, ratingNameResult, statusNameResult].every((r) =>
          r.isOk()
        )
      ).toBe(true);
      const tableName = unwrapResult(tableNameResult);
      const titleName = unwrapResult(titleNameResult);
      const ratingName = unwrapResult(ratingNameResult);
      const statusName = unwrapResult(statusNameResult);

      const todoOptionResult = SelectOption.create({ name: 'Todo', color: 'blue' });
      const doneOptionResult = SelectOption.create({ name: 'Done', color: 'red' });
      expect([todoOptionResult, doneOptionResult].every((r) => r.isOk())).toBe(true);
      const todoOption = unwrapResult(todoOptionResult);
      const doneOption = unwrapResult(doneOptionResult);

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
      expect(tableResult.isOk()).toBe(true);
      const table = unwrapResult(tableResult);

      const dbTableName = joinDbTableName(
        testSchemaName,
        convertNameToValidCharacter(table.name().toString(), 40)
      );
      const reservedNames = new Set(baseRecordColumnNames);
      const fieldDbNames: string[] = [];

      const dbTableNameResult = DbTableName.rehydrate(dbTableName);
      expect(dbTableNameResult.isOk()).toBe(true);
      const dbTableNameValue = unwrapResult(dbTableNameResult);
      const setTableDbNameResult = table.setDbTableName(dbTableNameValue);
      expect(setTableDbNameResult.isOk()).toBe(true);
      unwrapResult(setTableDbNameResult);

      for (const field of table.fields()) {
        const baseName = convertNameToValidCharacter(field.name().toString(), 40);
        const dbFieldName = ensureUniqueDbFieldName(baseName, reservedNames);
        reservedNames.add(dbFieldName);
        fieldDbNames.push(dbFieldName);
        const dbFieldNameResult = DbFieldName.rehydrate(dbFieldName);
        expect(dbFieldNameResult.isOk()).toBe(true);
        const dbFieldNameValue = unwrapResult(dbFieldNameResult);
        const setFieldDbNameResult = field.setDbFieldName(dbFieldNameValue);
        expect(setFieldDbNameResult.isOk()).toBe(true);
        unwrapResult(setFieldDbNameResult);
      }

      const actorIdResult = ActorId.create('system');
      expect(actorIdResult.isOk()).toBe(true);
      const context: IExecutionContext = { actorId: unwrapResult(actorIdResult) };

      const insertResult = await repo.insert(context, table);
      expect(insertResult.isOk()).toBe(true);
      unwrapResult(insertResult);

      const expectedBaseColumns = baseRecordColumnNames;
      const expectedFieldColumns = fieldDbNames;

      const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
      expect(splitResult.isOk()).toBe(true);
      const { schema, tableName: dbTableNameFromSplit } = unwrapResult(splitResult);
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

  it('uses v1-compatible column types for fields', async () => {
    const c = testContainer.container;

    const db = c.resolve<Kysely<unknown>>(v2PostgresDbTokens.db);
    const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);
    let tableForCleanup: Table | undefined;
    let contextForCleanup: IExecutionContext | undefined;

    try {
      const testSchemaName = createSchemaName();
      const baseIdResult = BaseId.generate();
      expect(baseIdResult.isOk()).toBe(true);
      const baseId = unwrapResult(baseIdResult);

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

      expect(
        [
          tableNameResult,
          titleNameResult,
          descriptionNameResult,
          amountNameResult,
          ratingNameResult,
          scoreNameResult,
          scoreLabelNameResult,
          statusNameResult,
          tagsNameResult,
          doneNameResult,
          filesNameResult,
          dueNameResult,
          ownerNameResult,
          actionNameResult,
          titleFieldIdResult,
          amountFieldIdResult,
          scoreExpressionResult,
          scoreLabelExpressionResult,
          todoOptionResult,
          doneOptionResult,
          bugOptionResult,
          featureOptionResult,
        ].every((r) => r.isOk())
      ).toBe(true);
      const tableName = unwrapResult(tableNameResult);
      const titleName = unwrapResult(titleNameResult);
      const descriptionName = unwrapResult(descriptionNameResult);
      const amountName = unwrapResult(amountNameResult);
      const ratingName = unwrapResult(ratingNameResult);
      const scoreName = unwrapResult(scoreNameResult);
      const scoreLabelName = unwrapResult(scoreLabelNameResult);
      const statusName = unwrapResult(statusNameResult);
      const tagsName = unwrapResult(tagsNameResult);
      const doneName = unwrapResult(doneNameResult);
      const filesName = unwrapResult(filesNameResult);
      const dueName = unwrapResult(dueNameResult);
      const ownerName = unwrapResult(ownerNameResult);
      const actionName = unwrapResult(actionNameResult);
      const titleFieldId = unwrapResult(titleFieldIdResult);
      const amountFieldId = unwrapResult(amountFieldIdResult);
      const scoreExpression = unwrapResult(scoreExpressionResult);
      const scoreLabelExpression = unwrapResult(scoreLabelExpressionResult);
      const todoOption = unwrapResult(todoOptionResult);
      const doneOption = unwrapResult(doneOptionResult);
      const bugOption = unwrapResult(bugOptionResult);
      const featureOption = unwrapResult(featureOptionResult);

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
      expect(tableResult.isOk()).toBe(true);
      const table = unwrapResult(tableResult);

      const resolveResult = resolveFormulaFields(table);
      expect(resolveResult.isOk()).toBe(true);
      unwrapResult(resolveResult);

      const dbTableName = joinDbTableName(
        testSchemaName,
        convertNameToValidCharacter(table.name().toString(), 40)
      );
      const dbTableNameResult = DbTableName.rehydrate(dbTableName);
      expect(dbTableNameResult.isOk()).toBe(true);
      const dbTableNameValue = unwrapResult(dbTableNameResult);
      const setTableDbNameResult = table.setDbTableName(dbTableNameValue);
      expect(setTableDbNameResult.isOk()).toBe(true);
      unwrapResult(setTableDbNameResult);
      tableForCleanup = table;

      const reservedNames = new Set(baseRecordColumnNames);
      for (const field of table.fields()) {
        const baseName = convertNameToValidCharacter(field.name().toString(), 40);
        const dbFieldName = ensureUniqueDbFieldName(baseName, reservedNames);
        reservedNames.add(dbFieldName);
        const dbFieldNameResult = DbFieldName.rehydrate(dbFieldName);
        expect(dbFieldNameResult.isOk()).toBe(true);
        const dbFieldNameValue = unwrapResult(dbFieldNameResult);
        const setFieldDbNameResult = field.setDbFieldName(dbFieldNameValue);
        expect(setFieldDbNameResult.isOk()).toBe(true);
        unwrapResult(setFieldDbNameResult);
      }

      const actorIdResult = ActorId.create('system');
      expect(actorIdResult.isOk()).toBe(true);
      const context: IExecutionContext = { actorId: unwrapResult(actorIdResult) };
      contextForCleanup = context;

      const insertResult = await repo.insert(context, table);
      expect(insertResult.isOk()).toBe(true);
      unwrapResult(insertResult);

      const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
      expect(splitResult.isOk()).toBe(true);
      const { schema, tableName: dbTableNameFromSplit } = unwrapResult(splitResult);
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

      for (const field of table.fields()) {
        const dbFieldNameResult = field.dbFieldName().andThen((name) => name.value());
        expect(dbFieldNameResult.isOk()).toBe(true);
        const valueTypeResult = field.accept(valueTypeVisitor);
        expect(valueTypeResult.isOk()).toBe(true);
        const dbFieldNameValue = unwrapResult(dbFieldNameResult);
        const valueType = unwrapResult(valueTypeResult);

        const expectedType = resolveExpectedUdtName(
          field.type().toString(),
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
    it('creates manyMany join table columns', async () => {
      const c = testContainer.container;

      const db = c.resolve<Kysely<unknown>>(v2PostgresDbTokens.db);
      const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

      try {
        const testSchemaName = createSchemaName();
        const baseIdResult = BaseId.generate();
        const tableNameResult = TableName.create('Link Host ManyMany');
        const primaryNameResult = FieldName.create('Title');
        const linkNameResult = FieldName.create('Related');
        const primaryFieldIdResult = FieldId.generate();
        const linkFieldIdResult = FieldId.generate();
        const foreignTableIdResult = TableId.generate();
        const lookupFieldIdResult = FieldId.generate();
        const linkMetaResult = LinkFieldMeta.create({ hasOrderColumn: true });
        expect(
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
          ].every((r) => r.isOk())
        ).toBe(true);
        const baseId = unwrapResult(baseIdResult);
        const tableName = unwrapResult(tableNameResult);
        const primaryName = unwrapResult(primaryNameResult);
        const linkName = unwrapResult(linkNameResult);
        const primaryFieldId = unwrapResult(primaryFieldIdResult);
        const linkFieldId = unwrapResult(linkFieldIdResult);
        const foreignTableId = unwrapResult(foreignTableIdResult);
        const lookupFieldId = unwrapResult(lookupFieldIdResult);
        const linkMeta = unwrapResult(linkMetaResult);

        const linkConfigResult = LinkFieldConfig.create({
          relationship: 'manyMany',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupFieldId.toString(),
          fkHostTableName: 'link_relations_mm',
          selfKeyName: '__self_id',
          foreignKeyName: '__foreign_id',
        });
        expect(linkConfigResult.isOk()).toBe(true);
        const linkConfig = unwrapResult(linkConfigResult);

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
        expect(baseTableResult.isOk()).toBe(true);
        const baseTable = unwrapResult(baseTableResult);

        const linkFieldResult = createNewLinkField({
          id: linkFieldId,
          name: linkName,
          config: linkConfig,
          meta: linkMeta,
          baseId,
          hostTableId: baseTable.id(),
        });
        expect(linkFieldResult.isOk()).toBe(true);
        const linkFieldValue = unwrapResult(linkFieldResult);

        const tableResult = baseTable.addField(linkFieldValue);
        expect(tableResult.isOk()).toBe(true);
        const table = unwrapResult(tableResult);

        const dbTableNameResult = DbTableName.rehydrate(`${testSchemaName}.tbl_link_mm`);
        expect(dbTableNameResult.isOk()).toBe(true);
        const dbTableNameValue = unwrapResult(dbTableNameResult);
        const setTableDbNameResult = table.setDbTableName(dbTableNameValue);
        expect(setTableDbNameResult.isOk()).toBe(true);
        unwrapResult(setTableDbNameResult);

        const primaryField = table.fields().find((field) => field.id().equals(primaryFieldId));
        const linkField = table.fields().find((field) => field.id().equals(linkFieldId));
        expect(primaryField).toBeDefined();
        expect(linkField).toBeDefined();
        if (!primaryField || !linkField) return;

        const primaryDbNameResult = DbFieldName.rehydrate('title');
        const linkDbNameResult = DbFieldName.rehydrate('link_value_mm');
        expect([primaryDbNameResult, linkDbNameResult].every((r) => r.isOk())).toBe(true);
        const primaryDbName = unwrapResult(primaryDbNameResult);
        const linkDbName = unwrapResult(linkDbNameResult);
        expect(primaryField.setDbFieldName(primaryDbName).isOk()).toBe(true);
        expect(linkField.setDbFieldName(linkDbName).isOk()).toBe(true);

        const actorIdResult = ActorId.create('system');
        expect(actorIdResult.isOk()).toBe(true);
        const context: IExecutionContext = { actorId: unwrapResult(actorIdResult) };

        const insertResult = await repo.insert(context, table);
        expect(insertResult.isOk()).toBe(true);
        unwrapResult(insertResult);

        const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
        expect(splitResult.isOk()).toBe(true);
        const { schema, tableName: dbTableNameFromSplit } = unwrapResult(splitResult);
        const actualSchemaName = schema ?? 'public';
        const hostColumns = await fetchColumnTypes(db, dbTableNameFromSplit, actualSchemaName);
        expect(hostColumns.get('link_value_mm')).toBe('jsonb');
        expect(hostColumns.has('__self_id')).toBe(false);
        expect(hostColumns.has('__foreign_id')).toBe(false);

        const joinSplit = DbTableName.rehydrate(`${testSchemaName}.link_relations_mm`);
        expect(joinSplit.isOk()).toBe(true);
        const joinDbTableName = unwrapResult(joinSplit);
        const joinTable = joinDbTableName.split({ defaultSchema: 'public' });
        expect(joinTable.isOk()).toBe(true);
        const joinTableInfo = unwrapResult(joinTable);
        const joinSchema = joinTableInfo.schema ?? 'public';
        const joinColumns = await fetchColumnTypes(db, joinTableInfo.tableName, joinSchema);
        expect(joinColumns.get('__self_id')).toBe('text');
        expect(joinColumns.get('__foreign_id')).toBe('text');
        expect(joinColumns.get('__order')).toBe('float8');
      } finally {
        // no cleanup required
        void 0;
      }
    });

    it('creates oneMany foreign key columns on host table', async () => {
      const c = testContainer.container;

      const db = c.resolve<Kysely<unknown>>(v2PostgresDbTokens.db);
      const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

      try {
        const testSchemaName = createSchemaName();
        const baseIdResult = BaseId.generate();
        const tableNameResult = TableName.create('Link Host OneMany');
        const primaryNameResult = FieldName.create('Title');
        const linkNameResult = FieldName.create('Related');
        const primaryFieldIdResult = FieldId.generate();
        const linkFieldIdResult = FieldId.generate();
        const foreignTableIdResult = TableId.generate();
        const lookupFieldIdResult = FieldId.generate();
        const linkMetaResult = LinkFieldMeta.create({ hasOrderColumn: true });
        expect(
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
          ].every((r) => r.isOk())
        ).toBe(true);
        const baseId = unwrapResult(baseIdResult);
        const tableName = unwrapResult(tableNameResult);
        const primaryName = unwrapResult(primaryNameResult);
        const linkName = unwrapResult(linkNameResult);
        const primaryFieldId = unwrapResult(primaryFieldIdResult);
        const linkFieldId = unwrapResult(linkFieldIdResult);
        const foreignTableId = unwrapResult(foreignTableIdResult);
        const lookupFieldId = unwrapResult(lookupFieldIdResult);
        const linkMeta = unwrapResult(linkMetaResult);

        const linkConfigResult = LinkFieldConfig.create({
          relationship: 'oneMany',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupFieldId.toString(),
          fkHostTableName: 'tbl_link_om',
          selfKeyName: '__self_id',
          foreignKeyName: '__foreign_id',
        });
        expect(linkConfigResult.isOk()).toBe(true);
        const linkConfig = unwrapResult(linkConfigResult);

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
        expect(baseTableResult.isOk()).toBe(true);
        const baseTable = unwrapResult(baseTableResult);

        const linkFieldResult = createNewLinkField({
          id: linkFieldId,
          name: linkName,
          config: linkConfig,
          meta: linkMeta,
          baseId,
          hostTableId: baseTable.id(),
        });
        expect(linkFieldResult.isOk()).toBe(true);
        const linkFieldValue = unwrapResult(linkFieldResult);

        const tableResult = baseTable.addField(linkFieldValue);
        expect(tableResult.isOk()).toBe(true);
        const table = unwrapResult(tableResult);

        const dbTableNameResult = DbTableName.rehydrate(`${testSchemaName}.tbl_link_om`);
        expect(dbTableNameResult.isOk()).toBe(true);
        const dbTableNameValue = unwrapResult(dbTableNameResult);
        const setTableDbNameResult = table.setDbTableName(dbTableNameValue);
        expect(setTableDbNameResult.isOk()).toBe(true);
        unwrapResult(setTableDbNameResult);

        const primaryField = table.fields().find((field) => field.id().equals(primaryFieldId));
        const linkField = table.fields().find((field) => field.id().equals(linkFieldId));
        expect(primaryField).toBeDefined();
        expect(linkField).toBeDefined();
        if (!primaryField || !linkField) return;

        const primaryDbNameResult = DbFieldName.rehydrate('title');
        const linkDbNameResult = DbFieldName.rehydrate('link_value_om');
        expect([primaryDbNameResult, linkDbNameResult].every((r) => r.isOk())).toBe(true);
        const primaryDbName = unwrapResult(primaryDbNameResult);
        const linkDbName = unwrapResult(linkDbNameResult);
        expect(primaryField.setDbFieldName(primaryDbName).isOk()).toBe(true);
        expect(linkField.setDbFieldName(linkDbName).isOk()).toBe(true);

        const actorIdResult = ActorId.create('system');
        expect(actorIdResult.isOk()).toBe(true);
        const context: IExecutionContext = { actorId: unwrapResult(actorIdResult) };

        const insertResult = await repo.insert(context, table);
        expect(insertResult.isOk()).toBe(true);
        unwrapResult(insertResult);

        const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
        expect(splitResult.isOk()).toBe(true);
        const { schema, tableName: dbTableNameFromSplit } = unwrapResult(splitResult);
        const actualSchemaName = schema ?? 'public';
        const hostColumns = await fetchColumnTypes(db, dbTableNameFromSplit, actualSchemaName);
        expect(hostColumns.get('link_value_om')).toBe('jsonb');
        expect(hostColumns.get('__self_id')).toBe('text');
        expect(hostColumns.get('__self_id_order')).toBe('float8');
      } finally {
        // no cleanup required
        void 0;
      }
    });

    it('creates manyOne foreign key columns on host table', async () => {
      const c = testContainer.container;

      const db = c.resolve<Kysely<unknown>>(v2PostgresDbTokens.db);
      const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

      try {
        const testSchemaName = createSchemaName();
        const baseIdResult = BaseId.generate();
        const tableNameResult = TableName.create('Link Host ManyOne');
        const primaryNameResult = FieldName.create('Title');
        const linkNameResult = FieldName.create('Related');
        const primaryFieldIdResult = FieldId.generate();
        const linkFieldIdResult = FieldId.generate();
        const foreignTableIdResult = TableId.generate();
        const lookupFieldIdResult = FieldId.generate();
        expect(
          [
            baseIdResult,
            tableNameResult,
            primaryNameResult,
            linkNameResult,
            primaryFieldIdResult,
            linkFieldIdResult,
            foreignTableIdResult,
            lookupFieldIdResult,
          ].every((r) => r.isOk())
        ).toBe(true);
        const baseId = unwrapResult(baseIdResult);
        const tableName = unwrapResult(tableNameResult);
        const primaryName = unwrapResult(primaryNameResult);
        const linkName = unwrapResult(linkNameResult);
        const primaryFieldId = unwrapResult(primaryFieldIdResult);
        const linkFieldId = unwrapResult(linkFieldIdResult);
        const foreignTableId = unwrapResult(foreignTableIdResult);
        const lookupFieldId = unwrapResult(lookupFieldIdResult);

        const linkConfigResult = LinkFieldConfig.create({
          relationship: 'manyOne',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupFieldId.toString(),
          fkHostTableName: 'tbl_link_mo',
          selfKeyName: '__self_id',
          foreignKeyName: '__foreign_id',
        });
        expect(linkConfigResult.isOk()).toBe(true);
        const linkConfig = unwrapResult(linkConfigResult);

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
        expect(baseTableResult.isOk()).toBe(true);
        const baseTable = unwrapResult(baseTableResult);

        const linkFieldResult = createNewLinkField({
          id: linkFieldId,
          name: linkName,
          config: linkConfig,
          baseId,
          hostTableId: baseTable.id(),
        });
        expect(linkFieldResult.isOk()).toBe(true);
        const linkFieldValue = unwrapResult(linkFieldResult);

        const tableResult = baseTable.addField(linkFieldValue);
        expect(tableResult.isOk()).toBe(true);
        const table = unwrapResult(tableResult);

        const dbTableNameResult = DbTableName.rehydrate(`${testSchemaName}.tbl_link_mo`);
        expect(dbTableNameResult.isOk()).toBe(true);
        const dbTableNameValue = unwrapResult(dbTableNameResult);
        const setTableDbNameResult = table.setDbTableName(dbTableNameValue);
        expect(setTableDbNameResult.isOk()).toBe(true);
        unwrapResult(setTableDbNameResult);

        const primaryField = table.fields().find((field) => field.id().equals(primaryFieldId));
        const linkField = table.fields().find((field) => field.id().equals(linkFieldId));
        expect(primaryField).toBeDefined();
        expect(linkField).toBeDefined();
        if (!primaryField || !linkField) return;

        const primaryDbNameResult = DbFieldName.rehydrate('title');
        const linkDbNameResult = DbFieldName.rehydrate('link_value_mo');
        expect([primaryDbNameResult, linkDbNameResult].every((r) => r.isOk())).toBe(true);
        const primaryDbName = unwrapResult(primaryDbNameResult);
        const linkDbName = unwrapResult(linkDbNameResult);
        expect(primaryField.setDbFieldName(primaryDbName).isOk()).toBe(true);
        expect(linkField.setDbFieldName(linkDbName).isOk()).toBe(true);

        const actorIdResult = ActorId.create('system');
        expect(actorIdResult.isOk()).toBe(true);
        const context: IExecutionContext = { actorId: unwrapResult(actorIdResult) };

        const insertResult = await repo.insert(context, table);
        expect(insertResult.isOk()).toBe(true);
        unwrapResult(insertResult);

        const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
        expect(splitResult.isOk()).toBe(true);
        const { schema, tableName: dbTableNameFromSplit } = unwrapResult(splitResult);
        const actualSchemaName = schema ?? 'public';
        const hostColumns = await fetchColumnTypes(db, dbTableNameFromSplit, actualSchemaName);
        expect(hostColumns.get('link_value_mo')).toBe('jsonb');
        expect(hostColumns.get('__foreign_id')).toBe('text');
      } finally {
        // no cleanup required
        void 0;
      }
    });

    it('creates oneOne foreign key columns on host table', async () => {
      const c = testContainer.container;

      const db = c.resolve<Kysely<unknown>>(v2PostgresDbTokens.db);
      const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

      try {
        const testSchemaName = createSchemaName();
        const baseIdResult = BaseId.generate();
        const tableNameResult = TableName.create('Link Host OneOne');
        const primaryNameResult = FieldName.create('Title');
        const linkNameResult = FieldName.create('Related');
        const primaryFieldIdResult = FieldId.generate();
        const linkFieldIdResult = FieldId.generate();
        const foreignTableIdResult = TableId.generate();
        const lookupFieldIdResult = FieldId.generate();
        expect(
          [
            baseIdResult,
            tableNameResult,
            primaryNameResult,
            linkNameResult,
            primaryFieldIdResult,
            linkFieldIdResult,
            foreignTableIdResult,
            lookupFieldIdResult,
          ].every((r) => r.isOk())
        ).toBe(true);
        const baseId = unwrapResult(baseIdResult);
        const tableName = unwrapResult(tableNameResult);
        const primaryName = unwrapResult(primaryNameResult);
        const linkName = unwrapResult(linkNameResult);
        const primaryFieldId = unwrapResult(primaryFieldIdResult);
        const linkFieldId = unwrapResult(linkFieldIdResult);
        const foreignTableId = unwrapResult(foreignTableIdResult);
        const lookupFieldId = unwrapResult(lookupFieldIdResult);

        const linkConfigResult = LinkFieldConfig.create({
          relationship: 'oneOne',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupFieldId.toString(),
          fkHostTableName: 'tbl_link_oo',
          selfKeyName: '__self_id',
          foreignKeyName: '__foreign_id',
        });
        expect(linkConfigResult.isOk()).toBe(true);
        const linkConfig = unwrapResult(linkConfigResult);

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
        expect(baseTableResult.isOk()).toBe(true);
        const baseTable = unwrapResult(baseTableResult);

        const linkFieldResult = createNewLinkField({
          id: linkFieldId,
          name: linkName,
          config: linkConfig,
          baseId,
          hostTableId: baseTable.id(),
        });
        expect(linkFieldResult.isOk()).toBe(true);
        const linkFieldValue = unwrapResult(linkFieldResult);

        const tableResult = baseTable.addField(linkFieldValue);
        expect(tableResult.isOk()).toBe(true);
        const table = unwrapResult(tableResult);

        const dbTableNameResult = DbTableName.rehydrate(`${testSchemaName}.tbl_link_oo`);
        expect(dbTableNameResult.isOk()).toBe(true);
        const dbTableNameValue = unwrapResult(dbTableNameResult);
        const setTableDbNameResult = table.setDbTableName(dbTableNameValue);
        expect(setTableDbNameResult.isOk()).toBe(true);
        unwrapResult(setTableDbNameResult);

        const primaryField = table.fields().find((field) => field.id().equals(primaryFieldId));
        const linkField = table.fields().find((field) => field.id().equals(linkFieldId));
        expect(primaryField).toBeDefined();
        expect(linkField).toBeDefined();
        if (!primaryField || !linkField) return;

        const primaryDbNameResult = DbFieldName.rehydrate('title');
        const linkDbNameResult = DbFieldName.rehydrate('link_value_oo');
        expect([primaryDbNameResult, linkDbNameResult].every((r) => r.isOk())).toBe(true);
        const primaryDbName = unwrapResult(primaryDbNameResult);
        const linkDbName = unwrapResult(linkDbNameResult);
        expect(primaryField.setDbFieldName(primaryDbName).isOk()).toBe(true);
        expect(linkField.setDbFieldName(linkDbName).isOk()).toBe(true);

        const actorIdResult = ActorId.create('system');
        expect(actorIdResult.isOk()).toBe(true);
        const context: IExecutionContext = { actorId: unwrapResult(actorIdResult) };

        const insertResult = await repo.insert(context, table);
        expect(insertResult.isOk()).toBe(true);
        unwrapResult(insertResult);

        const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
        expect(splitResult.isOk()).toBe(true);
        const { schema, tableName: dbTableNameFromSplit } = unwrapResult(splitResult);
        const actualSchemaName = schema ?? 'public';
        const hostColumns = await fetchColumnTypes(db, dbTableNameFromSplit, actualSchemaName);
        expect(hostColumns.get('link_value_oo')).toBe('jsonb');
        expect(hostColumns.get('__foreign_id')).toBe('text');
      } finally {
        // shared container disposed in afterAll
      }
    });

    it('creates self-referencing link fields for all relationships', async () => {
      const c = testContainer.container;

      const db = c.resolve<Kysely<unknown>>(v2PostgresDbTokens.db);
      const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

      const cases = [
        {
          relationship: 'manyMany',
          tableLabel: 'Link Self ManyMany',
          hostTableName: 'tbl_link_mm_self',
          fkHostTableName: 'link_relations_mm_self',
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
          hostTableName: 'tbl_link_om_self',
          fkHostTableName: 'tbl_link_om_self',
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
          hostTableName: 'tbl_link_mo_self',
          fkHostTableName: 'tbl_link_mo_self',
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
          hostTableName: 'tbl_link_oo_self',
          fkHostTableName: 'tbl_link_oo_self',
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
        const testSchemaName = createSchemaName();
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

        expect(
          [
            baseIdResult,
            tableNameResult,
            primaryNameResult,
            linkNameResult,
            primaryFieldIdResult,
            linkFieldIdResult,
            lookupFieldIdResult,
            linkMetaResult,
          ].every((r) => r.isOk())
        ).toBe(true);
        if (
          baseIdResult.isErr() ||
          tableNameResult.isErr() ||
          primaryNameResult.isErr() ||
          linkNameResult.isErr() ||
          primaryFieldIdResult.isErr() ||
          linkFieldIdResult.isErr() ||
          lookupFieldIdResult.isErr() ||
          linkMetaResult.isErr()
        )
          continue;

        const baseId = unwrapResult(baseIdResult);
        const tableName = unwrapResult(tableNameResult);
        const primaryName = unwrapResult(primaryNameResult);
        const linkName = unwrapResult(linkNameResult);
        const primaryFieldId = unwrapResult(primaryFieldIdResult);
        const linkFieldId = unwrapResult(linkFieldIdResult);
        const lookupFieldId = unwrapResult(lookupFieldIdResult);
        const linkMeta = unwrapResult(linkMetaResult);

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
        expect(baseTableResult.isOk()).toBe(true);
        if (baseTableResult.isErr()) continue;
        const baseTable = unwrapResult(baseTableResult);

        const linkConfigResult = LinkFieldConfig.create({
          relationship: entry.relationship,
          foreignTableId: baseTable.id().toString(),
          lookupFieldId: lookupFieldId.toString(),
          fkHostTableName: entry.fkHostTableName,
          selfKeyName: '__self_id',
          foreignKeyName: '__foreign_id',
        });
        expect(linkConfigResult.isOk()).toBe(true);
        if (linkConfigResult.isErr()) continue;
        const linkConfig = unwrapResult(linkConfigResult);

        const linkFieldResult = createNewLinkField({
          id: linkFieldId,
          name: linkName,
          config: linkConfig,
          meta: linkMeta,
          baseId,
          hostTableId: baseTable.id(),
        });
        expect(linkFieldResult.isOk()).toBe(true);
        if (linkFieldResult.isErr()) continue;
        const linkFieldValue = unwrapResult(linkFieldResult);

        const tableResult = baseTable.addField(linkFieldValue);
        expect(tableResult.isOk()).toBe(true);
        if (tableResult.isErr()) continue;
        const table = unwrapResult(tableResult);

        const dbTableNameResult = DbTableName.rehydrate(`${testSchemaName}.${entry.hostTableName}`);
        expect(dbTableNameResult.isOk()).toBe(true);
        if (dbTableNameResult.isErr()) continue;
        const dbTableNameValue = unwrapResult(dbTableNameResult);
        const setTableDbNameResult = table.setDbTableName(dbTableNameValue);
        expect(setTableDbNameResult.isOk()).toBe(true);
        unwrapResult(setTableDbNameResult);

        const primaryField = table.fields().find((field) => field.id().equals(primaryFieldId));
        const linkField = table.fields().find((field) => field.id().equals(linkFieldId));
        expect(primaryField).toBeDefined();
        expect(linkField).toBeDefined();
        if (!primaryField || !linkField) continue;

        const primaryDbNameResult = DbFieldName.rehydrate('title');
        const linkDbNameResult = DbFieldName.rehydrate(entry.linkColumn);
        expect([primaryDbNameResult, linkDbNameResult].every((r) => r.isOk())).toBe(true);
        if (primaryDbNameResult.isErr() || linkDbNameResult.isErr()) continue;
        const primaryDbName = unwrapResult(primaryDbNameResult);
        const linkDbName = unwrapResult(linkDbNameResult);
        expect(primaryField.setDbFieldName(primaryDbName).isOk()).toBe(true);
        expect(linkField.setDbFieldName(linkDbName).isOk()).toBe(true);

        const actorIdResult = ActorId.create('system');
        expect(actorIdResult.isOk()).toBe(true);
        if (actorIdResult.isErr()) continue;
        const context: IExecutionContext = { actorId: unwrapResult(actorIdResult) };

        const insertResult = await repo.insert(context, table);
        expect(insertResult.isOk()).toBe(true);
        unwrapResult(insertResult);

        const splitResult = dbTableNameValue.split({ defaultSchema: 'public' });
        expect(splitResult.isOk()).toBe(true);
        if (splitResult.isErr()) continue;
        const { schema, tableName: dbTableNameFromSplit } = unwrapResult(splitResult);
        const actualSchemaName = schema ?? 'public';
        const hostColumns = await fetchColumnTypes(db, dbTableNameFromSplit, actualSchemaName);
        for (const [column, expectedType] of Object.entries(entry.expectHostTypes)) {
          const actualType = hostColumns.get(column);
          expect(actualType).toBe(expectedType);
        }

        if (entry.expectJoin) {
          const joinSplit = DbTableName.rehydrate(`${testSchemaName}.${entry.fkHostTableName}`);
          expect(joinSplit.isOk()).toBe(true);
          if (joinSplit.isErr()) continue;
          const joinDbTableName = unwrapResult(joinSplit);
          const joinTable = joinDbTableName.split({ defaultSchema: 'public' });
          expect(joinTable.isOk()).toBe(true);
          if (joinTable.isErr()) continue;
          const joinInfo = unwrapResult(joinTable);
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
