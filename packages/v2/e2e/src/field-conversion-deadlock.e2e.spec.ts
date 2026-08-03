/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const isPgliteConnection = () => {
  const connectionString =
    process.env.TEABLE_V2_TEST_DATABASE_URL ??
    process.env.PRISMA_DATABASE_URL ??
    process.env.DATABASE_URL;

  return connectionString?.startsWith('pglite://') || connectionString === 'memory://';
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const quoteIdent = (value: string) => `"${value.replace(/"/g, '""')}"`;
const POSTGRES_SETUP_TIMEOUT_MS = 120000;

const createDeferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe.skipIf(isPgliteConnection())('field conversion deadlock regression (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
  }, POSTGRES_SETUP_TIMEOUT_MS);

  it('retries singleLineText -> formula conversion when a concurrent transaction creates the same deadlock shape as v1', async () => {
    const primaryFieldId = createFieldId();
    const dateFieldId = createFieldId();
    const monthFieldId = createFieldId();
    let blockerPromise: Promise<unknown> | undefined;
    let blockerTouchField: ReturnType<typeof createDeferred<void>> | undefined;
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Field Conversion Deadlock Regression',
      fields: [
        { type: 'singleLineText', id: primaryFieldId, name: 'Name', isPrimary: true },
        {
          type: 'date',
          id: dateFieldId,
          name: 'Source Date',
          options: {
            formatting: {
              date: 'YYYY-MM-DD',
              time: 'HH:mm',
              timeZone: 'utc',
            },
          },
        },
        {
          type: 'singleLineText',
          id: monthFieldId,
          name: '自然月份',
        },
      ],
    });

    try {
      await ctx.createRecord(table.id, {
        [primaryFieldId]: 'row-1',
        [dateFieldId]: '2024-01-31T16:30:00.000Z',
        [monthFieldId]: 'stale',
      });

      const tableMeta = await ctx.testContainer.db
        .selectFrom('table_meta')
        .select('db_table_name')
        .where('id', '=', table.id)
        .executeTakeFirstOrThrow();

      const dbTableName = tableMeta.db_table_name;
      const [schemaName = 'public', tableName = dbTableName] = dbTableName.includes('.')
        ? dbTableName.split('.', 2)
        : ['public', dbTableName];
      const fullTableName = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;
      const regclassName = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;

      const blockerReady = createDeferred<void>();
      const blockerTouchFieldDeferred = createDeferred<void>();
      blockerTouchField = blockerTouchFieldDeferred;

      blockerPromise = ctx.testContainer.db.connection().execute(async (db) => {
        await sql.raw('BEGIN').execute(db);

        try {
          await sql.raw(`SELECT 1 FROM ${fullTableName} LIMIT 1`).execute(db);
          blockerReady.resolve();

          await blockerTouchFieldDeferred.promise;

          await sql`
              UPDATE field
              SET last_modified_time = last_modified_time
              WHERE id = ${monthFieldId}
                AND table_id = ${table.id}
            `.execute(db);
        } finally {
          await sql
            .raw('ROLLBACK')
            .execute(db)
            .catch(() => undefined);
        }
      });

      await blockerReady.promise;

      const updateFieldPromise = ctx.updateField({
        tableId: table.id,
        fieldId: monthFieldId,
        field: {
          type: 'formula',
          options: {
            expression: `DATETIME_FORMAT({${dateFieldId}}, "YYYY-M") & "月"`,
            timeZone: 'Asia/Shanghai',
          },
        },
      });

      const ddlWaitDeadline = Date.now() + 5000;
      while (Date.now() < ddlWaitDeadline) {
        const waitingLockResult = await sql<{ count: number }>`
            SELECT COUNT(*)::int AS count
            FROM pg_locks
            WHERE relation = to_regclass(${regclassName})
              AND mode = 'AccessExclusiveLock'
              AND NOT granted
          `.execute(ctx.testContainer.db);

        if ((waitingLockResult.rows[0]?.count ?? 0) > 0) {
          break;
        }

        await sleep(25);
      }

      const waitingLockCheck = await sql<{ count: number }>`
          SELECT COUNT(*)::int AS count
          FROM pg_locks
          WHERE relation = to_regclass(${regclassName})
            AND mode = 'AccessExclusiveLock'
            AND NOT granted
        `.execute(ctx.testContainer.db);
      expect(waitingLockCheck.rows[0]?.count ?? 0).toBeGreaterThan(0);

      blockerTouchFieldDeferred.resolve();

      const [updatedTable, blockerResult] = await Promise.all([
        updateFieldPromise,
        blockerPromise.then(
          () => ({ status: 'fulfilled' as const }),
          (error) => ({ status: 'rejected' as const, error })
        ),
      ]);

      const updatedField = updatedTable.fields.find((field) => field.id === monthFieldId);
      expect(updatedField?.type).toBe('formula');
      expect(
        blockerResult.status === 'fulfilled' ||
          String(blockerResult.error).includes('deadlock detected') ||
          String(blockerResult.error).includes('current transaction is aborted')
      ).toBe(true);

      const records = await ctx.listRecords(table.id);
      expect(records).toHaveLength(1);
      expect(records[0]?.fields[monthFieldId]).toBe('2024-2月');
    } finally {
      blockerTouchField?.resolve();
      await blockerPromise?.catch(() => undefined);
      await ctx.deleteTable(table.id);
    }
  }, 20000);
});
