/**
 * A08 / A10 — statistic denominators and group-versus-total arithmetic.
 *
 * A08 (待定口径): the requirement document asks how empty, filled, unique and
 * their percentages are defined — specifically whether `null`, `''`, `[]` and
 * `false` count as empty, and what the denominator is when the table is empty.
 * A10 (建议需求): a group statistic is computed inside its group; the table-wide
 * statistic is computed independently and must not be the average of the groups.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  AggregateTableRecordsQuery,
  v2CoreTokens,
  type AggregateTableRecordsResult,
  type IQueryBus,
  type IAggregateTableRecordsQueryInput,
} from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldByName,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

type AggregateEntry = {
  /** Group values for a bucketed entry; `undefined` marks the table total. */
  groupValues?: ReadonlyArray<unknown>;
  value: unknown;
  fieldId: string;
  statisticFunc: string;
};

describe('A08/A10: statistic denominators and group arithmetic', () => {
  let ctx: SharedTestContext;
  let queryBus: IQueryBus;
  const actorId = ActorId.create('usrTestUserId')._unsafeUnwrap();

  let emptyTableId: string;
  let emptyTableAmountId: string;

  let tableId: string;
  let amountId: string;
  let flagId: string;
  let groupId: string;

  const aggregate = async (
    input: IAggregateTableRecordsQueryInput
  ): Promise<AggregateTableRecordsResult> => {
    const query = AggregateTableRecordsQuery.create(input);
    if (query.isErr()) throw new Error(`Invalid aggregate input: ${query.error.message}`);
    const result = await queryBus.execute({ actorId, windowId: 'e2e-window' }, query.value);
    if (result.isErr()) throw new Error(`Aggregate failed: ${result.error.message}`);
    return result.value as AggregateTableRecordsResult;
  };

  /** All values for one statistic, including group buckets. */
  const entries = (
    result: AggregateTableRecordsResult,
    fieldId: string,
    statisticFunc: string
  ): AggregateEntry[] =>
    (result.values as unknown as AggregateEntry[]).filter(
      (entry) => String(entry.fieldId) === fieldId && entry.statisticFunc === statisticFunc
    );

  const readStatistic = async (targetTableId: string, fieldId: string, statisticFunc: string) => {
    const result = await aggregate({
      tableId: targetTableId,
      fields: [{ fieldId, statisticFunc }],
    });
    const [entry] = entries(result, fieldId, statisticFunc);
    return { value: entry?.value, entry };
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    queryBus = ctx.testContainer.container.resolve(v2CoreTokens.queryBus);

    const empty = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'A08 Empty Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    });
    emptyTableId = empty.id;
    emptyTableAmountId = fieldByName(empty, 'Amount').id;

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'A08 Denominators',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
        { type: 'checkbox', name: 'Flag' },
        {
          type: 'singleSelect',
          name: 'Group',
          options: { choices: [{ name: 'g1' }, { name: 'g2' }] },
        },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    amountId = fieldByName(table, 'Amount').id;
    flagId = fieldByName(table, 'Flag').id;
    groupId = fieldByName(table, 'Group').id;

    // Fixture: 6 rows — 2 filled g1 (10, 20), 1 filled g2 (30), 3 empty.
    await ctx.createRecords(tableId, [
      { fields: { [amountId]: 10, [groupId]: 'g1', [flagId]: true } },
      { fields: { [amountId]: 20, [groupId]: 'g1', [flagId]: false } },
      { fields: { [amountId]: 30, [groupId]: 'g2', [flagId]: true } },
      { fields: { [groupId]: 'g2' } },
      { fields: {} },
      { fields: {} },
    ]);
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    if (emptyTableId) await ctx.deleteTable(emptyTableId).catch(() => undefined);
  });

  describe('A08 an empty table produces no illegal values', () => {
    it('reports zero counts', async () => {
      for (const statisticFunc of ['count', 'empty', 'filled', 'unique']) {
        const { value } = await readStatistic(emptyTableId, emptyTableAmountId, statisticFunc);
        expect(value, `${statisticFunc} on an empty table`).toBe(0);
      }
    });

    it('reports zero percentages rather than NaN', async () => {
      for (const statisticFunc of ['percentEmpty', 'percentFilled', 'percentUnique']) {
        const { value } = await readStatistic(emptyTableId, emptyTableAmountId, statisticFunc);
        expect(value, `${statisticFunc} on an empty table`).toBe(0);
      }
    });

    it('reports an empty numeric aggregate', async () => {
      for (const statisticFunc of ['sum', 'average', 'min', 'max']) {
        const { value } = await readStatistic(emptyTableId, emptyTableAmountId, statisticFunc);
        expect(value, `${statisticFunc} on an empty table`).toBeNull();
      }
    });
  });

  describe('A08 percentages use the record count as denominator', () => {
    it('counts every row', async () => {
      const { value } = await readStatistic(tableId, amountId, 'count');
      expect(value).toBe(6);
    });

    it('counts three filled and three empty rows', async () => {
      expect((await readStatistic(tableId, amountId, 'filled')).value).toBe(3);
      expect((await readStatistic(tableId, amountId, 'empty')).value).toBe(3);
    });

    it('expresses filled and empty as a share of all rows', async () => {
      expect((await readStatistic(tableId, amountId, 'percentFilled')).value).toBe(50);
      expect((await readStatistic(tableId, amountId, 'percentEmpty')).value).toBe(50);
    });

    it('treats cleared checkbox values as unchecked, not as empty', async () => {
      // A05: the boolean field type reports checked/unChecked; a cleared cell
      // normalises to NULL and lands in unChecked.
      expect((await readStatistic(tableId, flagId, 'count')).value).toBe(6);
      expect((await readStatistic(tableId, flagId, 'checked')).value).toBe(2);
      expect((await readStatistic(tableId, flagId, 'unChecked')).value).toBe(4);
    });
  });

  describe('A10 group statistics are computed per group', () => {
    /** The table-wide entry is the one without group values. */
    const bucketsByGroup = (list: ReadonlyArray<AggregateEntry>) =>
      new Map(
        list
          .filter((entry) => entry.groupValues !== undefined)
          .map((entry) => [entry.groupValues?.[0], entry.value] as const)
      );

    const groupedByAmount = async (statisticFunc: string) => {
      const result = await aggregate({
        tableId,
        fields: [{ fieldId: amountId, statisticFunc }],
        groupBy: [{ fieldId: groupId, order: 'asc' }],
      });
      return entries(result, amountId, statisticFunc);
    };

    it('sums each group independently', async () => {
      const byGroup = bucketsByGroup(await groupedByAmount('sum'));
      expect(byGroup.get('g1')).toBe(30);
      expect(byGroup.get('g2')).toBe(30);
    });

    it('does not report the average of group sums as the total', async () => {
      const { value: total } = await readStatistic(tableId, amountId, 'sum');
      expect(total).toBe(60);
      // 30 is the mean of the two groups; it must not be the reported total.
      expect(total).not.toBe(30);
    });

    it('counts each group independently', async () => {
      const result = await aggregate({
        tableId,
        fields: [{ fieldId: groupId, statisticFunc: 'count' }],
        groupBy: [{ fieldId: groupId, order: 'asc' }],
      });
      const byGroup = bucketsByGroup(entries(result, groupId, 'count'));
      expect(byGroup.get('g1')).toBe(2);
      expect(byGroup.get('g2')).toBe(2);
    });

    it('reports the total bucket alongside the group buckets', async () => {
      const buckets = await groupedByAmount('sum');
      const total = buckets.find((entry) => entry.groupValues === undefined);
      expect(total?.value).toBe(60);
    });
  });

  describe('A08 unique counts distinct business values', () => {
    it('counts the distinct amounts', async () => {
      expect((await readStatistic(tableId, amountId, 'unique')).value).toBe(3);
    });

    it('expresses unique as a share of all rows', async () => {
      expect((await readStatistic(tableId, amountId, 'percentUnique')).value).toBe(50);
    });
  });
});
