/**
 * A12 / A11 — statistics converge and multi-value statistics are defined.
 *
 * A12 (建议需求): after a write, a delete, an undo or a filter change the
 * statistic and its group buckets must end up consistent with the stored rows.
 * A11 (待定口径): the document asks whether multi-value statistics count records
 * or elements. v2 answer: `count`/`filled`/`empty` are per record, while
 * `unique` flattens the elements of every record.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  AggregateTableRecordsQuery,
  v2CoreTokens,
  type AggregateTableRecordsResult,
  type IAggregateTableRecordsQueryInput,
  type IQueryBus,
} from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldByName,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

type AggregateEntry = {
  groupValues?: ReadonlyArray<unknown>;
  value: unknown;
  fieldId: string;
  statisticFunc: string;
};

describe('A11/A12: multi-value statistics and convergence', () => {
  let ctx: SharedTestContext;
  let queryBus: IQueryBus;
  let tableId: string;
  let tagsId: string;
  let amountId: string;
  const actorId = ActorId.create('usrTestUserId')._unsafeUnwrap();

  const aggregate = async (
    input: IAggregateTableRecordsQueryInput
  ): Promise<AggregateTableRecordsResult> => {
    const query = AggregateTableRecordsQuery.create(input);
    if (query.isErr()) throw new Error(`Invalid aggregate input: ${query.error.message}`);
    const result = await queryBus.execute<AggregateTableRecordsQuery, AggregateTableRecordsResult>(
      { actorId, windowId: 'e2e-window' },
      query.value
    );
    if (result.isErr()) throw new Error(`Aggregate failed: ${result.error.message}`);
    return result.value;
  };

  const statistic = async (fieldId: string, statisticFunc: string) => {
    const result = await aggregate({ tableId, fields: [{ fieldId, statisticFunc }] });
    const entry = (result.values as unknown as AggregateEntry[]).find(
      (candidate) =>
        String(candidate.fieldId) === fieldId && candidate.statisticFunc === statisticFunc
    );
    return entry?.value;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    queryBus = ctx.testContainer.container.resolve(v2CoreTokens.queryBus);
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'A11 Multi-value Statistics',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'multipleSelect',
          name: 'Tags',
          options: { choices: [{ name: 'red' }, { name: 'blue' }, { name: 'green' }] },
        },
        { type: 'number', name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    tagsId = fieldByName(table, 'Tags').id;
    amountId = fieldByName(table, 'Amount').id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  it('A11 counts records, not elements, for count/filled/empty', async () => {
    await ctx.createRecords(tableId, [
      { fields: { [tagsId]: ['red', 'blue'], [amountId]: 1 } },
      { fields: { [tagsId]: ['red'], [amountId]: 2 } },
      { fields: { [amountId]: 3 } },
    ]);
    await ctx.drainOutbox();

    await expect(statistic(tagsId, 'count')).resolves.toBe(3);
    await expect(statistic(tagsId, 'filled')).resolves.toBe(2);
    await expect(statistic(tagsId, 'empty')).resolves.toBe(1);
  });

  it('A11 flattens elements for unique', async () => {
    // Three elements across two records, but only two distinct values.
    await expect(statistic(tagsId, 'unique')).resolves.toBe(2);
  });

  it('A11 sums numeric values per record, not per element', async () => {
    await expect(statistic(amountId, 'sum')).resolves.toBe(6);
    await expect(statistic(amountId, 'count')).resolves.toBe(3);
  });

  it('A12 a new write is reflected in the statistic', async () => {
    const beforeSum = Number(await statistic(amountId, 'sum'));
    const record = await ctx.createRecord(tableId, { [amountId]: 10 });
    await ctx.drainOutbox();

    await expect(statistic(amountId, 'sum')).resolves.toBe(beforeSum + 10);

    // ...and deleting that row takes the contribution back out.
    await ctx.deleteRecord(tableId, record.id);
    await ctx.drainOutbox();
    await expect(statistic(amountId, 'sum')).resolves.toBe(beforeSum);
  });

  it('A12 an in-place update replaces the previous contribution', async () => {
    const record = await ctx.createRecord(tableId, { [amountId]: 100 });
    await ctx.drainOutbox();
    const withRecord = Number(await statistic(amountId, 'sum'));

    await ctx.updateRecord(tableId, record.id, { [amountId]: 7 });
    await ctx.drainOutbox();

    await expect(statistic(amountId, 'sum')).resolves.toBe(withRecord - 93);

    await ctx.deleteRecord(tableId, record.id);
    await ctx.drainOutbox();
  });

  it('A12 group buckets stay consistent with the flat total after changes', async () => {
    const groupTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'A12 Groups',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Group',
          options: { choices: [{ name: 'g1' }, { name: 'g2' }] },
        },
        { type: 'number', name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    });
    const groupId = fieldByName(groupTable, 'Group').id;
    const groupAmountId = fieldByName(groupTable, 'Amount').id;

    const records = await ctx.createRecords(groupTable.id, [
      { fields: { [groupId]: 'g1', [groupAmountId]: 1 } },
      { fields: { [groupId]: 'g1', [groupAmountId]: 2 } },
      { fields: { [groupId]: 'g2', [groupAmountId]: 4 } },
    ]);
    await ctx.drainOutbox();

    const readBoth = async () => {
      const flat = await aggregate({
        tableId: groupTable.id,
        fields: [{ fieldId: groupAmountId, statisticFunc: 'sum' }],
      });
      const grouped = await aggregate({
        tableId: groupTable.id,
        fields: [{ fieldId: groupAmountId, statisticFunc: 'sum' }],
        groupBy: [{ fieldId: groupId, order: 'asc' }],
      });
      const entries = grouped.values as unknown as AggregateEntry[];
      const buckets = new Map(
        entries
          .filter((entry) => entry.groupValues !== undefined)
          .map((entry) => [entry.groupValues?.[0], Number(entry.value)] as const)
      );
      const total = Number(
        (flat.values as unknown as AggregateEntry[]).find((e) => e.groupValues === undefined)?.value
      );
      return { total, buckets };
    };

    const initial = await readBoth();
    expect(initial.total).toBe(7);
    expect(initial.buckets.get('g1')).toBe(3);
    expect(initial.buckets.get('g2')).toBe(4);

    // Move a record between groups: the total must not move, both buckets must.
    await ctx.updateRecord(groupTable.id, records[0].id, { [groupId]: 'g2' });
    await ctx.drainOutbox();

    const moved = await readBoth();
    expect(moved.total).toBe(initial.total);
    expect(moved.buckets.get('g1')).toBe(2);
    expect(moved.buckets.get('g2')).toBe(5);

    // And the group sums must still add up to the flat total.
    const bucketSum = [...moved.buckets.values()].reduce((sum, value) => sum + value, 0);
    expect(bucketSum).toBe(moved.total);

    await ctx.deleteTable(groupTable.id);
  });
});
