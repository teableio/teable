/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
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
  RatingMax,
  SelectOption,
  Table,
  TableName,
  UserMultiplicity,
  v2CoreTokens,
  resolveFormulaFields,
} from '@teable/v2-core';
import { container } from '@teable/v2-di';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type StartedPostgreSqlContainer = Awaited<ReturnType<PostgreSqlContainer['start']>>;

import { registerV2PostgresDdlAdapter } from '../di/register';
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

describe('PostgresTableSchemaRepository (pg)', () => {
  let pgContainer: StartedPostgreSqlContainer;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('teable_v2_test')
      .withUsername('teable')
      .withPassword('teable')
      .start();
  });

  afterAll(async () => {
    await pgContainer.stop();
  });

  it('creates record table and field columns', async () => {
    const c = container.createChildContainer();
    await registerV2PostgresDdlAdapter(c, {
      pg: { connectionString: pgContainer.getConnectionUri() },
    });

    const db = c.resolve<Kysely<unknown>>(v2PostgresDbTokens.db);
    const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);

    try {
      const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
      expect(baseIdResult.isOk()).toBe(true);
      if (baseIdResult.isErr()) return;
      const baseId = baseIdResult.value;

      const tableNameResult = TableName.create('Project Items');
      const titleNameResult = FieldName.create('Task Name');
      const ratingNameResult = FieldName.create('Priority Level');
      const statusNameResult = FieldName.create('Status');
      expect(
        [tableNameResult, titleNameResult, ratingNameResult, statusNameResult].every((r) =>
          r.isOk()
        )
      ).toBe(true);
      if (
        tableNameResult.isErr() ||
        titleNameResult.isErr() ||
        ratingNameResult.isErr() ||
        statusNameResult.isErr()
      )
        return;

      const todoOptionResult = SelectOption.create({ name: 'Todo', color: 'blue' });
      const doneOptionResult = SelectOption.create({ name: 'Done', color: 'red' });
      expect([todoOptionResult, doneOptionResult].every((r) => r.isOk())).toBe(true);
      if (todoOptionResult.isErr() || doneOptionResult.isErr()) return;

      const builder = Table.builder().withBaseId(baseId).withName(tableNameResult.value);
      builder.field().singleLineText().withName(titleNameResult.value).done();
      builder.field().rating().withName(ratingNameResult.value).withMax(RatingMax.five()).done();
      builder
        .field()
        .singleSelect()
        .withName(statusNameResult.value)
        .withOptions([todoOptionResult.value, doneOptionResult.value])
        .done();
      builder.view().defaultGrid().done();

      const tableResult = builder.build();
      expect(tableResult.isOk()).toBe(true);
      if (tableResult.isErr()) return;
      const table = tableResult.value;

      const dbTableName = joinDbTableName(
        baseId.toString(),
        convertNameToValidCharacter(table.name().toString(), 40)
      );
      const reservedNames = new Set(baseRecordColumnNames);
      const fieldDbNames: string[] = [];

      const dbTableNameResult = DbTableName.rehydrate(dbTableName);
      expect(dbTableNameResult.isOk()).toBe(true);
      if (dbTableNameResult.isErr()) return;
      const setTableDbNameResult = table.setDbTableName(dbTableNameResult.value);
      expect(setTableDbNameResult.isOk()).toBe(true);
      if (setTableDbNameResult.isErr()) return;

      for (const field of table.fields()) {
        const baseName = convertNameToValidCharacter(field.name().toString(), 40);
        const dbFieldName = ensureUniqueDbFieldName(baseName, reservedNames);
        reservedNames.add(dbFieldName);
        fieldDbNames.push(dbFieldName);
        const dbFieldNameResult = DbFieldName.rehydrate(dbFieldName);
        expect(dbFieldNameResult.isOk()).toBe(true);
        if (dbFieldNameResult.isErr()) return;
        const setFieldDbNameResult = field.setDbFieldName(dbFieldNameResult.value);
        expect(setFieldDbNameResult.isOk()).toBe(true);
        if (setFieldDbNameResult.isErr()) return;
      }

      const actorIdResult = ActorId.create('system');
      expect(actorIdResult.isOk()).toBe(true);
      if (actorIdResult.isErr()) return;
      const context: IExecutionContext = { actorId: actorIdResult.value };

      const insertResult = await repo.insert(context, table);
      expect(insertResult.isOk()).toBe(true);
      if (insertResult.isErr()) return;

      const expectedBaseColumns = baseRecordColumnNames;
      const expectedFieldColumns = fieldDbNames;

      const splitResult = dbTableNameResult.value.split({ defaultSchema: 'public' });
      expect(splitResult.isOk()).toBe(true);
      if (splitResult.isErr()) return;
      const { schema, tableName } = splitResult.value;
      const schemaName = schema ?? 'public';
      const columnsResult = await sql<{ columnName: string }>`
        select column_name as "columnName"
        from information_schema.columns
        where table_schema = ${schemaName}
          and table_name = ${tableName}
      `.execute(db);

      const actualColumns = columnsResult.rows.map((r) => r.columnName);
      for (const columnName of [...expectedBaseColumns, ...expectedFieldColumns]) {
        expect(actualColumns).toContain(columnName);
      }
    } finally {
      await db.destroy();
    }
  });

  it('uses v1-compatible column types for fields', async () => {
    const c = container.createChildContainer();
    await registerV2PostgresDdlAdapter(c, {
      pg: { connectionString: pgContainer.getConnectionUri() },
    });

    const db = c.resolve<Kysely<unknown>>(v2PostgresDbTokens.db);
    const repo = c.resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository);
    let tableForCleanup: Table | undefined;
    let contextForCleanup: IExecutionContext | undefined;

    try {
      const baseIdResult = BaseId.create(`bse${'b'.repeat(16)}`);
      expect(baseIdResult.isOk()).toBe(true);
      if (baseIdResult.isErr()) return;
      const baseId = baseIdResult.value;

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
      if (
        tableNameResult.isErr() ||
        titleNameResult.isErr() ||
        descriptionNameResult.isErr() ||
        amountNameResult.isErr() ||
        ratingNameResult.isErr() ||
        scoreNameResult.isErr() ||
        scoreLabelNameResult.isErr() ||
        statusNameResult.isErr() ||
        tagsNameResult.isErr() ||
        doneNameResult.isErr() ||
        filesNameResult.isErr() ||
        dueNameResult.isErr() ||
        ownerNameResult.isErr() ||
        actionNameResult.isErr() ||
        titleFieldIdResult.isErr() ||
        amountFieldIdResult.isErr() ||
        scoreExpressionResult.isErr() ||
        scoreLabelExpressionResult.isErr() ||
        todoOptionResult.isErr() ||
        doneOptionResult.isErr() ||
        bugOptionResult.isErr() ||
        featureOptionResult.isErr()
      )
        return;

      const builder = Table.builder().withBaseId(baseId).withName(tableNameResult.value);
      builder
        .field()
        .singleLineText()
        .withName(titleNameResult.value)
        .withId(titleFieldIdResult.value)
        .primary()
        .done();
      builder.field().longText().withName(descriptionNameResult.value).done();
      builder
        .field()
        .number()
        .withName(amountNameResult.value)
        .withId(amountFieldIdResult.value)
        .done();
      builder.field().rating().withName(ratingNameResult.value).withMax(RatingMax.five()).done();
      builder
        .field()
        .formula()
        .withName(scoreNameResult.value)
        .withExpression(scoreExpressionResult.value)
        .done();
      builder
        .field()
        .formula()
        .withName(scoreLabelNameResult.value)
        .withExpression(scoreLabelExpressionResult.value)
        .done();
      builder
        .field()
        .singleSelect()
        .withName(statusNameResult.value)
        .withOptions([todoOptionResult.value, doneOptionResult.value])
        .done();
      builder
        .field()
        .multipleSelect()
        .withName(tagsNameResult.value)
        .withOptions([bugOptionResult.value, featureOptionResult.value])
        .done();
      builder.field().checkbox().withName(doneNameResult.value).done();
      builder.field().attachment().withName(filesNameResult.value).done();
      builder.field().date().withName(dueNameResult.value).done();
      builder
        .field()
        .user()
        .withName(ownerNameResult.value)
        .withMultiplicity(UserMultiplicity.multiple())
        .done();
      builder.field().button().withName(actionNameResult.value).done();
      builder.view().defaultGrid().done();

      const tableResult = builder.build();
      expect(tableResult.isOk()).toBe(true);
      if (tableResult.isErr()) return;
      const table = tableResult.value;

      const resolveResult = resolveFormulaFields(table);
      expect(resolveResult.isOk()).toBe(true);
      if (resolveResult.isErr()) return;

      const dbTableName = joinDbTableName(
        baseId.toString(),
        convertNameToValidCharacter(table.name().toString(), 40)
      );
      const dbTableNameResult = DbTableName.rehydrate(dbTableName);
      expect(dbTableNameResult.isOk()).toBe(true);
      if (dbTableNameResult.isErr()) return;
      const setTableDbNameResult = table.setDbTableName(dbTableNameResult.value);
      expect(setTableDbNameResult.isOk()).toBe(true);
      if (setTableDbNameResult.isErr()) return;
      tableForCleanup = table;

      const reservedNames = new Set(baseRecordColumnNames);
      for (const field of table.fields()) {
        const baseName = convertNameToValidCharacter(field.name().toString(), 40);
        const dbFieldName = ensureUniqueDbFieldName(baseName, reservedNames);
        reservedNames.add(dbFieldName);
        const dbFieldNameResult = DbFieldName.rehydrate(dbFieldName);
        expect(dbFieldNameResult.isOk()).toBe(true);
        if (dbFieldNameResult.isErr()) return;
        const setFieldDbNameResult = field.setDbFieldName(dbFieldNameResult.value);
        expect(setFieldDbNameResult.isOk()).toBe(true);
        if (setFieldDbNameResult.isErr()) return;
      }

      const actorIdResult = ActorId.create('system');
      expect(actorIdResult.isOk()).toBe(true);
      if (actorIdResult.isErr()) return;
      const context: IExecutionContext = { actorId: actorIdResult.value };
      contextForCleanup = context;

      const insertResult = await repo.insert(context, table);
      expect(insertResult.isOk()).toBe(true);
      if (insertResult.isErr()) return;

      const splitResult = dbTableNameResult.value.split({ defaultSchema: 'public' });
      expect(splitResult.isOk()).toBe(true);
      if (splitResult.isErr()) return;
      const { schema, tableName } = splitResult.value;
      const schemaName = schema ?? 'public';
      const columnsResult = await sql<{ columnName: string; udtName: string }>`
        select column_name as "columnName", udt_name as "udtName"
        from information_schema.columns
        where table_schema = ${schemaName}
          and table_name = ${tableName}
      `.execute(db);

      const actualTypes = new Map(columnsResult.rows.map((row) => [row.columnName, row.udtName]));
      const expectedTypes = new Map<string, string>(Object.entries(baseRecordColumnTypes));
      const valueTypeVisitor = new FieldValueTypeVisitor();

      for (const field of table.fields()) {
        const dbFieldNameResult = field.dbFieldName().andThen((name) => name.value());
        expect(dbFieldNameResult.isOk()).toBe(true);
        if (dbFieldNameResult.isErr()) return;
        const valueTypeResult = field.accept(valueTypeVisitor);
        expect(valueTypeResult.isOk()).toBe(true);
        if (valueTypeResult.isErr()) return;

        const expectedType = resolveExpectedUdtName(
          field.type().toString(),
          valueTypeResult.value.cellValueType.toString(),
          valueTypeResult.value.isMultipleCellValue.toBoolean()
        );
        expectedTypes.set(dbFieldNameResult.value, expectedType);
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
      await db.destroy();
    }
  });
});
