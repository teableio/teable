/* eslint-disable @typescript-eslint/naming-convention */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/** T7180: account lookup array -> numeric order key + status -> summed amount. */
describe('conditional rollup over numeric account lookup membership (T7180)', () => {
  let ctx: SharedTestContext;
  const tables: string[] = [];
  let nextId = 0;
  const id = () => `fld${(nextId++).toString(36).padStart(16, '0')}`;
  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });
  afterAll(async () => {
    for (const table of tables.reverse()) await ctx.deleteTable(table);
  });

  it.each([
    { precision: 1, hostKey: 42, sourceKey: 42 },
    { precision: 0, hostKey: 1.23456789012346, sourceKey: 1.2345678901234567 },
  ])(
    'counts orders once and recomputes with extra_float_digits=$precision',
    async ({ precision, hostKey, sourceKey }) => {
      await sql`SELECT set_config('extra_float_digits', ${String(precision)}, false)`.execute(
        ctx.testContainer.db
      );
      const accountName = id(),
        accountKey = id();
      const accounts = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'T7180 Accounts',
        fields: [
          { id: accountName, type: 'singleLineText', name: 'Name', isPrimary: true },
          { id: accountKey, type: 'number', name: 'AccountKey' },
        ],
        views: [{ type: 'grid' }],
      });
      tables.push(accounts.id);
      const orderName = id(),
        orderKey = id(),
        amount = id(),
        status = id();
      const orders = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'T7180 Orders',
        fields: [
          { id: orderName, type: 'singleLineText', name: 'Name', isPrimary: true },
          { id: orderKey, type: 'number', name: 'AccountKey' },
          { id: amount, type: 'number', name: 'Amount' },
          { id: status, type: 'singleLineText', name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });
      tables.push(orders.id);
      const hostName = id(),
        accountLink = id(),
        keys = id(),
        total = id();
      const hosts = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'T7180 Partners',
        fields: [
          { id: hostName, type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            id: accountLink,
            type: 'link',
            name: 'Accounts',
            options: {
              relationship: 'manyMany',
              foreignTableId: accounts.id,
              lookupFieldId: accountName,
            },
          },
          {
            id: keys,
            type: 'lookup',
            name: 'AccountKeys',
            options: {
              linkFieldId: accountLink,
              foreignTableId: accounts.id,
              lookupFieldId: accountKey,
            },
          },
          {
            id: total,
            type: 'conditionalRollup',
            name: 'ApprovedAmount',
            options: { expression: 'sum({values})' },
            config: {
              foreignTableId: orders.id,
              lookupFieldId: amount,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    { fieldId: orderKey, operator: 'is', isSymbol: true, value: keys },
                    { fieldId: status, operator: 'is', value: 'approved' },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tables.push(hosts.id);
      const a = await ctx.createRecord(accounts.id, { [accountName]: 'A', [accountKey]: hostKey });
      const duplicate = await ctx.createRecord(accounts.id, {
        [accountName]: 'Duplicate A',
        [accountKey]: hostKey,
      });
      const blank = await ctx.createRecord(accounts.id, { [accountName]: 'Blank' });
      const partner = await ctx.createRecord(hosts.id, {
        [hostName]: 'Partner',
        [accountLink]: [{ id: a.id }, { id: duplicate.id }, { id: blank.id }],
      });
      const empty = await ctx.createRecord(hosts.id, { [hostName]: 'Empty' });
      const first = await ctx.createRecord(orders.id, {
        [orderName]: 'One',
        [orderKey]: sourceKey,
        [amount]: 10,
        [status]: 'approved',
      });
      await ctx.createRecord(orders.id, {
        [orderName]: 'Two',
        [orderKey]: sourceKey,
        [amount]: 20,
        [status]: 'approved',
      });
      await ctx.createRecord(orders.id, {
        [orderName]: 'Rejected',
        [orderKey]: sourceKey,
        [amount]: 100,
        [status]: 'rejected',
      });
      await ctx.createRecord(orders.id, {
        [orderName]: 'Other',
        [orderKey]: 43,
        [amount]: 1000,
        [status]: 'approved',
      });
      await ctx.createRecord(orders.id, {
        [orderName]: 'Missing key',
        [amount]: 2000,
        [status]: 'approved',
      });
      const expectTotals = async (expected: number) => {
        await ctx.drainOutbox();
        const records = await ctx.listRecords(hosts.id);
        expect(records.find((r) => r.id === partner.id)?.fields[total]).toBe(expected);
        expect(Number(records.find((r) => r.id === empty.id)?.fields[total] ?? 0)).toBe(0);
      };
      await expectTotals(30);
      ctx.testContainer.clearLogs();
      await ctx.updateRecord(orders.id, first.id, { [amount]: 15 });
      await expectTotals(35);
      // Inspect the SQL actually executed by the API-triggered computed update,
      // not a separately reconstructed query that could miss the product route.
      const computedSql = ctx.testContainer.spyLogger
        .getEntriesByMessage('computed:update:')
        .map((entry) => entry.message)
        .filter((message) => message.includes('jsonb_array_elements_text'));
      expect(computedSql.length).toBeGreaterThan(0);
      expect(
        computedSql.every((statement) => statement.includes('array_remove(ARRAY(SELECT'))
      ).toBe(true);
      expect(computedSql.every((statement) => statement.includes('union all'))).toBe(true);
      expect(
        computedSql.every((statement) =>
          statement.includes("current_setting('extra_float_digits')::integer > 0")
        )
      ).toBe(true);
      expect(
        computedSql.every((statement) =>
          statement.includes("current_setting('extra_float_digits')::integer <= 0")
        )
      ).toBe(true);
      await sql`SET extra_float_digits = 1`.execute(ctx.testContainer.db);
    }
  );
});
