/* eslint-disable @typescript-eslint/naming-convention */
import {
  createBaseOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

/**
 * Anonymized reproduction of a production dead-letter scenario (T6777):
 * an imports table's conditional lookup pulls a multi-value user field from an
 * orders table, matching on plain text order numbers (field-reference `is`)
 * AND-ed with an `isNotEmpty` residual on the source user field. The residual
 * used to force the per-host correlated lateral that timed out on large
 * sources; it must now ride the set-based path with identical semantics for
 * both backfill and dirty-record propagation.
 *
 * The production topology is cross-base (orders live in a different base than
 * the imports table); both tests mirror it. Propagation from a source-only
 * base additionally guards the cross-base dependent probe (T6778): a base
 * with no computed fields of its own must still trigger recomputation of
 * conditional fields it feeds in other bases.
 */
describe('create-field: conditionalLookup user isNotEmpty residual', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;
  let fieldIdCounter = 0;

  const reviewerA = { id: 'usrClxbNotEmptyRevA', title: 'Reviewer A' };
  const reviewerB = { id: 'usrClxbNotEmptyRevB', title: 'Reviewer B' };

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;
  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createBase = async (name: string) => {
    const response = await fetch(`${ctx.baseUrl}/bases/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, spaceId: 'space_test' }),
    });
    const rawBody = await response.json();
    if (response.status !== 201) {
      throw new Error(`CreateBase failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createBaseOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`CreateBase parse failed: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.base.id;
  };

  const deleteTableWithBaseId = async (baseId: string, tableId: string) => {
    const response = await fetch(`${ctx.baseUrl}/tables/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId, tableId, mode: 'permanent' }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete table ${tableId} in base ${baseId}: ${errorText}`);
    }
  };

  const listRecordsWithBaseId = async (targetBaseId: string, tableId: string) => {
    const response = await fetch(
      `${ctx.baseUrl}/tables/listRecords?baseId=${targetBaseId}&tableId=${tableId}`,
      { method: 'GET' }
    );
    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`ListRecords failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`ListRecords parse failed: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.records;
  };

  const updateRecordWithBaseId = async (
    targetBaseId: string,
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId: targetBaseId, tableId, recordId, fields }),
    });
    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`UpdateRecord failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to update record: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.record;
  };

  const createOrdersTable = async (
    baseId: string,
    orderNoFieldId: string,
    reviewersFieldId: string
  ) =>
    ctx.createTable({
      baseId,
      name: nextName('v2-cl-not-empty-orders'),
      fields: [
        { type: 'singleLineText', id: orderNoFieldId, name: 'Order No', isPrimary: true },
        {
          type: 'user',
          id: reviewersFieldId,
          name: 'Reviewers',
          options: { isMultiple: true, shouldNotify: false },
        },
      ],
      records: [
        { fields: { [orderNoFieldId]: 'ORD-001', [reviewersFieldId]: [reviewerA] } },
        // Same order number but no reviewers: the isNotEmpty residual must
        // exclude this row from ORD-001's aggregate.
        { fields: { [orderNoFieldId]: 'ORD-001' } },
        { fields: { [orderNoFieldId]: 'ORD-002' } },
        { fields: { [orderNoFieldId]: 'ORD-003', [reviewersFieldId]: [reviewerA, reviewerB] } },
      ],
    });

  const createImportsTable = async (orderRefFieldId: string) =>
    ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v2-cl-not-empty-imports'),
      fields: [{ type: 'singleLineText', id: orderRefFieldId, name: 'Order Ref' }],
      records: [
        { fields: { [orderRefFieldId]: 'ORD-001' } },
        { fields: { [orderRefFieldId]: 'ORD-002' } },
        { fields: { [orderRefFieldId]: 'ORD-003' } },
        { fields: { [orderRefFieldId]: 'ORD-404' } },
      ],
    });

  const createReviewersLookupField = async (params: {
    hostTableId: string;
    lookupFieldId: string;
    ordersTableId: string;
    orderNoFieldId: string;
    reviewersFieldId: string;
    orderRefFieldId: string;
  }) =>
    ctx.createField({
      baseId: ctx.baseId,
      tableId: params.hostTableId,
      field: {
        type: 'conditionalLookup',
        id: params.lookupFieldId,
        name: 'Order Reviewers',
        options: {
          foreignTableId: params.ordersTableId,
          lookupFieldId: params.reviewersFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: params.orderNoFieldId,
                  operator: 'is',
                  value: params.orderRefFieldId,
                  isSymbol: true,
                },
                { fieldId: params.reviewersFieldId, operator: 'isNotEmpty', value: null },
              ],
            },
          },
        },
      },
    });

  const lookupByRef = async (
    hostTableId: string,
    orderRefFieldId: string,
    lookupFieldId: string
  ) => {
    const records = await ctx.listRecords(hostTableId);
    return new Map(
      records.map((record) => [record.fields[orderRefFieldId], record.fields[lookupFieldId]])
    );
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    for (const reviewer of [reviewerA, reviewerB]) {
      await sql`
        insert into users (id, name, email)
        values (
          ${reviewer.id},
          ${reviewer.title},
          ${`${reviewer.id.toLowerCase()}@e2e.com`}
        )
        on conflict (id) do nothing
      `.execute(ctx.testContainer.db);
    }
  });

  it('backfills a cross-base user lookup gated by isNotEmpty', async () => {
    let hostTableId: string | undefined;
    let ordersBaseId: string | undefined;
    let ordersTableId: string | undefined;

    try {
      ordersBaseId = await createBase(nextName('v2-cl-not-empty-orders-base'));

      const orderNoFieldId = createFieldId();
      const reviewersFieldId = createFieldId();
      const ordersTable = await createOrdersTable(ordersBaseId, orderNoFieldId, reviewersFieldId);
      ordersTableId = ordersTable.id;

      const orderRefFieldId = createFieldId();
      const hostTable = await createImportsTable(orderRefFieldId);
      hostTableId = hostTable.id;

      const lookupFieldId = createFieldId();
      await createReviewersLookupField({
        hostTableId: hostTable.id,
        lookupFieldId,
        ordersTableId: ordersTable.id,
        orderNoFieldId,
        reviewersFieldId,
        orderRefFieldId,
      });

      await ctx.drainOutbox();

      const backfilled = await lookupByRef(hostTable.id, orderRefFieldId, lookupFieldId);
      expect(backfilled.get('ORD-001')).toMatchObject([{ id: reviewerA.id }]);
      expect(backfilled.get('ORD-002') ?? null).toBeNull();
      expect(backfilled.get('ORD-003')).toMatchObject([{ id: reviewerA.id }, { id: reviewerB.id }]);
      expect(backfilled.get('ORD-404') ?? null).toBeNull();
    } finally {
      await ctx.drainOutbox().catch(() => undefined);
      if (hostTableId) {
        await ctx.deleteTable(hostTableId).catch(() => undefined);
      }
      if (ordersBaseId && ordersTableId) {
        await deleteTableWithBaseId(ordersBaseId, ordersTableId).catch(() => undefined);
      }
    }
  });

  it('propagates cross-base source-record updates across the isNotEmpty gate', async () => {
    let hostTableId: string | undefined;
    let ordersBaseId: string | undefined;
    let ordersTableId: string | undefined;

    try {
      ordersBaseId = await createBase(nextName('v2-cl-not-empty-orders-base'));

      const orderNoFieldId = createFieldId();
      const reviewersFieldId = createFieldId();
      const ordersTable = await createOrdersTable(ordersBaseId, orderNoFieldId, reviewersFieldId);
      ordersTableId = ordersTable.id;

      const orderRefFieldId = createFieldId();
      const hostTable = await createImportsTable(orderRefFieldId);
      hostTableId = hostTable.id;

      const lookupFieldId = createFieldId();
      await createReviewersLookupField({
        hostTableId: hostTable.id,
        lookupFieldId,
        ordersTableId: ordersTable.id,
        orderNoFieldId,
        reviewersFieldId,
        orderRefFieldId,
      });

      await ctx.drainOutbox();

      const orderRecords = await listRecordsWithBaseId(ordersBaseId, ordersTable.id);
      const orderRecordId = (orderNo: string, withReviewers: boolean) => {
        const match = orderRecords.find(
          (record) =>
            record.fields[orderNoFieldId] === orderNo &&
            Boolean(record.fields[reviewersFieldId]) === withReviewers
        );
        if (!match) throw new Error(`Seed record not found for ${orderNo}`);
        return match.id;
      };

      // Both directions across the isNotEmpty gate: ORD-002 gains a reviewer,
      // ORD-001's only reviewed row loses them.
      await updateRecordWithBaseId(ordersBaseId, ordersTable.id, orderRecordId('ORD-002', false), {
        [reviewersFieldId]: [reviewerB],
      });
      await updateRecordWithBaseId(ordersBaseId, ordersTable.id, orderRecordId('ORD-001', true), {
        [reviewersFieldId]: null,
      });

      await ctx.drainOutbox();

      const propagated = await lookupByRef(hostTable.id, orderRefFieldId, lookupFieldId);
      expect(propagated.get('ORD-002')).toMatchObject([{ id: reviewerB.id }]);
      expect(propagated.get('ORD-001') ?? null).toBeNull();
      expect(propagated.get('ORD-003')).toMatchObject([{ id: reviewerA.id }, { id: reviewerB.id }]);
    } finally {
      await ctx.drainOutbox().catch(() => undefined);
      if (hostTableId) {
        await ctx.deleteTable(hostTableId).catch(() => undefined);
      }
      if (ordersBaseId && ordersTableId) {
        await deleteTableWithBaseId(ordersBaseId, ordersTableId).catch(() => undefined);
      }
    }
  });
});
