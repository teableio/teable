/* eslint-disable @typescript-eslint/naming-convention */
import { rowOrderIndexName } from '@teable/v2-adapter-table-repository-postgres';
import { createRecordOkResponseSchema } from '@teable/v2-contract-http';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * T7251 e2e: lazy creation of a missing `__row_<viewId>` row-order column on
 * the record write path (anchored record create → PostgresRecordOrderCalculator).
 *
 * Runs against real Postgres (`dbMode: 'postgres'`): PGlite cannot execute
 * CREATE/DROP INDEX CONCURRENTLY, and the point of the fix is online DDL —
 * ADD COLUMN IF NOT EXISTS with a fail-fast lock_timeout, a chunked autocommit
 * backfill, and CREATE INDEX CONCURRENTLY IF NOT EXISTS — performed on the
 * non-transactional handle instead of inside the request transaction.
 *
 * Which assertions fail on pre-fix code:
 * - 'two concurrent anchored creates both succeed...' — pre-fix the second
 *   transaction runs plain `ALTER TABLE ADD COLUMN` (no IF NOT EXISTS) and,
 *   after blocking on the first transaction's AccessExclusiveLock, fails with
 *   `column ... already exists`, failing the whole request. Post-fix both
 *   succeed (IF NOT EXISTS + IS NULL guards are race-tolerant).
 * - The single-statement non-chunked backfill, missing WHERE IS NULL guard,
 *   non-concurrent index build, and in-request-transaction execution are
 *   structural and are asserted in the unit spec
 *   (shared/ensureRowOrderColumnOnline.spec.ts); on a small table they are
 *   not observable from the product API.
 */
describe('v2 lazy row-order column creation (e2e, T7251)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
  }, 300000);

  const createRecordAnchored = async (
    tableId: string,
    fields: Record<string, unknown>,
    order: { viewId: string; anchorId: string; position: 'before' | 'after' }
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, fields, order }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create record: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create record response');
    }
    return parsed.data.data.record;
  };

  const setupTable = async (name: string) => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name,
      fields: [{ name: 'Name', type: 'singleLineText', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const tableId = table.id;
    const viewId = table.views[0]!.id;
    const primaryFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';

    const created = await ctx.createRecords(
      tableId,
      Array.from({ length: 8 }, (_, index) => ({
        fields: { [primaryFieldId]: `Row ${index + 1}` },
      }))
    );
    const recordIds = created.map((record) => record.id);

    const tableMeta = await ctx.testContainer.db
      .selectFrom('table_meta')
      .select('db_table_name')
      .where('id', '=', tableId)
      .executeTakeFirst();
    const dbTableName = tableMeta?.db_table_name ?? '';
    if (!dbTableName) {
      throw new Error(`db_table_name not found for table ${tableId}`);
    }
    const dotIndex = dbTableName.indexOf('.');
    const schemaName = dotIndex === -1 ? 'public' : dbTableName.slice(0, dotIndex);
    const plainTableName = dotIndex === -1 ? dbTableName : dbTableName.slice(dotIndex + 1);
    const orderColumn = `__row_${viewId}`;
    const indexName = rowOrderIndexName(dbTableName, viewId);

    return {
      tableId,
      viewId,
      primaryFieldId,
      recordIds,
      dbTableName,
      schemaName,
      plainTableName,
      orderColumn,
      indexName,
    };
  };

  type Fixture = Awaited<ReturnType<typeof setupTable>>;

  const dropRowOrderStorage = async (fixture: Fixture) => {
    // Simulate the production-missing state: no row-order column, no index.
    await sql`
      DROP INDEX IF EXISTS ${sql.id(fixture.schemaName, fixture.indexName)}
    `.execute(ctx.testContainer.db);
    await sql`
      ALTER TABLE ${sql.table(fixture.dbTableName)}
      DROP COLUMN IF EXISTS ${sql.id(fixture.orderColumn)}
    `.execute(ctx.testContainer.db);
  };

  const rowOrderColumnExists = async (fixture: Fixture): Promise<boolean> => {
    const result = await sql<{ column_name: string }>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${fixture.schemaName}
        AND table_name = ${fixture.plainTableName}
        AND column_name = ${fixture.orderColumn}
    `.execute(ctx.testContainer.db);
    return result.rows.length > 0;
  };

  const readOrderRows = async (fixture: Fixture) => {
    const result = await sql<{ __id: string; __auto_number: number; order_value: number | null }>`
      SELECT "__id", "__auto_number", ${sql.ref(fixture.orderColumn)} AS order_value
      FROM ${sql.table(fixture.dbTableName)}
      ORDER BY "__auto_number" ASC
    `.execute(ctx.testContainer.db);
    return result.rows;
  };

  const readIndexState = async (fixture: Fixture) => {
    const result = await sql<{ indisvalid: boolean }>`
      SELECT i.indisvalid
      FROM pg_class c
      JOIN pg_index i ON i.indexrelid = c.oid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = ${fixture.indexName}
        AND n.nspname = ${fixture.schemaName}
    `.execute(ctx.testContainer.db);
    return result.rows[0];
  };

  it('recreates a missing row-order column online during an anchored create', async () => {
    const fixture = await setupTable('T7251 Lazy Create');
    await dropRowOrderStorage(fixture);
    expect(await rowOrderColumnExists(fixture)).toBe(false);

    // Anchored create through the real product path — this triggers
    // PostgresRecordOrderCalculator.calculateOrders on a table whose
    // row-order column is missing (the production incident scenario).
    const anchorId = fixture.recordIds[2]!;
    const created = await createRecordAnchored(
      fixture.tableId,
      { [fixture.primaryFieldId]: 'Anchored New Row' },
      { viewId: fixture.viewId, anchorId, position: 'after' }
    );
    expect(created.id).toBeTruthy();

    expect(await rowOrderColumnExists(fixture)).toBe(true);

    const rows = await readOrderRows(fixture);
    expect(rows).toHaveLength(9);
    // Pre-existing rows were backfilled from __auto_number.
    const originalRows = rows.filter((row) => row.__id !== created.id);
    expect(originalRows).toHaveLength(8);
    for (const row of originalRows) {
      expect(Number(row.order_value)).toBe(Number(row.__auto_number));
    }
    // The anchored row got a fractional order between the anchor (3) and its
    // next neighbor (4).
    const newRow = rows.find((row) => row.__id === created.id);
    expect(newRow).toBeDefined();
    expect(Number(newRow!.order_value)).toBeGreaterThan(3);
    expect(Number(newRow!.order_value)).toBeLessThan(4);

    const indexState = await readIndexState(fixture);
    expect(indexState).toBeDefined();
    expect(indexState!.indisvalid).toBe(true);
  }, 120000);

  it('two concurrent anchored creates both succeed when the column is missing', async () => {
    const fixture = await setupTable('T7251 Concurrent Create');
    await dropRowOrderStorage(fixture);

    // Both requests observe the missing column and race to create it.
    // Pre-fix, the loser fails with `column ... already exists` (plain
    // ADD COLUMN without IF NOT EXISTS); post-fix IF NOT EXISTS + IS NULL
    // guards make the race safe.
    const [first, second] = await Promise.all([
      createRecordAnchored(
        fixture.tableId,
        { [fixture.primaryFieldId]: 'Concurrent A' },
        { viewId: fixture.viewId, anchorId: fixture.recordIds[0]!, position: 'after' }
      ),
      createRecordAnchored(
        fixture.tableId,
        { [fixture.primaryFieldId]: 'Concurrent B' },
        { viewId: fixture.viewId, anchorId: fixture.recordIds[6]!, position: 'before' }
      ),
    ]);
    expect(first.id).toBeTruthy();
    expect(second.id).toBeTruthy();

    const rows = await readOrderRows(fixture);
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(row.order_value).not.toBeNull();
    }
    const originalRows = rows.filter((row) => row.__id !== first.id && row.__id !== second.id);
    for (const row of originalRows) {
      expect(Number(row.order_value)).toBe(Number(row.__auto_number));
    }

    const indexState = await readIndexState(fixture);
    expect(indexState).toBeDefined();
    expect(indexState!.indisvalid).toBe(true);
  }, 120000);

  it('is an idempotent no-op once the column and index exist', async () => {
    const fixture = await setupTable('T7251 Idempotent Ensure');
    await dropRowOrderStorage(fixture);

    // First anchored create builds the column + index online.
    const first = await createRecordAnchored(
      fixture.tableId,
      { [fixture.primaryFieldId]: 'First Anchored' },
      { viewId: fixture.viewId, anchorId: fixture.recordIds[2]!, position: 'after' }
    );
    const firstRows = await readOrderRows(fixture);
    const firstOrder = Number(firstRows.find((row) => row.__id === first.id)!.order_value);
    expect(firstOrder).toBeGreaterThan(3);
    expect(firstOrder).toBeLessThan(4);

    // Second anchored create hits the information_schema fast path — no
    // re-creation, existing order values untouched.
    const second = await createRecordAnchored(
      fixture.tableId,
      { [fixture.primaryFieldId]: 'Second Anchored' },
      { viewId: fixture.viewId, anchorId: fixture.recordIds[7]!, position: 'before' }
    );
    expect(second.id).toBeTruthy();

    const rows = await readOrderRows(fixture);
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(row.order_value).not.toBeNull();
    }
    const firstRow = rows.find((row) => row.__id === first.id);
    expect(Number(firstRow!.order_value)).toBe(firstOrder);
    const originalRows = rows.filter((row) => row.__id !== first.id && row.__id !== second.id);
    for (const row of originalRows) {
      expect(Number(row.order_value)).toBe(Number(row.__auto_number));
    }

    const indexState = await readIndexState(fixture);
    expect(indexState).toBeDefined();
    expect(indexState!.indisvalid).toBe(true);
  }, 120000);
});
