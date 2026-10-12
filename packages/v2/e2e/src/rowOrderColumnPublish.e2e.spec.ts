/* eslint-disable @typescript-eslint/naming-convention */
import { rowOrderIndexName } from '@teable/v2-adapter-table-repository-postgres';
import {
  createRecordOkResponseSchema,
  listTableRecordsOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2HttpClient, type V2HttpClient } from '@teable/v2-contract-http-client';
import { DeleteRecordsCommand, FieldKeyType } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';
import {
  buildUndoRedoContext,
  executeUndo,
  getCommandBus,
} from './undo-redo/shared/undoRedoE2eTestKit';

/**
 * T7570: a lazily created `__row_<viewId>` column must not become visible
 * before every row has a value. Readers treat an existing column as fully
 * backfilled; pre-fix the column was committed first and backfilled after, so
 *  - an interrupted backfill left NULLs that were never resumed,
 *  - an append during the backfill took a partial `MAX(__row_x)`,
 *  - undoing a delete wrote NULL into columns created after the delete.
 *
 * Postgres only: the online path uses CREATE INDEX CONCURRENTLY.
 */
describe('v2 row-order column is published only when complete (e2e, T7570)', () => {
  let ctx: SharedTestContext;
  let client: V2HttpClient;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
    client = createV2HttpClient({ baseUrl: ctx.baseUrl });
  }, 300000);

  const rowCount = 8;
  const insertionOrder = Array.from({ length: rowCount }, (_, index) => `Row ${index + 1}`);

  const setupTable = async (name: string) => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name,
      fields: [{ name: 'Name', type: 'singleLineText', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const primaryFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    const records = await ctx.createRecords(
      table.id,
      insertionOrder.map((value) => ({ fields: { [primaryFieldId]: value } }))
    );
    const tableMeta = await ctx.testContainer.db
      .selectFrom('table_meta')
      .select('db_table_name')
      .where('id', '=', table.id)
      .executeTakeFirstOrThrow();
    const dbTableName = tableMeta.db_table_name;
    const dotIndex = dbTableName.indexOf('.');
    const viewId = table.views[0]!.id;
    const setup = {
      tableId: table.id,
      viewId,
      primaryFieldId,
      recordIdByName: new Map(
        records.map((record) => [record.fields[primaryFieldId] as string, record.id])
      ),
      dbTableName,
      schemaName: dotIndex === -1 ? 'public' : dbTableName.slice(0, dotIndex),
      plainTableName: dotIndex === -1 ? dbTableName : dbTableName.slice(dotIndex + 1),
    };
    await dropRowOrderStorage(setup, viewId);
    return setup;
  };

  type TableSetup = Awaited<ReturnType<typeof setupTable>>;

  const recordId = (setup: TableSetup, name: string) => {
    const id = setup.recordIdByName.get(name);
    if (!id) throw new Error(`Missing record ${name}`);
    return id;
  };

  const dropRowOrderStorage = async (
    setup: Pick<TableSetup, 'dbTableName' | 'schemaName'>,
    viewId: string
  ) => {
    await sql`
      DROP INDEX IF EXISTS ${sql.id(setup.schemaName, rowOrderIndexName(setup.dbTableName, viewId))}
    `.execute(ctx.testContainer.db);
    await sql`
      ALTER TABLE ${sql.table(setup.dbTableName)}
      DROP COLUMN IF EXISTS ${sql.id(`__row_${viewId}`)}
    `.execute(ctx.testContainer.db);
  };

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

  const countNullOrders = async (setup: TableSetup, viewId: string) => {
    const result = await sql<{ count: string | number }>`
      SELECT count(*) AS count
      FROM ${sql.table(setup.dbTableName)}
      WHERE ${sql.ref(`__row_${viewId}`)} IS NULL
    `.execute(ctx.testContainer.db);
    return Number(result.rows[0]?.count ?? 0);
  };

  const triggerFunctionName = (setup: TableSetup, suffix: string) =>
    `t7570_${suffix}_${setup.tableId.toLowerCase()}`;

  const installUpdateTrigger = async (setup: TableSetup, suffix: string, body: string) => {
    const functionName = triggerFunctionName(setup, suffix);
    await sql
      .raw(
        `CREATE OR REPLACE FUNCTION public.${functionName}() RETURNS trigger ` +
          `LANGUAGE plpgsql AS $$ BEGIN ${body} RETURN NEW; END $$`
      )
      .execute(ctx.testContainer.db);
    await sql`
      CREATE TRIGGER ${sql.id(functionName)}
      BEFORE UPDATE ON ${sql.table(setup.dbTableName)}
      FOR EACH ROW EXECUTE FUNCTION ${sql.id('public', functionName)}()
    `.execute(ctx.testContainer.db);
  };

  const dropUpdateTrigger = async (setup: TableSetup, suffix: string) => {
    const functionName = triggerFunctionName(setup, suffix);
    await sql`
      DROP TRIGGER IF EXISTS ${sql.id(functionName)} ON ${sql.table(setup.dbTableName)}
    `.execute(ctx.testContainer.db);
    await sql`DROP FUNCTION IF EXISTS ${sql.id('public', functionName)}()`.execute(
      ctx.testContainer.db
    );
  };

  const postAnchoredCreate = async (
    setup: TableSetup,
    name: string,
    order: { viewId: string; anchorId: string; position: 'before' | 'after' }
  ) =>
    fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: setup.tableId,
        fields: { [setup.primaryFieldId]: name },
        order,
      }),
    });

  const createAnchored = async (
    setup: TableSetup,
    name: string,
    order: { viewId: string; anchorId: string; position: 'before' | 'after' }
  ) => {
    const response = await postAnchoredCreate(setup, name, order);
    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    if (!response.ok || !parsed.success || !parsed.data.ok) {
      throw new Error(`Anchored create failed: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.record;
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

  const reorder = async (
    setup: TableSetup,
    name: string,
    order: { viewId: string; anchor: string; position: 'before' | 'after' }
  ) => {
    const result = await client.tables.reorderRecords({
      tableId: setup.tableId,
      recordIds: [recordId(setup, name)],
      order: {
        viewId: order.viewId,
        anchorId: recordId(setup, order.anchor),
        position: order.position,
      },
    });
    expect(result.ok).toBe(true);
  };

  const waitForBackfillUpdate = async (setup: TableSetup) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const result = await sql<{ count: string | number }>`
        SELECT count(*) AS count
        FROM pg_stat_activity
        WHERE state = 'active'
          AND pid <> pg_backend_pid()
          AND query ~* '^\\s*update'
          AND position(${setup.plainTableName} in query) > 0
          AND position('__auto_number' in query) > 0
      `.execute(ctx.testContainer.db);
      if (Number(result.rows[0]?.count ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Row-order backfill UPDATE never started');
  };

  it('resumes an interrupted backfill instead of exposing a partially filled column', async () => {
    const setup = await setupTable('T7570 Interrupted Backfill');
    const anchor = {
      viewId: setup.viewId,
      anchorId: recordId(setup, 'Row 3'),
      position: 'after' as const,
    };

    // Simulates a pod killed mid-backfill: every backfill UPDATE fails.
    await installUpdateTrigger(setup, 'fail', `RAISE EXCEPTION 't7570 injected backfill failure';`);
    try {
      const failed = await postAnchoredCreate(setup, 'Lost', anchor);
      expect(failed.ok).toBe(false);
    } finally {
      await dropUpdateTrigger(setup, 'fail');
    }
    expect(await listNamesInView(setup, setup.viewId)).toEqual(insertionOrder);

    await createAnchored(setup, 'Anchored', anchor);

    expect(await rowOrderColumnExists(setup, setup.viewId)).toBe(true);
    expect(await countNullOrders(setup, setup.viewId)).toBe(0);
    expect(await listNamesInView(setup, setup.viewId)).toEqual([
      'Row 1',
      'Row 2',
      'Row 3',
      'Anchored',
      'Row 4',
      'Row 5',
      'Row 6',
      'Row 7',
      'Row 8',
    ]);
  }, 120000);

  it('appends a record created during the backfill after every existing row', async () => {
    const setup = await setupTable('T7570 Append During Backfill');

    // Widen the backfill window so the append lands inside it.
    await installUpdateTrigger(setup, 'slow', 'PERFORM pg_sleep(0.25);');
    try {
      const anchored = createAnchored(setup, 'Anchored', {
        viewId: setup.viewId,
        anchorId: recordId(setup, 'Row 3'),
        position: 'after',
      });
      await waitForBackfillUpdate(setup);
      await ctx.createRecords(setup.tableId, [{ fields: { [setup.primaryFieldId]: 'Appended' } }]);
      await anchored;
    } finally {
      await dropUpdateTrigger(setup, 'slow');
    }

    expect(await countNullOrders(setup, setup.viewId)).toBe(0);
    expect(await listNamesInView(setup, setup.viewId)).toEqual([
      'Row 1',
      'Row 2',
      'Row 3',
      'Anchored',
      'Row 4',
      'Row 5',
      'Row 6',
      'Row 7',
      'Row 8',
      'Appended',
    ]);
  }, 120000);

  it('appends a record whose insert straddles the publish after every existing row', async () => {
    const setup = await setupTable('T7570 Append During Publish');
    const pendingColumn = `__pending_row_order_${setup.viewId}`;
    // An interrupted run left a filled pending column, so the reorder goes
    // straight to the publish.
    await sql`
      ALTER TABLE ${sql.table(setup.dbTableName)}
      ADD COLUMN ${sql.id(pendingColumn)} double precision
    `.execute(ctx.testContainer.db);
    await sql`
      UPDATE ${sql.table(setup.dbTableName)} SET ${sql.id(pendingColumn)} = "__auto_number"
    `.execute(ctx.testContainer.db);

    const countLockWaiters = async (mode?: string) => {
      const result = await sql<{ count: string | number }>`
        SELECT count(*) AS count
        FROM pg_locks
        WHERE NOT granted
          AND relation = to_regclass(${`"${setup.schemaName}"."${setup.plainTableName}"`})
          AND (${mode ?? null}::text IS NULL OR mode = ${mode ?? null})
      `.execute(ctx.testContainer.db);
      return Number(result.rows[0]?.count ?? 0);
    };
    const waitForLockWaiters = async (count: number, mode?: string) => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if ((await countLockWaiters(mode)) >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Expected ${count} lock waiters on the table`);
    };

    let releaseReader!: () => void;
    const readerReleased = new Promise<void>((resolve) => {
      releaseReader = resolve;
    });
    let readerHoldsLock!: () => void;
    const readerLocked = new Promise<void>((resolve) => {
      readerHoldsLock = resolve;
    });
    // A long read keeps the publish's ACCESS EXCLUSIVE queued, and inserts
    // arriving meanwhile queue behind it.
    const reader = ctx.testContainer.db.connection().execute(async (conn) => {
      await sql`BEGIN`.execute(conn);
      await sql`SELECT 1 FROM ${sql.table(setup.dbTableName)} LIMIT 1`.execute(conn);
      readerHoldsLock();
      await readerReleased;
      await sql`COMMIT`.execute(conn);
    });
    await readerLocked;

    try {
      const reordered = reorder(setup, 'Row 8', {
        viewId: setup.viewId,
        anchor: 'Row 1',
        position: 'before',
      });
      await waitForLockWaiters(1, 'AccessExclusiveLock');
      const appended = fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: setup.tableId,
          fields: { [setup.primaryFieldId]: 'Appended' },
        }),
      }).then((response) => expect(response.ok).toBe(true));
      await waitForLockWaiters(2);
      releaseReader();
      await Promise.all([reordered, appended]);
    } finally {
      releaseReader();
      await reader;
    }

    expect(await countNullOrders(setup, setup.viewId)).toBe(0);
    expect(await listNamesInView(setup, setup.viewId)).toEqual([
      'Row 8',
      'Row 1',
      'Row 2',
      'Row 3',
      'Row 4',
      'Row 5',
      'Row 6',
      'Row 7',
      'Appended',
    ]);
  }, 120000);

  it('undoing a delete appends the record in views whose column was created after the delete', async () => {
    const setup = await setupTable('T7570 Undo Delete Restore');
    const viewA = setup.viewId;

    // View A gets its row-order column before the delete, so the deleted
    // record's snapshot carries an order for A only.
    await reorder(setup, 'Row 8', { viewId: viewA, anchor: 'Row 1', position: 'before' });

    const deleteWindowId = 't7570-delete-window';
    const deleted = await getCommandBus(ctx).execute(
      buildUndoRedoContext(deleteWindowId),
      DeleteRecordsCommand.create({
        tableId: setup.tableId,
        recordIds: [recordId(setup, 'Row 4')],
      })._unsafeUnwrap()
    );
    expect(deleted.isOk()).toBe(true);

    const createdView = await client.tables.createView({
      tableId: setup.tableId,
      view: { type: 'grid', name: 'Created after delete' },
    });
    expect(createdView.ok).toBe(true);
    if (!createdView.ok) return;
    const viewB = createdView.data.viewId;
    await reorder(setup, 'Row 1', { viewId: viewB, anchor: 'Row 8', position: 'after' });
    expect(await rowOrderColumnExists(setup, viewB)).toBe(true);

    await executeUndo(ctx, setup.tableId, deleteWindowId);

    expect(await countNullOrders(setup, viewB)).toBe(0);
    expect(await listNamesInView(setup, viewA)).toEqual([
      'Row 8',
      'Row 1',
      'Row 2',
      'Row 3',
      'Row 4',
      'Row 5',
      'Row 6',
      'Row 7',
    ]);
    expect(await listNamesInView(setup, viewB)).toEqual([
      'Row 2',
      'Row 3',
      'Row 5',
      'Row 6',
      'Row 7',
      'Row 8',
      'Row 1',
      'Row 4',
    ]);
  }, 120000);

  it('backfills NULLs left in a column published by the pre-T7570 path', async () => {
    const setup = await setupTable('T7570 Legacy Partial Column');
    await reorder(setup, 'Row 8', { viewId: setup.viewId, anchor: 'Row 1', position: 'before' });

    // The old path committed the column first; an interrupted backfill left
    // the tail NULL, which sorts first.
    await sql`
      UPDATE ${sql.table(setup.dbTableName)}
      SET ${sql.id(`__row_${setup.viewId}`)} = NULL
      WHERE "__auto_number" BETWEEN 5 AND 7
    `.execute(ctx.testContainer.db);
    expect(await countNullOrders(setup, setup.viewId)).toBe(3);

    await reorder(setup, 'Row 2', { viewId: setup.viewId, anchor: 'Row 1', position: 'before' });

    expect(await countNullOrders(setup, setup.viewId)).toBe(0);
    expect(await listNamesInView(setup, setup.viewId)).toEqual([
      'Row 8',
      'Row 2',
      'Row 1',
      'Row 3',
      'Row 4',
      'Row 5',
      'Row 6',
      'Row 7',
    ]);
  }, 120000);

  it('builds the index of a column that was published without one', async () => {
    const setup = await setupTable('T7570 Unindexed Published Column');
    const indexName = rowOrderIndexName(setup.dbTableName, setup.viewId);
    const readIndexValidity = async () => {
      const result = await sql<{ indisvalid: boolean }>`
        SELECT i.indisvalid
        FROM pg_class c
        JOIN pg_index i ON i.indexrelid = c.oid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = ${indexName}
          AND n.nspname = ${setup.schemaName}
      `.execute(ctx.testContainer.db);
      return result.rows[0]?.indisvalid;
    };

    await reorder(setup, 'Row 8', { viewId: setup.viewId, anchor: 'Row 1', position: 'before' });
    expect(await readIndexValidity()).toBe(true);

    // Callers inside a request transaction publish the column but skip CIC.
    await sql`
      DROP INDEX ${sql.id(setup.schemaName, indexName)}
    `.execute(ctx.testContainer.db);

    await reorder(setup, 'Row 7', { viewId: setup.viewId, anchor: 'Row 1', position: 'before' });

    expect(await readIndexValidity()).toBe(true);
    expect(await listNamesInView(setup, setup.viewId)).toEqual([
      'Row 8',
      'Row 7',
      'Row 1',
      'Row 2',
      'Row 3',
      'Row 4',
      'Row 5',
      'Row 6',
    ]);
  }, 120000);
});
