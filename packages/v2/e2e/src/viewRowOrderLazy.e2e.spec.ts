/* eslint-disable @typescript-eslint/naming-convention */
import { rowOrderIndexName } from '@teable/v2-adapter-table-repository-postgres';
import { listTableRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { createV2HttpClient, type V2HttpClient } from '@teable/v2-contract-http-client';
import { FieldKeyType } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * T7569: adding or duplicating a grid view must not create `__row_<viewId>`.
 *
 * The column would only be backfilled with `__auto_number`, which is already
 * the read fallback when the column is missing. Creating it eagerly rewrote
 * every row of the table inside the request, and on wide tables with trigram
 * GIN indexes that took longer than the gateway timeout. The column is
 * created online by the first write that needs a manual row order.
 *
 * Postgres only: the online path uses CREATE INDEX CONCURRENTLY.
 */
describe('v2 view row-order column is created lazily (e2e, T7569)', () => {
  let ctx: SharedTestContext;
  let client: V2HttpClient;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
    client = createV2HttpClient({ baseUrl: ctx.baseUrl });
  }, 300000);

  const setupTable = async (name: string) => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name,
      fields: [{ name: 'Name', type: 'singleLineText', isPrimary: true }],
      views: [{ type: 'grid', name: 'Source' }],
    });
    const primaryFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    const records = await ctx.createRecords(
      table.id,
      Array.from({ length: 6 }, (_, index) => ({
        fields: { [primaryFieldId]: `Row ${index + 1}` },
      }))
    );

    const tableMeta = await ctx.testContainer.db
      .selectFrom('table_meta')
      .select('db_table_name')
      .where('id', '=', table.id)
      .executeTakeFirst();
    const dbTableName = tableMeta?.db_table_name ?? '';
    expect(dbTableName).not.toBe('');
    const dotIndex = dbTableName.indexOf('.');
    return {
      tableId: table.id,
      sourceViewId: table.views[0]!.id,
      primaryFieldId,
      recordIds: records.map((record) => record.id),
      dbTableName,
      schemaName: dotIndex === -1 ? 'public' : dbTableName.slice(0, dotIndex),
      plainTableName: dotIndex === -1 ? dbTableName : dbTableName.slice(dotIndex + 1),
    };
  };

  type TableSetup = Awaited<ReturnType<typeof setupTable>>;

  const rowOrderColumnExists = async (setup: TableSetup, viewId: string) => {
    const result = await sql<{ column_name: string }>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${setup.schemaName}
        AND table_name = ${setup.plainTableName}
        AND column_name = ${`__row_${viewId}`}
    `.execute(ctx.testContainer.db);
    return result.rows.length > 0;
  };

  const listNamesInView = async (setup: TableSetup, viewId: string) => {
    const params = new URLSearchParams({
      tableId: setup.tableId,
      viewId,
      fieldKeyType: FieldKeyType.Id,
    });
    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`);
    const rawBody = await response.json();
    expect(response.status).toBe(200);
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`ListRecords response invalid: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.records.map((record) => record.fields[setup.primaryFieldId]);
  };

  const insertionOrder = Array.from({ length: 6 }, (_, index) => `Row ${index + 1}`);

  it('duplicates a grid view without creating its row-order column', async () => {
    const setup = await setupTable('T7569 Duplicate View');

    const duplicated = await client.tables.duplicateView({
      tableId: setup.tableId,
      viewId: setup.sourceViewId,
    });
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    const duplicateViewId = duplicated.data.viewId;

    expect(await rowOrderColumnExists(setup, duplicateViewId)).toBe(false);
    expect(await listNamesInView(setup, duplicateViewId)).toEqual(insertionOrder);
  }, 120000);

  it('creates a grid view without creating its row-order column', async () => {
    const setup = await setupTable('T7569 Create View');

    const created = await client.tables.createView({
      tableId: setup.tableId,
      view: { type: 'grid', name: 'Added' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const viewId = created.data.viewId;

    expect(await rowOrderColumnExists(setup, viewId)).toBe(false);
    expect(await listNamesInView(setup, viewId)).toEqual(insertionOrder);
  }, 120000);

  it('creates the row-order column online on the first reorder in a duplicated view', async () => {
    const setup = await setupTable('T7569 Reorder Duplicated View');
    const duplicated = await client.tables.duplicateView({
      tableId: setup.tableId,
      viewId: setup.sourceViewId,
    });
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    const duplicateViewId = duplicated.data.viewId;
    expect(await rowOrderColumnExists(setup, duplicateViewId)).toBe(false);
    expect(await listNamesInView(setup, duplicateViewId)).toEqual(insertionOrder);

    const reordered = await client.tables.reorderRecords({
      tableId: setup.tableId,
      recordIds: [setup.recordIds[0]!],
      order: { viewId: duplicateViewId, anchorId: setup.recordIds[5]!, position: 'after' },
    });
    expect(reordered.ok).toBe(true);

    expect(await rowOrderColumnExists(setup, duplicateViewId)).toBe(true);
    expect(await listNamesInView(setup, duplicateViewId)).toEqual([
      'Row 2',
      'Row 3',
      'Row 4',
      'Row 5',
      'Row 6',
      'Row 1',
    ]);
    expect(await listNamesInView(setup, setup.sourceViewId)).toEqual(insertionOrder);

    const indexName = rowOrderIndexName(setup.dbTableName, duplicateViewId);
    const indexes = await sql<{ indisvalid: boolean }>`
      SELECT i.indisvalid
      FROM pg_class c
      JOIN pg_index i ON i.indexrelid = c.oid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${setup.schemaName}
        AND c.relname = ${indexName}
    `.execute(ctx.testContainer.db);
    expect(indexes.rows).toHaveLength(1);
    expect(indexes.rows[0]?.indisvalid).toBe(true);
  }, 120000);

  it('reorders correctly in a duplicated table whose source view had no row-order column', async () => {
    const setup = await setupTable('T7569 Duplicate Table Source');
    const duplicatedView = await client.tables.duplicateView({
      tableId: setup.tableId,
      viewId: setup.sourceViewId,
    });
    expect(duplicatedView.ok).toBe(true);
    if (!duplicatedView.ok) return;
    const sourceViewId = duplicatedView.data.viewId;
    expect(await rowOrderColumnExists(setup, sourceViewId)).toBe(false);

    const duplicatedTable = await ctx.duplicateTable({
      baseId: ctx.baseId,
      tableId: setup.tableId,
      name: 'T7569 Duplicate Table Copy',
      includeRecords: true,
    });
    const targetViewId = duplicatedTable.viewIdMap[sourceViewId]!;
    const targetPrimaryFieldId = duplicatedTable.fieldIdMap[setup.primaryFieldId]!;
    const targetRecords = await ctx.listRecords(duplicatedTable.table.id, { limit: 100 });
    const targetIdByName = new Map(
      targetRecords.map((record) => [record.fields[targetPrimaryFieldId] as string, record.id])
    );

    const reordered = await client.tables.reorderRecords({
      tableId: duplicatedTable.table.id,
      recordIds: [targetIdByName.get('Row 1')!],
      order: { viewId: targetViewId, anchorId: targetIdByName.get('Row 3')!, position: 'after' },
    });
    expect(reordered.ok).toBe(true);

    const targetMeta = await ctx.testContainer.db
      .selectFrom('table_meta')
      .select('db_table_name')
      .where('id', '=', duplicatedTable.table.id)
      .executeTakeFirstOrThrow();
    const targetDotIndex = targetMeta.db_table_name.indexOf('.');
    const target: TableSetup = {
      tableId: duplicatedTable.table.id,
      sourceViewId: targetViewId,
      primaryFieldId: targetPrimaryFieldId,
      recordIds: [],
      dbTableName: targetMeta.db_table_name,
      schemaName: targetMeta.db_table_name.slice(0, targetDotIndex),
      plainTableName: targetMeta.db_table_name.slice(targetDotIndex + 1),
    };
    expect(await listNamesInView(target, targetViewId)).toEqual([
      'Row 2',
      'Row 3',
      'Row 1',
      'Row 4',
      'Row 5',
      'Row 6',
    ]);
  }, 120000);
});
