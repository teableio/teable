import {
  FieldOperationKind,
  ok,
  RecordWriteOperationKind,
  v2CoreTokens,
  type IFieldOperationPlugin,
  type IRecordWritePlugin,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * T7946: table schema writes and record writes coordinate through
 * transaction-scoped advisory locks on a dedicated pool connected to meta.
 *
 * - An ordinary update holds a `shared` lease from before its metadata read
 *   until its commit, undo capture and events settle.
 * - Field deletion holds an `exclusive` lease from before its first metadata
 *   read until completion.
 * - T8078: typecast alone does not change schema; existing options retain shared
 *   concurrency, while missing options require exclusive and fresh metadata.
 *
 * Every race below uses real HTTP requests and real PostgreSQL locks; the test
 * observes blocked waiters through `pg_locks` instead of sleeping.
 */

type UpdateRecordErrorBody = {
  ok?: boolean;
  error?: {
    code?: string;
    message?: string;
    tags?: string[];
    details?: Record<string, unknown>;
  };
};

interface RaceFixture {
  tableId: string;
  recordId: string;
  secondRecordId: string;
  thirdRecordId: string;
  statusFieldId: string;
  statusDbFieldName: string;
  sentinelFieldId: string;
  sentinelDbFieldName: string;
  amountFieldId: string;
  initialVersion: number;
}

type Gate = {
  wait: Promise<void>;
  open: () => void;
};

const createGate = (): Gate => {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
};

const readStoredRecord = async (
  ctx: SharedTestContext,
  tableId: string,
  recordId: string,
  sentinelDbFieldName: string
): Promise<{ version: number; sentinel: string | null }> => {
  const result = await sql<{ version: number; sentinel: string | null }>`
    SELECT "__version" AS "version", ${sql.id(sentinelDbFieldName)} AS "sentinel"
    FROM ${sql.table(`${ctx.baseId}.${tableId}`)}
    WHERE "__id" = ${recordId}
  `.execute(ctx.testContainer.db);

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Record ${recordId} not found in ${tableId}`);
  }
  return row;
};

const columnExists = async (
  ctx: SharedTestContext,
  tableId: string,
  columnName: string
): Promise<boolean> => {
  const result = await sql<{ column_name: string }>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ${ctx.baseId}
      AND table_name = ${tableId}
      AND column_name = ${columnName}
  `.execute(ctx.testContainer.db);
  return result.rows.length > 0;
};

const countSchemaCoordinationWaiters = async (ctx: SharedTestContext): Promise<number> => {
  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM pg_locks locks
    JOIN pg_stat_activity activity ON activity.pid = locks.pid
    WHERE locks.locktype = 'advisory'
      AND NOT locks.granted
      AND activity.application_name = 'teable-v2-schema-coordination'
  `.execute(ctx.testContainer.db);
  return Number(result.rows[0]?.count ?? 0);
};

const waitForSchemaWaiter = async (ctx: SharedTestContext): Promise<void> => {
  await vi.waitFor(
    async () => {
      expect(await countSchemaCoordinationWaiters(ctx)).toBeGreaterThan(0);
    },
    { timeout: 10_000, interval: 25 }
  );
};

const waitForNoSchemaWaiter = async (ctx: SharedTestContext): Promise<void> => {
  await vi.waitFor(
    async () => {
      expect(await countSchemaCoordinationWaiters(ctx)).toBe(0);
    },
    { timeout: 10_000, interval: 25 }
  );
};

const createRaceFixture = async (ctx: SharedTestContext, suffix: string): Promise<RaceFixture> => {
  const table = await ctx.createTable({
    baseId: ctx.baseId,
    name: `T7946 Schema Locks ${suffix} ${Date.now()}`,
    fields: [
      { name: 'Name', type: 'singleLineText', isPrimary: true },
      {
        name: 'Status',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'Alpha', color: 'blueLight1' },
            { name: 'Beta', color: 'greenLight1' },
          ],
        },
      },
      { name: 'Sentinel', type: 'singleLineText' },
      { name: 'Amount', type: 'number' },
    ],
    views: [{ type: 'grid' }],
  });

  const primaryField = table.fields.find((field) => field.isPrimary);
  const statusField = table.fields.find((field) => field.name === 'Status');
  const sentinelField = table.fields.find((field) => field.name === 'Sentinel');
  const amountField = table.fields.find((field) => field.name === 'Amount');
  expect(primaryField?.id).toBeTruthy();
  expect(statusField?.id).toBeTruthy();
  expect(statusField?.dbFieldName).toBeTruthy();
  expect(sentinelField?.id).toBeTruthy();
  expect(sentinelField?.dbFieldName).toBeTruthy();
  expect(amountField?.id).toBeTruthy();

  // `Beta` already exists so the side-effect service does not auto-create an
  // option or update the table (which would take a write lease on its own).
  const record = await ctx.createRecord(table.id, {
    [primaryField!.id]: 'row-a',
    [statusField!.id]: 'Alpha',
    [sentinelField!.id]: 'sentinel-before',
  });
  const secondRecord = await ctx.createRecord(table.id, {
    [primaryField!.id]: 'row-b',
    [statusField!.id]: 'Alpha',
    [sentinelField!.id]: 'second-before',
  });
  const thirdRecord = await ctx.createRecord(table.id, {
    [primaryField!.id]: 'row-c',
    [statusField!.id]: 'Alpha',
    [sentinelField!.id]: 'third-before',
  });

  const stored = await readStoredRecord(ctx, table.id, record.id, sentinelField!.dbFieldName!);

  return {
    tableId: table.id,
    recordId: record.id,
    secondRecordId: secondRecord.id,
    thirdRecordId: thirdRecord.id,
    statusFieldId: statusField!.id,
    statusDbFieldName: statusField!.dbFieldName!,
    sentinelFieldId: sentinelField!.id,
    sentinelDbFieldName: sentinelField!.dbFieldName!,
    initialVersion: stored.version,
    amountFieldId: amountField!.id,
  };
};

const createUpdateGatePlugin = (options: {
  name: string;
  tableId: string;
  recordId?: string;
  hook: 'guard' | 'beforePersist';
  entered?: Gate;
  gate?: Gate;
  onEnter?: () => Promise<void>;
}): IRecordWritePlugin => {
  const run = async (context: Parameters<NonNullable<IRecordWritePlugin['guard']>>[0]) => {
    if (context.kind !== RecordWriteOperationKind.updateOne) return ok(undefined);
    if (context.table.id().toString() !== options.tableId) return ok(undefined);
    if (options.recordId && context.payload.recordId.toString() !== options.recordId) {
      return ok(undefined);
    }
    options.entered?.open();
    if (options.gate) {
      await options.gate.wait;
    }
    await options.onEnter?.();
    return ok(undefined);
  };

  return {
    name: options.name,
    supports: (operation) => operation === RecordWriteOperationKind.updateOne,
    ...(options.hook === 'guard' ? { guard: run } : { beforePersist: run }),
  };
};

const createDeleteGatePlugin = (options: {
  name: string;
  tableId: string;
  fieldId: string;
  entered: Gate;
  gate: Gate;
}): IFieldOperationPlugin => ({
  name: options.name,
  supports: (operation) => operation === FieldOperationKind.delete,
  beforePersist: async (context) => {
    if (context.kind !== FieldOperationKind.delete) return ok(undefined);
    if (context.table.id().toString() !== options.tableId) return ok(undefined);
    if (context.payload.fieldId.toString() !== options.fieldId) return ok(undefined);
    options.entered.open();
    await options.gate.wait;
    return ok(undefined);
  },
});

const addRecordPlugin = (ctx: SharedTestContext, plugin: IRecordWritePlugin): (() => void) => {
  const plugins = ctx.testContainer.container.resolve<IRecordWritePlugin[]>(
    v2CoreTokens.recordWritePlugins
  );
  plugins.push(plugin);
  return () => {
    const index = plugins.indexOf(plugin);
    if (index >= 0) plugins.splice(index, 1);
  };
};

const addFieldPlugin = (ctx: SharedTestContext, plugin: IFieldOperationPlugin): (() => void) => {
  const plugins = ctx.testContainer.container.resolve<IFieldOperationPlugin[]>(
    v2CoreTokens.fieldOperationPlugins
  );
  plugins.push(plugin);
  return () => {
    const index = plugins.indexOf(plugin);
    if (index >= 0) plugins.splice(index, 1);
  };
};

const submitUpdate = (
  ctx: SharedTestContext,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>,
  typecast?: boolean
): Promise<Response> =>
  fetch(`${ctx.baseUrl}/tables/updateRecord`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId, recordId, fields, typecast }),
  });

const submitTypecastUpdate = (
  ctx: SharedTestContext,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>,
  variant: 'single' | 'selector' | 'explicit'
): Promise<Response> => {
  if (variant === 'single') return submitUpdate(ctx, tableId, recordId, fields, true);
  return fetch(`${ctx.baseUrl}/tables/updateRecords`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tableId,
      typecast: true,
      ...(variant === 'explicit'
        ? { records: [{ id: recordId, fields }] }
        : { recordIds: [recordId], fields }),
    }),
  });
};

const submitDeleteField = (
  ctx: SharedTestContext,
  tableId: string,
  fieldId: string
): Promise<Response> =>
  fetch(`${ctx.baseUrl}/tables/deleteField`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseId: ctx.baseId, tableId, fieldId }),
  });

const expectRecordRolledBack = async (ctx: SharedTestContext, fixture: RaceFixture) => {
  const stored = await readStoredRecord(
    ctx,
    fixture.tableId,
    fixture.recordId,
    fixture.sentinelDbFieldName
  );
  expect(stored.version).toBe(fixture.initialVersion);
  expect(stored.sentinel).toBe('sentinel-before');
};

describe('[T7946] v2 schema writes coordinate with record updates (e2e, postgres)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
  }, 60_000);

  it.each([false, true])(
    'lets an in-flight update finish before deleting the field (typecast=%s)',
    async (typecast) => {
      const fixture = await createRaceFixture(ctx, 'update-first');
      const entered = createGate();
      const release = createGate();
      const removePlugin = addRecordPlugin(
        ctx,
        createUpdateGatePlugin({
          name: `e2e-update-first-${Date.now()}`,
          tableId: fixture.tableId,
          recordId: fixture.recordId,
          hook: 'guard',
          entered,
          gate: release,
        })
      );

      let updatePromise: Promise<Response> | undefined;
      let deletePromise: Promise<Response> | undefined;
      try {
        updatePromise = submitUpdate(
          ctx,
          fixture.tableId,
          fixture.recordId,
          {
            [fixture.statusFieldId]: typecast ? 'Gamma' : 'Beta',
            [fixture.sentinelFieldId]: 'sentinel-after',
          },
          typecast
        );
        await entered.wait;

        deletePromise = submitDeleteField(ctx, fixture.tableId, fixture.statusFieldId);
        await waitForSchemaWaiter(ctx);

        release.open();
        const [updateResponse, deleteResponse] = await Promise.all([updatePromise, deletePromise]);

        expect(updateResponse.status).toBe(200);
        const updateBody = (await updateResponse.json()) as { ok?: boolean };
        expect(updateBody.ok).toBe(true);
        expect(deleteResponse.status).toBe(200);

        await waitForNoSchemaWaiter(ctx);
        expect(await columnExists(ctx, fixture.tableId, fixture.statusDbFieldName)).toBe(false);
        const freshTable = await ctx.getTableById(fixture.tableId);
        expect(freshTable.fields.some((field) => field.id === fixture.statusFieldId)).toBe(false);

        const stored = await readStoredRecord(
          ctx,
          fixture.tableId,
          fixture.recordId,
          fixture.sentinelDbFieldName
        );
        expect(stored.version).toBe(fixture.initialVersion + 1);
        expect(stored.sentinel).toBe('sentinel-after');
      } finally {
        release.open();
        removePlugin();
        await Promise.allSettled([updatePromise, deletePromise]);
      }
    }
  );

  it.each([false, true])(
    'applies a delete first and rejects the waiting update on missing field (typecast=%s)',
    async (typecast) => {
      const fixture = await createRaceFixture(ctx, 'delete-first');
      const entered = createGate();
      const release = createGate();
      const removePlugin = addFieldPlugin(
        ctx,
        createDeleteGatePlugin({
          name: `e2e-delete-first-${Date.now()}`,
          tableId: fixture.tableId,
          fieldId: fixture.statusFieldId,
          entered,
          gate: release,
        })
      );

      let deletePromise: Promise<Response> | undefined;
      let updatePromise: Promise<Response> | undefined;
      try {
        deletePromise = submitDeleteField(ctx, fixture.tableId, fixture.statusFieldId);
        await entered.wait;

        updatePromise = submitUpdate(
          ctx,
          fixture.tableId,
          fixture.recordId,
          {
            [fixture.statusFieldId]: typecast ? 'Gamma' : 'Beta',
            [fixture.sentinelFieldId]: 'sentinel-after',
          },
          typecast
        );
        await waitForSchemaWaiter(ctx);

        release.open();
        const deleteResponse = await deletePromise;
        expect(deleteResponse.status).toBe(200);

        const updateResponse = await updatePromise;
        const updateBody = (await updateResponse.json()) as UpdateRecordErrorBody;
        expect(updateResponse.status).toBe(404);
        expect(updateBody.ok).toBe(false);
        expect(updateBody.error?.code).toBe('field.not_found');
        expect(await columnExists(ctx, fixture.tableId, fixture.statusDbFieldName)).toBe(false);

        await expectRecordRolledBack(ctx, fixture);
      } finally {
        release.open();
        removePlugin();
        await Promise.allSettled([deletePromise, updatePromise]);
      }
    }
  );

  it('allows ordinary updates on different records to run concurrently', async () => {
    const fixture = await createRaceFixture(ctx, 'shared-shared');
    const entered = createGate();
    const release = createGate();
    const removePlugin = addRecordPlugin(
      ctx,
      createUpdateGatePlugin({
        name: `e2e-shared-parallel-${Date.now()}`,
        tableId: fixture.tableId,
        recordId: fixture.recordId,
        hook: 'guard',
        entered,
        gate: release,
      })
    );

    let firstPromise: Promise<Response> | undefined;
    try {
      let firstSettled = false;
      firstPromise = submitUpdate(ctx, fixture.tableId, fixture.recordId, {
        [fixture.sentinelFieldId]: 'first-after',
      }).finally(() => {
        firstSettled = true;
      });
      await entered.wait;

      const secondResponse = await submitUpdate(ctx, fixture.tableId, fixture.secondRecordId, {
        [fixture.sentinelFieldId]: 'second-after',
      });
      expect(secondResponse.status).toBe(200);
      expect(firstSettled).toBe(false);

      release.open();
      const firstResponse = await firstPromise;
      expect(firstResponse.status).toBe(200);

      const secondStored = await readStoredRecord(
        ctx,
        fixture.tableId,
        fixture.secondRecordId,
        fixture.sentinelDbFieldName
      );
      expect(secondStored.sentinel).toBe('second-after');
      const firstStored = await readStoredRecord(
        ctx,
        fixture.tableId,
        fixture.recordId,
        fixture.sentinelDbFieldName
      );
      expect(firstStored.sentinel).toBe('first-after');
    } finally {
      release.open();
      removePlugin();
      await Promise.allSettled([firstPromise]);
    }
  });

  it.each(['single', 'selector', 'explicit'] as const)(
    '[T8078] allows ordinary typecast updates on different records to run concurrently (%s)',
    async (variant) => {
      const fixture = await createRaceFixture(ctx, 'typecast-shared');
      const entered = createGate();
      const release = createGate();
      const removePlugin = addRecordPlugin(
        ctx,
        createUpdateGatePlugin({
          name: `e2e-typecast-parallel-${Date.now()}`,
          tableId: fixture.tableId,
          recordId: fixture.recordId,
          hook: 'guard',
          entered,
          gate: release,
        })
      );

      let firstPromise: Promise<Response> | undefined;
      let secondPromise: Promise<Response> | undefined;
      try {
        firstPromise = submitUpdate(
          ctx,
          fixture.tableId,
          fixture.recordId,
          {
            [fixture.statusFieldId]: 'Beta',
            [fixture.sentinelFieldId]: 'first-after',
            [fixture.amountFieldId]: '12',
          },
          true
        );
        await entered.wait;

        let secondSettled = false;
        secondPromise = submitTypecastUpdate(
          ctx,
          fixture.tableId,
          fixture.secondRecordId,
          {
            [fixture.statusFieldId]: 'Beta',
            [fixture.sentinelFieldId]: 'second-after',
            [fixture.amountFieldId]: '34',
          },
          variant
        ).finally(() => {
          secondSettled = true;
        });

        // Observe the real PostgreSQL waiter, not a wall-clock latency threshold.
        // The second request must complete while the first still holds its lease.
        await vi.waitFor(
          async () => {
            expect(secondSettled || (await countSchemaCoordinationWaiters(ctx)) > 0).toBe(true);
          },
          { timeout: 10_000, interval: 25 }
        );
        expect(
          secondSettled,
          'ordinary typecast update must not wait for an exclusive schema lease'
        ).toBe(true);
        expect((await secondPromise).status).toBe(200);

        release.open();
        expect((await firstPromise).status).toBe(200);
        expect(
          (
            await readStoredRecord(
              ctx,
              fixture.tableId,
              fixture.recordId,
              fixture.sentinelDbFieldName
            )
          ).sentinel
        ).toBe('first-after');
        expect(
          (
            await readStoredRecord(
              ctx,
              fixture.tableId,
              fixture.secondRecordId,
              fixture.sentinelDbFieldName
            )
          ).sentinel
        ).toBe('second-after');
        const records = await ctx.listRecords(fixture.tableId);
        expect(
          records.find((record) => record.id === fixture.recordId)?.fields[fixture.amountFieldId]
        ).toBe(12);
        expect(
          records.find((record) => record.id === fixture.secondRecordId)?.fields[
            fixture.amountFieldId
          ]
        ).toBe(34);
      } finally {
        release.open();
        removePlugin();
        await Promise.allSettled([firstPromise, secondPromise]);
      }
    }
  );

  it.each([
    { variant: 'single', option: 'Delta' },
    { variant: 'selector', option: 'Delta' },
    { variant: 'explicit', option: 'Delta' },
    { variant: 'single', option: 'Gamma' },
  ] as const)(
    '[T8078] reloads select metadata before concurrent option creation ($variant/$option)',
    async ({ variant, option }) => {
      const fixture = await createRaceFixture(ctx, `typecast-options-${variant}`);
      const entered = createGate();
      const release = createGate();
      const removePlugin = addRecordPlugin(
        ctx,
        createUpdateGatePlugin({
          name: `e2e-typecast-options-${Date.now()}`,
          tableId: fixture.tableId,
          recordId: fixture.recordId,
          hook: 'guard',
          entered,
          gate: release,
        })
      );
      let firstPromise: Promise<Response> | undefined;
      let secondPromise: Promise<Response> | undefined;
      try {
        firstPromise = submitUpdate(
          ctx,
          fixture.tableId,
          fixture.recordId,
          { [fixture.statusFieldId]: 'Gamma' },
          true
        );
        await entered.wait;
        secondPromise = submitTypecastUpdate(
          ctx,
          fixture.tableId,
          fixture.secondRecordId,
          { [fixture.statusFieldId]: option },
          variant
        );
        await waitForSchemaWaiter(ctx);
        release.open();
        expect((await firstPromise).status).toBe(200);
        expect((await secondPromise).status).toBe(200);

        const fresh = await ctx.getTableById(fixture.tableId);
        const status = fresh.fields.find((field) => field.id === fixture.statusFieldId);
        expect(status?.options).toMatchObject({
          choices: expect.arrayContaining([
            expect.objectContaining({ name: 'Alpha' }),
            expect.objectContaining({ name: 'Beta' }),
            expect.objectContaining({ name: 'Gamma' }),
            expect.objectContaining({ name: option }),
          ]),
        });
        expect(status?.options).toHaveProperty('choices.length', option === 'Gamma' ? 3 : 4);
        const records = await ctx.listRecords(fixture.tableId);
        expect(
          records.find((record) => record.id === fixture.recordId)?.fields[fixture.statusFieldId]
        ).toBe('Gamma');
        expect(
          records.find((record) => record.id === fixture.secondRecordId)?.fields[
            fixture.statusFieldId
          ]
        ).toBe(option);
        await waitForNoSchemaWaiter(ctx);
      } finally {
        release.open();
        removePlugin();
        await Promise.allSettled([firstPromise, secondPromise]);
      }
    }
  );

  it('[T8078] reloads metadata after the lease gap before creating the same option twice', async () => {
    const fixture = await createRaceFixture(ctx, 'typecast-upgrade-gap');
    const entered = createGate();
    const release = createGate();
    const removePlugin = addRecordPlugin(
      ctx,
      createUpdateGatePlugin({
        name: `e2e-typecast-gap-${Date.now()}`,
        tableId: fixture.tableId,
        recordId: fixture.recordId,
        hook: 'guard',
        entered,
        gate: release,
      })
    );
    let holderPromise: Promise<Response> | undefined;
    let firstWriterPromise: Promise<Response> | undefined;
    let secondWriterPromise: Promise<Response> | undefined;
    try {
      // The holder keeps the shared lease so both option writers finish their
      // metadata probe and queue for exclusive before either can commit.
      holderPromise = submitUpdate(
        ctx,
        fixture.tableId,
        fixture.recordId,
        { [fixture.statusFieldId]: 'Beta' },
        true
      );
      await entered.wait;

      firstWriterPromise = submitTypecastUpdate(
        ctx,
        fixture.tableId,
        fixture.secondRecordId,
        { [fixture.statusFieldId]: 'Gamma' },
        'single'
      );
      secondWriterPromise = submitTypecastUpdate(
        ctx,
        fixture.tableId,
        fixture.thirdRecordId,
        { [fixture.statusFieldId]: 'Gamma' },
        'single'
      );
      await vi.waitFor(
        async () => {
          expect(await countSchemaCoordinationWaiters(ctx)).toBeGreaterThanOrEqual(2);
        },
        { timeout: 10_000, interval: 25 }
      );

      release.open();
      expect((await holderPromise).status).toBe(200);
      expect((await firstWriterPromise).status).toBe(200);
      expect((await secondWriterPromise).status).toBe(200);

      const fresh = await ctx.getTableById(fixture.tableId);
      const status = fresh.fields.find((field) => field.id === fixture.statusFieldId);
      expect(status?.options).toHaveProperty('choices.length', 3);
      const records = await ctx.listRecords(fixture.tableId);
      expect(
        records.find((record) => record.id === fixture.secondRecordId)?.fields[
          fixture.statusFieldId
        ]
      ).toBe('Gamma');
      expect(
        records.find((record) => record.id === fixture.thirdRecordId)?.fields[fixture.statusFieldId]
      ).toBe('Gamma');
    } finally {
      release.open();
      removePlugin();
      await Promise.allSettled([holderPromise, firstWriterPromise, secondWriterPromise]);
    }
  });

  it('keeps a missing physical column with active metadata as an infrastructure 500', async () => {
    const fixture = await createRaceFixture(ctx, 'physical-drift');
    const removePlugin = addRecordPlugin(
      ctx,
      createUpdateGatePlugin({
        name: `e2e-drop-physical-only-${Date.now()}`,
        tableId: fixture.tableId,
        recordId: fixture.recordId,
        hook: 'beforePersist',
        onEnter: async () => {
          // Physical drift only: drop the column on the pool's own connection
          // while leaving field metadata active, exactly what a broken schema
          // repair or an out-of-band DDL change looks like.
          await sql`
            ALTER TABLE ${sql.table(`${ctx.baseId}.${fixture.tableId}`)}
            DROP COLUMN ${sql.id(fixture.statusDbFieldName)}
          `.execute(ctx.testContainer.db);
        },
      })
    );

    try {
      const response = await submitUpdate(ctx, fixture.tableId, fixture.recordId, {
        [fixture.statusFieldId]: 'Beta',
        [fixture.sentinelFieldId]: 'sentinel-after',
      });
      const body = (await response.json()) as UpdateRecordErrorBody;

      expect(response.status).toBe(500);
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe('db.undefined_column');
      expect(body.error?.tags).toContain('infrastructure');
      expect(body.error?.tags).not.toContain('conflict');
      expect(body.error?.details).toMatchObject({
        pgCode: '42703',
        column: fixture.statusDbFieldName,
      });

      // Fresh metadata still knows the field, so this is drift, not a schema change.
      const freshTable = await ctx.getTableById(fixture.tableId);
      expect(freshTable.fields.some((field) => field.id === fixture.statusFieldId)).toBe(true);
      expect(await columnExists(ctx, fixture.tableId, fixture.statusDbFieldName)).toBe(false);

      await expectRecordRolledBack(ctx, fixture);
    } finally {
      removePlugin();
    }
  });
});
