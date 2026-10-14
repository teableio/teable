/* eslint-disable @typescript-eslint/naming-convention */
import {
  ComputedFieldUpdater,
  type ComputedUpdatePlan,
} from '@teable/v2-adapter-table-repository-postgres';
import { sql } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import {
  createConvergenceHarness,
  executionProfiles,
  type ConvergenceHarness,
  type ConvergenceTable,
} from './shared/computedConvergence';

/**
 * teableio/teable#3663: inserting an order reaches its customer through the customer's
 * order list, and the customer fans back out to every pre-existing order of that customer.
 * Those sibling orders are pruned before any step runs, so nothing linked to them may be
 * dirtied either — while siblings that really depend on the customer still converge.
 */
const setupCustomerOrders = async (h: ConvergenceHarness, withCounts: boolean) => {
  const { fieldId } = h;
  const f = {
    customerName: fieldId(),
    customerOrders: fieldId(),
    customerCount: fieldId(),
    orderTitle: fieldId(),
    orderCustomer: fieldId(),
    orderCustomerCount: fieldId(),
    shipmentName: fieldId(),
    shipmentOrder: fieldId(),
    shipmentCustomerCount: fieldId(),
  };
  const customers = await h.createTable('Customers', [
    { id: f.customerName, name: 'Name', type: 'singleLineText', isPrimary: true },
  ]);
  const orders = await h.createTable('Orders', [
    { id: f.orderTitle, name: 'Title', type: 'singleLineText', isPrimary: true },
  ]);
  await h.createField(orders, {
    id: f.orderCustomer,
    name: 'Customer',
    type: 'link',
    options: {
      relationship: 'manyOne',
      foreignTableId: customers.id,
      lookupFieldId: f.customerName,
      symmetricFieldId: f.customerOrders,
    },
  });
  if (withCounts) {
    await h.createField(customers, {
      id: f.customerCount,
      name: 'Order count',
      type: 'rollup',
      options: { expression: 'countall({values})' },
      config: {
        linkFieldId: f.customerOrders,
        foreignTableId: orders.id,
        lookupFieldId: f.orderTitle,
      },
    });
    await h.createField(orders, {
      id: f.orderCustomerCount,
      name: 'Customer order count',
      type: 'lookup',
      options: {
        linkFieldId: f.orderCustomer,
        foreignTableId: customers.id,
        lookupFieldId: f.customerCount,
      },
    });
  }
  const shipments = await h.createTable('Shipments', [
    { id: f.shipmentName, name: 'Name', type: 'singleLineText', isPrimary: true },
  ]);
  await h.createField(shipments, {
    id: f.shipmentOrder,
    name: 'Order',
    type: 'link',
    options: {
      relationship: 'manyOne',
      foreignTableId: orders.id,
      lookupFieldId: f.orderTitle,
      isOneWay: true,
    },
  });
  if (withCounts) {
    await h.createField(shipments, {
      id: f.shipmentCustomerCount,
      name: 'Customer order count',
      type: 'lookup',
      options: {
        linkFieldId: f.shipmentOrder,
        foreignTableId: orders.id,
        lookupFieldId: f.orderCustomerCount,
      },
    });
  }

  const customerIds = [
    await h.createRecord(customers, { [f.customerName]: 'C0' }),
    await h.createRecord(customers, { [f.customerName]: 'C1' }),
  ];
  // C0 owns O0-O2, C1 owns O3-O4; S0-S3 ship O0-O3.
  const orderIds: string[] = [];
  for (const [index, owner] of [0, 0, 0, 1, 1].entries()) {
    orderIds.push(
      await h.createRecord(orders, {
        [f.orderTitle]: `O${index}`,
        [f.orderCustomer]: { id: customerIds[owner] },
      })
    );
  }
  const shipmentIds: string[] = [];
  for (const index of [0, 1, 2, 3]) {
    shipmentIds.push(
      await h.createRecord(shipments, {
        [f.shipmentName]: `S${index}`,
        [f.shipmentOrder]: { id: orderIds[index] },
      })
    );
  }
  await h.drain();
  return { f, customers, orders, shipments, customerIds, orderIds, shipmentIds };
};

const readStored = async (
  h: ConvergenceHarness,
  table: ConvergenceTable,
  fieldId: string
): Promise<Record<string, unknown>> => {
  const meta = await sql<{
    db_table_name: string;
  }>`SELECT db_table_name FROM table_meta WHERE id = ${table.id}`.execute(h.testContainer.db);
  const field = await sql<{
    db_field_name: string;
  }>`SELECT db_field_name FROM field WHERE id = ${fieldId}`.execute(h.testContainer.db);
  const rows = await sql<{ __id: string; value: unknown }>`SELECT __id, ${sql.ref(
    field.rows[0].db_field_name
  )} AS value FROM ${sql.table(meta.rows[0].db_table_name)} ORDER BY __id`.execute(
    h.testContainer.db
  );
  return Object.fromEntries(rows.rows.map((row) => [row.__id, row.value]));
};

const numbersIn = (value: unknown): number[] =>
  (JSON.stringify(value ?? null).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

/** Rows any INSERT stage inside `run` marked dirty, by table id. */
const insertStageDirtyRows = async (
  run: () => Promise<void>
): Promise<Map<string, Set<string>>> => {
  const dirty = new Map<string, Set<string>>();
  const prepareDirtyState = ComputedFieldUpdater.prototype.prepareDirtyState;
  const spy = vi
    .spyOn(ComputedFieldUpdater.prototype, 'prepareDirtyState')
    .mockImplementation(async function (
      this: ComputedFieldUpdater,
      ...args: Parameters<ComputedFieldUpdater['prepareDirtyState']>
    ) {
      const prepared = await prepareDirtyState.apply(this, args);
      if ((args[0] as ComputedUpdatePlan).changeType === 'insert' && prepared.isOk()) {
        const rows = await sql<{
          table_id: string;
          record_id: string;
        }>`SELECT table_id, record_id FROM tmp_computed_dirty`.execute(prepared.value.db);
        for (const { table_id, record_id } of rows.rows) {
          const ids = dirty.get(table_id) ?? new Set<string>();
          ids.add(record_id);
          dirty.set(table_id, ids);
        }
      }
      return prepared;
    });
  try {
    await run();
    return dirty;
  } finally {
    spy.mockRestore();
  }
};

describe.each([
  ...executionProfiles,
  {
    name: 'hybrid-threshold',
    config: {
      mode: 'hybrid' as const,
      hybridConfig: {
        dispatchMode: 'external' as const,
        syncPolicy: 'threshold' as const,
        syncMaxLevelHardCap: 0,
      },
    },
  },
])('insert sibling propagation / $name', (profile) => {
  it('does not dirty rows linked to the siblings of an inserted row', async () => {
    const h = await createConvergenceHarness(profile);
    try {
      const s = await setupCustomerOrders(h, false);
      const shipmentsBefore = await readStored(h, s.shipments, s.f.shipmentOrder);

      let insertedId = '';
      const dirty = await insertStageDirtyRows(async () => {
        insertedId = await h.createRecord(s.orders, {
          [s.f.orderTitle]: 'O-new',
          [s.f.orderCustomer]: { id: s.customerIds[0] },
        });
        await h.drain();
      });

      expect([...(dirty.get(s.shipments.id) ?? [])]).toEqual([]);
      expect([...(dirty.get(s.orders.id) ?? [])]).toEqual([insertedId]);
      const customerOrders = await readStored(h, s.customers, s.f.customerOrders);
      expect(JSON.stringify(customerOrders[s.customerIds[0]])).toContain(insertedId);
      expect(await readStored(h, s.shipments, s.f.shipmentOrder)).toEqual(shipmentsBefore);
    } finally {
      await h.close();
    }
  }, 120_000);

  it('still refreshes siblings whose values depend on the shared record', async () => {
    const h = await createConvergenceHarness(profile);
    try {
      const s = await setupCustomerOrders(h, true);
      const insertedId = await h.createRecord(s.orders, {
        [s.f.orderTitle]: 'O-new',
        [s.f.orderCustomer]: { id: s.customerIds[0] },
      });
      await h.drain();

      const customerCount = await readStored(h, s.customers, s.f.customerCount);
      expect(numbersIn(customerCount[s.customerIds[0]])).toEqual([4]);
      expect(numbersIn(customerCount[s.customerIds[1]])).toEqual([2]);

      const orderCounts = await readStored(h, s.orders, s.f.orderCustomerCount);
      for (const id of [...s.orderIds.slice(0, 3), insertedId]) {
        expect(numbersIn(orderCounts[id]), `order ${id}`).toEqual([4]);
      }
      for (const id of s.orderIds.slice(3)) {
        expect(numbersIn(orderCounts[id]), `order ${id}`).toEqual([2]);
      }

      const shipmentCounts = await readStored(h, s.shipments, s.f.shipmentCustomerCount);
      for (const [index, id] of s.shipmentIds.entries()) {
        expect(numbersIn(shipmentCounts[id]), `shipment S${index}`).toEqual([index < 3 ? 4 : 2]);
      }
    } finally {
      await h.close();
    }
  }, 120_000);
});

it('propagates changes from the synchronous threshold prefix to deferred shipments', async () => {
  const h = await createConvergenceHarness({
    name: 'hybrid-threshold',
    config: {
      mode: 'hybrid',
      hybridConfig: {
        dispatchMode: 'external',
        syncPolicy: 'threshold',
        syncMaxLevelHardCap: 0,
      },
      outboxConfig: { stageMaxDirtyRecords: 0 },
    },
  });
  try {
    const s = await setupCustomerOrders(h, true);
    const relatedOrder = h.fieldId();
    await h.createField(s.orders, {
      id: relatedOrder,
      name: 'Related order',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: s.orders.id,
        lookupFieldId: s.f.orderTitle,
        isOneWay: true,
      },
    });
    await h.createField(s.orders, {
      id: h.fieldId(),
      name: 'Related title',
      type: 'lookup',
      options: {
        linkFieldId: relatedOrder,
        foreignTableId: s.orders.id,
        lookupFieldId: s.f.orderTitle,
      },
    });
    await h.drain();

    const insertedId = await h.createRecord(s.orders, {
      [s.f.orderTitle]: 'O-new',
      [s.f.orderCustomer]: { id: s.customerIds[0] },
      [relatedOrder]: { id: s.orderIds[0] },
    });
    // The prefix has already changed the sources removed from the worker plan.
    const orderCounts = await readStored(h, s.orders, s.f.orderCustomerCount);
    for (const id of [...s.orderIds.slice(0, 3), insertedId]) {
      expect(numbersIn(orderCounts[id])).toEqual([4]);
    }
    const beforeDrain = await readStored(h, s.shipments, s.f.shipmentCustomerCount);
    expect(numbersIn(beforeDrain[s.shipmentIds[0]])).toEqual([3]);
    await h.drain();

    const shipmentCounts = await readStored(h, s.shipments, s.f.shipmentCustomerCount);
    for (const [index, id] of s.shipmentIds.entries()) {
      expect(numbersIn(shipmentCounts[id]), `shipment S${index}`).toEqual([index < 3 ? 4 : 2]);
    }
  } finally {
    await h.close();
  }
}, 120_000);
