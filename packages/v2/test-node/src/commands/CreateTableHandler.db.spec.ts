/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateTableCommand,
  type CreateTableResult,
  type ICommandBus,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { createAllFieldTypesFields } from '@teable/v2-table-templates';
import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

type InfoSchemaColumnRow = {
  column_name: string;
  table_schema: string;
  table_name: string;
};

type V1Db = V1TeableDatabase & { columns: InfoSchemaColumnRow };

describe('CreateTableHandler (db)', () => {
  beforeEach(async () => {
    await getV2NodeTestContainer().dispose();
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  it('persists table meta, fields, views, and record table columns', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1Db>>(v2PostgresDbTokens.db);

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };

    const createTableResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'DB Table',
      fields: createAllFieldTypesFields(),
    });
    createTableResult._unsafeUnwrap();

    const execResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createTableResult._unsafeUnwrap()
    );
    execResult._unsafeUnwrap();

    const table = execResult._unsafeUnwrap().table;
    const tableId = table.id().toString();
    const fieldIds = table.getFields().map((field) => field.id().toString());

    const tableMetaRow = await db
      .selectFrom('table_meta')
      .select(['id', 'base_id', 'name', 'db_table_name'])
      .where('id', '=', tableId)
      .executeTakeFirst();
    expect(tableMetaRow).toBeTruthy();
    if (!tableMetaRow) return;
    expect(tableMetaRow.base_id).toBe(baseId.toString());
    expect(tableMetaRow.name).toBe('DB Table');
    expect(tableMetaRow.db_table_name).toBeTruthy();

    const fieldRows = await db
      .selectFrom('field')
      .select(['id', 'db_field_name', 'is_primary', 'table_id'])
      .where('table_id', '=', tableId)
      .execute();
    expect(fieldRows).toHaveLength(fieldIds.length);
    expect(new Set(fieldRows.map((row) => row.id))).toEqual(new Set(fieldIds));
    expect(fieldRows.every((row) => row.db_field_name)).toBe(true);
    const primaryFieldId = table.primaryFieldId().toString();
    const primaryRow = fieldRows.find((row) => row.id === primaryFieldId);
    expect(primaryRow?.is_primary).toBe(true);

    const viewRows = await db
      .selectFrom('view')
      .select(['id', 'type', 'column_meta'])
      .where('table_id', '=', tableId)
      .execute();
    expect(viewRows).toHaveLength(table.views().length);

    const viewById = new Map(viewRows.map((row) => [row.id, row] as const));
    for (const view of table.views()) {
      const row = viewById.get(view.id().toString());
      expect(row).toBeTruthy();
      if (!row) return;
      expect(row.type).toBe(view.type().toString());
      const metaResult = view.columnMeta();
      metaResult._unsafeUnwrap();

      const dbMeta = JSON.parse(row.column_meta ?? '{}') as Record<string, { order: number }>;
      expect(dbMeta).toEqual(metaResult._unsafeUnwrap().toDto());
    }

    const parts = String(tableMetaRow.db_table_name).split('.');
    const schemaName = parts.length > 1 ? parts[0] : 'public';
    const tableName = parts.length > 1 ? parts[1] : parts[0];
    const columnRows = await db
      .withSchema('information_schema')
      .selectFrom('columns')
      .select(['column_name'])
      .where('table_schema', '=', schemaName)
      .where('table_name', '=', tableName)
      .execute();
    const columnNames = new Set(columnRows.map((row) => row.column_name));

    const baseRecordColumns = [
      '__id',
      '__auto_number',
      '__created_time',
      '__last_modified_time',
      '__created_by',
      '__last_modified_by',
      '__version',
    ];
    for (const columnName of baseRecordColumns) {
      expect(columnNames.has(columnName)).toBe(true);
    }
    for (const row of fieldRows) {
      expect(columnNames.has(row.db_field_name)).toBe(true);
    }
  });
});
