/* eslint-disable @typescript-eslint/naming-convention */
import type { IExecutionContext, ITableSchemaRepository } from '@teable/v2-core';
import {
  ActorId,
  BaseId,
  FieldName,
  RatingMax,
  SelectOption,
  Table,
  TableName,
  v2CoreTokens,
} from '@teable/v2-core';
import { v2PostgresDbTokens } from '@teable/v2-db-postgres';
import { container } from '@teable/v2-di';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type StartedPostgreSqlContainer = Awaited<ReturnType<PostgreSqlContainer['start']>>;

import { registerV2PostgresDdlAdapter } from '../di/register';
import {
  baseRecordColumnNames,
  buildDbFieldNameMap,
  convertNameToValidCharacter,
  joinDbTableName,
  splitDbTableName,
} from '../naming';

interface ITestTableMetaTable {
  id: string;
  db_table_name: string;
}

interface ITestDatabase {
  table_meta: ITestTableMetaTable;
}

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

    const db = c.resolve<Kysely<ITestDatabase>>(v2PostgresDbTokens.db);
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
      const fieldDbNameById = buildDbFieldNameMap(
        table
          .fields()
          .map((field) => ({ id: field.id().toString(), name: field.name().toString() }))
      );

      await db.schema
        .createTable('table_meta')
        .ifNotExists()
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('db_table_name', 'text', (col) => col.notNull())
        .execute();

      await db
        .insertInto('table_meta')
        .values({ id: table.id().toString(), db_table_name: dbTableName })
        .execute();

      const actorIdResult = ActorId.create('system');
      expect(actorIdResult.isOk()).toBe(true);
      if (actorIdResult.isErr()) return;
      const context: IExecutionContext = { actorId: actorIdResult.value };

      const insertResult = await repo.insert(context, table);
      expect(insertResult.isOk()).toBe(true);
      if (insertResult.isErr()) return;

      const expectedBaseColumns = baseRecordColumnNames;
      const expectedFieldColumns = [...fieldDbNameById.values()];

      const { schema, tableName } = splitDbTableName(dbTableName);
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
});
