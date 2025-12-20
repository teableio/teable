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

interface ITestTableMetaTable {
  id: string;
  db_table_name: string;
}

interface ITestFieldTable {
  id: string;
  table_id: string;
  db_field_name: string;
  deleted_time: Date | null;
}

interface ITestDatabase {
  table_meta: ITestTableMetaTable;
  field: ITestFieldTable;
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

      await db.schema
        .createTable('table_meta')
        .ifNotExists()
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('db_table_name', 'text', (col) => col.notNull())
        .execute();

      await db.schema
        .createTable('field')
        .ifNotExists()
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('table_id', 'text', (col) => col.notNull())
        .addColumn('db_field_name', 'text', (col) => col.notNull())
        .addColumn('deleted_time', 'timestamptz')
        .execute();

      const dbTableName = `${baseId.toString()}.Project_Items`;
      const fieldDbNames = [
        { id: table.fields()[0].id().toString(), dbFieldName: 'Task_Name' },
        { id: table.fields()[1].id().toString(), dbFieldName: 'Priority_Level' },
        { id: table.fields()[2].id().toString(), dbFieldName: 'Status' },
      ];

      await db
        .insertInto('table_meta')
        .values({ id: table.id().toString(), db_table_name: dbTableName })
        .execute();

      await db
        .insertInto('field')
        .values(
          fieldDbNames.map((f) => ({
            id: f.id,
            table_id: table.id().toString(),
            db_field_name: f.dbFieldName,
            deleted_time: null,
          }))
        )
        .execute();

      const actorIdResult = ActorId.create('system');
      expect(actorIdResult.isOk()).toBe(true);
      if (actorIdResult.isErr()) return;
      const context: IExecutionContext = { actorId: actorIdResult.value };

      const saveResult = await repo.save(context, table);
      expect(saveResult.isOk()).toBe(true);
      if (saveResult.isErr()) return;

      const expectedBaseColumns = [
        '__id',
        '__auto_number',
        '__created_time',
        '__last_modified_time',
        '__created_by',
        '__last_modified_by',
        '__version',
      ];
      const expectedFieldColumns = fieldDbNames.map((f) => f.dbFieldName);

      const [schemaName, tableName] = dbTableName.split('.');
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
