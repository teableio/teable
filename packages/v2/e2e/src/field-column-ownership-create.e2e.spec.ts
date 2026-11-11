import {
  apiErrorResponseDtoSchema,
  createFieldOkResponseSchema,
  type ITableDto,
} from '@teable/v2-contract-http';
import {
  FieldOperationKind,
  ok,
  v2CoreTokens,
  type ICreateFieldCommandInput,
  type IFieldOperationPlugin,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * T8446: two source links generate reciprocal fields from the same source-table
 * name. Overlap their real HTTP requests after metadata loading, without changing
 * names, snapshots, persistence, or PostgreSQL's locking behavior. A precise
 * optimistic conflict is safe only if neither endpoint leaves a partial field.
 * The caller then explicitly retries that rejected creation with fresh metadata.
 */
const installCreationBarrier = (ctx: SharedTestContext, tableId: string) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  const candidates = new Map<string, string>();
  const plugin: IFieldOperationPlugin = {
    name: `field-column-ownership-${tableId}`,
    supports: (kind) => kind === FieldOperationKind.create,
    guard: async (context) => {
      if (context.kind !== FieldOperationKind.create) return ok(undefined);
      if (context.table.id().toString() !== tableId) return ok(undefined);
      const requestId = context.executionContext.requestId;
      if (!requestId) return ok(undefined);
      const candidate = context.payload.candidateField;
      if (!candidate) return ok(undefined);
      candidates.set(requestId, candidate.id().toString());
      await promise;
      return ok(undefined);
    },
  };
  const plugins = ctx.testContainer.container.resolve<IFieldOperationPlugin[]>(
    v2CoreTokens.fieldOperationPlugins
  );
  plugins.push(plugin);
  return {
    candidates,
    release: resolve,
    remove: () => {
      resolve();
      const index = plugins.indexOf(plugin);
      if (index >= 0) plugins.splice(index, 1);
    },
  };
};

const countSchemaWaiters = async (ctx: SharedTestContext): Promise<number> => {
  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM pg_locks locks
    JOIN pg_stat_activity activity ON activity.pid = locks.pid
    WHERE locks.locktype = 'advisory'
      AND NOT locks.granted
      AND activity.datname = current_database()
      AND activity.application_name = 'teable-v2-schema-coordination'
  `.execute(ctx.testContainer.db);
  return Number(result.rows[0]?.count ?? 0);
};

const readPhysicalColumns = async (ctx: SharedTestContext, tableId: string) => {
  const result = await sql<{ column_name: string }>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ${ctx.baseId} AND table_name = ${tableId}
  `.execute(ctx.testContainer.db);
  return result.rows.map((row) => row.column_name);
};

const expectUniqueColumnOwners = async (ctx: SharedTestContext, table: ITableDto) => {
  const rows = await ctx.testContainer.db
    .selectFrom('field')
    .select(['id', 'db_field_name'])
    .where('table_id', '=', table.id)
    .where('deleted_time', 'is', null)
    .execute();
  expect(rows.map((row) => row.id).sort()).toEqual(table.fields.map((field) => field.id).sort());
  const names = rows.map((row) => row.db_field_name);
  expect(names.every((name) => typeof name === 'string' && name.length > 0)).toBe(true);
  expect(new Set(names).size, `Physical column owners in ${table.name}`).toBe(rows.length);
  const physicalColumns = await readPhysicalColumns(ctx, table.id);
  expect(physicalColumns).toEqual(expect.arrayContaining(names));
};

describe('[T8446] concurrent field column ownership (e2e, postgres)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
  }, 120_000);

  it('keeps concurrent symmetric fields isolated, including conflict rollback and explicit retry', async () => {
    const owners = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Owners',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const items = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Items',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const ownerNameField = owners.fields.find((field) => field.isPrimary)!;
    const itemNameField = items.fields.find((field) => field.isPrimary)!;
    const attempts = ['Primary owner', 'Secondary owner'].map((name) => ({
      name,
      requestId: `${items.id}-${name}`,
      payload: {
        baseId: ctx.baseId,
        tableId: items.id,
        field: {
          type: 'link',
          name,
          options: {
            relationship: 'manyOne',
            foreignTableId: owners.id,
            lookupFieldId: ownerNameField.id,
            isOneWay: false,
          },
        },
      } satisfies ICreateFieldCommandInput,
    }));
    const barrier = installCreationBarrier(ctx, items.id);
    let settledRequests = 0;
    const pending = attempts.map((attempt) =>
      fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': attempt.requestId },
        body: JSON.stringify(attempt.payload),
      }).then((response) => {
        settledRequests += 1;
        return response;
      })
    );
    let responses: Response[];
    try {
      await vi.waitFor(
        async () => {
          if (barrier.candidates.size === 2 || settledRequests > 0) return;
          // An implementation that leases before loading metadata must be allowed
          // to serialize instead of deadlocking at this test-only rendezvous.
          expect(await countSchemaWaiters(ctx)).toBeGreaterThan(0);
        },
        { timeout: 10_000, interval: 25 }
      );
      barrier.release();
      responses = await Promise.all(pending);
    } finally {
      barrier.remove();
      await Promise.allSettled(pending);
    }
    expect(barrier.candidates.size).toBe(2);

    const succeeded: typeof attempts = [];
    const conflicted: typeof attempts = [];
    for (const [index, response] of responses.entries()) {
      const attempt = attempts[index]!;
      const body: unknown = await response.json();
      if (response.ok) {
        const table = createFieldOkResponseSchema.parse(body).data.table;
        expect(table.fields.some((field) => field.name === attempt.name)).toBe(true);
        succeeded.push(attempt);
      } else {
        // The current v2 HTTP contract maps generic domain conflicts to 400.
        expect(response.status, JSON.stringify(body)).toBe(400);
        expect(apiErrorResponseDtoSchema.parse(body).error.code).toBe('view.version_conflict');
        conflicted.push(attempt);
      }
    }
    expect(succeeded.length).toBeGreaterThan(0);

    const itemsBeforeRetry = await ctx.getTableById(items.id);
    const ownersBeforeRetry = await ctx.getTableById(owners.id);
    const sourceLinks = itemsBeforeRetry.fields.filter((field) => field.type === 'link');
    const reciprocalLinks = ownersBeforeRetry.fields.filter((field) => field.type === 'link');
    expect(sourceLinks.map((field) => field.name).sort()).toEqual(
      succeeded.map((attempt) => attempt.name).sort()
    );
    expect(reciprocalLinks).toHaveLength(succeeded.length);
    expect(reciprocalLinks.map((field) => field.options.symmetricFieldId).sort()).toEqual(
      sourceLinks.map((field) => field.id).sort()
    );
    await expectUniqueColumnOwners(ctx, itemsBeforeRetry);
    await expectUniqueColumnOwners(ctx, ownersBeforeRetry);

    for (const attempt of conflicted) {
      const candidateId = barrier.candidates.get(attempt.requestId)!;
      const partialFields = await ctx.testContainer.db
        .selectFrom('field')
        .select('id')
        .where('id', '=', candidateId)
        .execute();
      expect(partialFields).toEqual([]);
      expect(
        (await readPhysicalColumns(ctx, items.id)).some((name) => name.includes(candidateId))
      ).toBe(false);
      // This is a new caller action, not an automatic retry hiding a failed write.
      await ctx.createField(attempt.payload);
    }

    const itemsAfterCreate = await ctx.getTableById(items.id);
    const ownersAfterCreate = await ctx.getTableById(owners.id);
    const primary = itemsAfterCreate.fields.find((field) => field.name === 'Primary owner');
    const secondary = itemsAfterCreate.fields.find((field) => field.name === 'Secondary owner');
    if (primary?.type !== 'link' || secondary?.type !== 'link') {
      throw new Error('Both source link fields must exist after successful creation');
    }
    const primaryReciprocal = ownersAfterCreate.fields.find(
      (field) => field.id === primary.options.symmetricFieldId
    );
    const secondaryReciprocal = ownersAfterCreate.fields.find(
      (field) => field.id === secondary.options.symmetricFieldId
    );
    if (primaryReciprocal?.type !== 'link' || secondaryReciprocal?.type !== 'link') {
      throw new Error('Both generated reciprocal link fields must exist');
    }
    expect(primaryReciprocal.options.symmetricFieldId).toBe(primary.id);
    expect(secondaryReciprocal.options.symmetricFieldId).toBe(secondary.id);
    expect(primary.options.foreignKeyName).toBeTruthy();
    expect(secondary.options.foreignKeyName).toBeTruthy();
    expect(primary.options.foreignKeyName).not.toBe(secondary.options.foreignKeyName);
    expect(primaryReciprocal.dbFieldName).not.toBe(secondaryReciprocal.dbFieldName);
    await expectUniqueColumnOwners(ctx, itemsAfterCreate);
    await expectUniqueColumnOwners(ctx, ownersAfterCreate);

    const ownerA = await ctx.createRecord(owners.id, { [ownerNameField.id]: 'Owner A' });
    const ownerB = await ctx.createRecord(owners.id, { [ownerNameField.id]: 'Owner B' });
    const itemA = await ctx.createRecord(items.id, {
      [itemNameField.id]: 'Item A',
      [primary.id]: { id: ownerA.id },
      [secondary.id]: { id: ownerB.id },
    });
    const itemB = await ctx.createRecord(items.id, {
      [itemNameField.id]: 'Item B',
      [primary.id]: { id: ownerB.id },
      [secondary.id]: { id: ownerA.id },
    });
    const sourceRecords = await ctx.listRecords(items.id);
    expect(sourceRecords.find((record) => record.id === itemA.id)?.fields).toMatchObject({
      [primary.id]: { id: ownerA.id, title: 'Owner A' },
      [secondary.id]: { id: ownerB.id, title: 'Owner B' },
    });
    expect(sourceRecords.find((record) => record.id === itemB.id)?.fields).toMatchObject({
      [primary.id]: { id: ownerB.id, title: 'Owner B' },
      [secondary.id]: { id: ownerA.id, title: 'Owner A' },
    });
    const targetRecords = await ctx.listRecords(owners.id);
    expect(targetRecords.find((record) => record.id === ownerA.id)?.fields).toMatchObject({
      [primaryReciprocal.id]: [{ id: itemA.id, title: 'Item A' }],
      [secondaryReciprocal.id]: [{ id: itemB.id, title: 'Item B' }],
    });
    expect(targetRecords.find((record) => record.id === ownerB.id)?.fields).toMatchObject({
      [primaryReciprocal.id]: [{ id: itemB.id, title: 'Item B' }],
      [secondaryReciprocal.id]: [{ id: itemA.id, title: 'Item A' }],
    });

    await ctx.deleteField({ tableId: owners.id, fieldId: primaryReciprocal.id });
    const ownersAfterDelete = await ctx.getTableById(owners.id);
    const itemsAfterDelete = await ctx.getTableById(items.id);
    expect(ownersAfterDelete.fields.map((field) => field.id)).not.toContain(primaryReciprocal.id);
    expect(itemsAfterDelete.fields.map((field) => field.id)).not.toContain(primary.id);
    expect(
      ownersAfterDelete.fields.find((field) => field.id === secondaryReciprocal.id)?.dbFieldName
    ).toBe(secondaryReciprocal.dbFieldName);
    await expectUniqueColumnOwners(ctx, ownersAfterDelete);
    await expectUniqueColumnOwners(ctx, itemsAfterDelete);
    const survivingTargets = await ctx.listRecords(owners.id);
    expect(
      survivingTargets.find((record) => record.id === ownerA.id)?.fields[secondaryReciprocal.id]
    ).toEqual([{ id: itemB.id, title: 'Item B' }]);
    expect(
      survivingTargets.find((record) => record.id === ownerB.id)?.fields[secondaryReciprocal.id]
    ).toEqual([{ id: itemA.id, title: 'Item A' }]);
    const survivingSources = await ctx.listRecords(items.id);
    expect(survivingSources.find((record) => record.id === itemA.id)?.fields[secondary.id]).toEqual(
      {
        id: ownerB.id,
        title: 'Owner B',
      }
    );
    expect(survivingSources.find((record) => record.id === itemB.id)?.fields[secondary.id]).toEqual(
      {
        id: ownerA.id,
        title: 'Owner A',
      }
    );
  }, 60_000);
});
