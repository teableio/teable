/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  AggregateTableRecordsQuery,
  v2CoreTokens,
  type AggregateTableRecordsResult,
  type IAggregateTableRecordsQueryInput,
  type IQueryBus,
  type RecordFilter,
} from '@teable/v2-core';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getSharedTestContext,
  TEST_USER,
  type SharedTestContext,
} from './shared/globalTestContext';
import {
  ensureAttachmentTables,
  makeAttachmentCell,
  seedAttachment,
} from './update-field/attachment/testUtils';

/**
 * V1-parity e2e coverage for record aggregation, ported from
 * apps/nestjs-backend/test/data-helpers/caces/aggregation-query/ case tables
 * (text/number/single-select/date/checkbox statistics).
 *
 * v2 has no HTTP aggregation endpoint yet, so these tests execute
 * AggregateTableRecordsQuery directly through the query bus resolved from the
 * shared test container — the same mechanism contract-http-implementation uses
 * for its query routes (container.resolve(v2CoreTokens.queryBus)).
 *
 * Unlike v1 (which asserts against the shared x_20 seed), this file builds its
 * own fixture and derives every expected value from it, honoring T6520
 * semantics: cleared ""/false/[] values are stored as NULL and therefore count
 * as Empty / UnChecked.
 */
describe('aggregate records via query bus (e2e, v1 parity)', () => {
  let ctx: SharedTestContext;
  let queryBus: IQueryBus;
  const actorId = ActorId.create(TEST_USER.id)._unsafeUnwrap();

  const aggregate = async (
    input: IAggregateTableRecordsQueryInput
  ): Promise<AggregateTableRecordsResult> => {
    const query = AggregateTableRecordsQuery.create(input);
    if (query.isErr()) {
      throw new Error(`Invalid aggregate query input: ${query.error.message}`);
    }
    const result = await queryBus.execute<AggregateTableRecordsQuery, AggregateTableRecordsResult>(
      { actorId, windowId: 'e2e-window' },
      query.value
    );
    if (result.isErr()) {
      throw new Error(`Aggregate query failed: ${result.error.message}`);
    }
    return result.value;
  };

  const aggregateValue = async (
    tableId: string,
    viewId: string,
    fieldId: string,
    statisticFunc: string,
    filter?: RecordFilter
  ): Promise<number | string | null> => {
    const result = await aggregate({
      tableId,
      viewId,
      fields: [{ fieldId, statisticFunc }],
      ...(filter ? { filter } : {}),
    });
    const entry = result.values.find(
      (value) => value.fieldId.toString() === fieldId && value.statisticFunc === statisticFunc
    );
    if (!entry) {
      throw new Error(`No aggregation value returned for ${fieldId} ${statisticFunc}`);
    }
    return entry.value;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    queryBus = ctx.testContainer.container.resolve<IQueryBus>(v2CoreTokens.queryBus);
  }, 30000);

  // ----------------------------------------------------------------
  // Main fixture: 10 records across text/number/select/date/checkbox
  // ----------------------------------------------------------------
  describe('v1-parity statistic matrix', () => {
    let tableId: string;
    let viewId: string;
    let nameFieldId: string;
    let notesFieldId: string;
    let amountFieldId: string;
    let ratingFieldId: string;
    let statusFieldId: string;
    let tagsFieldId: string;
    let dueFieldId: string;
    let doneFieldId: string;
    let ownerFieldId: string;
    let collaboratorsFieldId: string;

    // Fixture (10 rows). null = value omitted (stored NULL).
    //  # | Name    | Amount | Status | Due (UTC)                | Done
    //  1 | Alpha   |     10 | Todo   | 2024-01-01T00:00:00.000Z | true
    //  2 | Beta    |     20 | Doing  | 2024-01-11T00:00:00.000Z | true
    //  3 | Beta    |     30 | Done   | 2024-01-31T00:00:00.000Z | true
    //  4 | Gamma   |     40 | Todo   | null                     | false (T6520 → NULL)
    //  5 | Delta   |    100 | Todo   | 2024-01-16T00:00:00.000Z | null
    //  6 | Epsilon |   null | null   | null                     | null
    //  7 | Zeta    |   null | null   | null                     | null
    //  8 | Eta     |   null | Done   | null                     | null
    //  9 | null    |   null | null   | null                     | null
    // 10 | null    |   null | null   | null                     | null
    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Aggregation Parity ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Notes', type: 'longText' },
          { name: 'Amount', type: 'number' },
          {
            name: 'Rating',
            type: 'rating',
            options: { max: 5, icon: 'star', color: 'yellowBright' },
          },
          { name: 'Status', type: 'singleSelect', options: ['Todo', 'Doing', 'Done'] },
          { name: 'Tags', type: 'multipleSelect', options: ['Red', 'Blue', 'Green'] },
          { name: 'Due', type: 'date' },
          { name: 'Done', type: 'checkbox' },
          { name: 'Owner', type: 'user', options: { isMultiple: false } },
          { name: 'Collaborators', type: 'user', options: { isMultiple: true } },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      viewId = table.views[0].id;
      nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      notesFieldId = table.fields.find((f) => f.name === 'Notes')?.id ?? '';
      amountFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';
      ratingFieldId = table.fields.find((f) => f.name === 'Rating')?.id ?? '';
      statusFieldId = table.fields.find((f) => f.name === 'Status')?.id ?? '';
      tagsFieldId = table.fields.find((f) => f.name === 'Tags')?.id ?? '';
      dueFieldId = table.fields.find((f) => f.name === 'Due')?.id ?? '';
      doneFieldId = table.fields.find((f) => f.name === 'Done')?.id ?? '';
      ownerFieldId = table.fields.find((f) => f.name === 'Owner')?.id ?? '';
      collaboratorsFieldId = table.fields.find((f) => f.name === 'Collaborators')?.id ?? '';

      const rows: Array<{
        name?: string;
        notes?: string;
        amount?: number;
        rating?: number;
        status?: string;
        tags?: string[];
        due?: string;
        done?: boolean;
        owner?: { id: string; title: string };
        collaborators?: Array<{ id: string; title: string }>;
      }> = [
        {
          name: 'Alpha',
          notes: 'memo-a',
          amount: 10,
          rating: 5,
          status: 'Todo',
          tags: ['Red', 'Blue'],
          due: '2024-01-01T00:00:00.000Z',
          done: true,
          owner: { id: ctx.testUser.id, title: ctx.testUser.name },
          collaborators: [{ id: ctx.testUser.id, title: ctx.testUser.name }],
        },
        {
          name: 'Beta',
          amount: 20,
          rating: 3,
          status: 'Doing',
          tags: ['Blue'],
          due: '2024-01-11T00:00:00.000Z',
          done: true,
          owner: { id: ctx.testUser.id, title: ctx.testUser.name },
          collaborators: [{ id: ctx.testUser.id, title: ctx.testUser.name }],
        },
        {
          name: 'Beta',
          notes: 'memo-b',
          amount: 30,
          rating: 4,
          status: 'Done',
          tags: ['Green'],
          due: '2024-01-31T00:00:00.000Z',
          done: true,
        },
        // Explicit false exercises T6520: false stores NULL and counts as UnChecked.
        {
          name: 'Gamma',
          notes: 'memo-a',
          amount: 40,
          rating: 1,
          status: 'Todo',
          tags: [],
          done: false,
        },
        {
          name: 'Delta',
          amount: 100,
          rating: 2,
          status: 'Todo',
          tags: ['Red'],
          due: '2024-01-16T00:00:00.000Z',
        },
        { name: 'Epsilon', rating: 5 },
        { name: 'Zeta' },
        { name: 'Eta', status: 'Done' },
        {},
        {},
      ];

      await ctx.createRecords(
        tableId,
        rows.map((row) => ({
          fields: {
            ...(row.name !== undefined ? { [nameFieldId]: row.name } : {}),
            ...(row.notes !== undefined ? { [notesFieldId]: row.notes } : {}),
            ...(row.amount !== undefined ? { [amountFieldId]: row.amount } : {}),
            ...(row.rating !== undefined ? { [ratingFieldId]: row.rating } : {}),
            ...(row.status !== undefined ? { [statusFieldId]: row.status } : {}),
            ...(row.tags !== undefined ? { [tagsFieldId]: row.tags } : {}),
            ...(row.due !== undefined ? { [dueFieldId]: row.due } : {}),
            ...(row.done !== undefined ? { [doneFieldId]: row.done } : {}),
            ...(row.owner !== undefined ? { [ownerFieldId]: row.owner } : {}),
            ...(row.collaborators !== undefined
              ? { [collaboratorsFieldId]: row.collaborators }
              : {}),
          },
        }))
      );
      await ctx.drainOutbox();
    }, 30000);

    // ---- TEXT (v1 TEXT_FIELD_CASES: Count/Empty/Filled/Unique/Percent*) ----
    // Name column: 8 filled, 2 empty, 7 distinct non-null values.
    it.each([
      { statisticFunc: 'count', expected: 10 },
      { statisticFunc: 'empty', expected: 2 },
      { statisticFunc: 'filled', expected: 8 },
      { statisticFunc: 'unique', expected: 7 },
      { statisticFunc: 'percentEmpty', expected: 20 },
      { statisticFunc: 'percentFilled', expected: 80 },
      { statisticFunc: 'percentUnique', expected: 70 },
    ])('text field: $statisticFunc = $expected', async ({ statisticFunc, expected }) => {
      const value = await aggregateValue(tableId, viewId, nameFieldId, statisticFunc);
      expect(Number(value)).toBeCloseTo(expected, 4);
    });

    // ---- LONG TEXT (v1 LONG_TEXT_FIELD_CASES) ----
    // Notes column: three filled rows, seven empty rows, two distinct values.
    it.each([
      { statisticFunc: 'count', expected: 10 },
      { statisticFunc: 'empty', expected: 7 },
      { statisticFunc: 'filled', expected: 3 },
      { statisticFunc: 'unique', expected: 2 },
    ])('long text field: $statisticFunc = $expected', async ({ statisticFunc, expected }) => {
      const value = await aggregateValue(tableId, viewId, notesFieldId, statisticFunc);
      expect(Number(value)).toBeCloseTo(expected, 4);
    });

    // ---- NUMBER (v1 NUMBER_FIELD_CASES: Sum/Average/Min/Max + Empty/Filled) ----
    // Amount column: 10, 20, 30, 40, 100 filled; 5 empty.
    it.each([
      { statisticFunc: 'sum', expected: 200 },
      { statisticFunc: 'average', expected: 40 },
      { statisticFunc: 'min', expected: 10 },
      { statisticFunc: 'max', expected: 100 },
      { statisticFunc: 'count', expected: 10 },
      { statisticFunc: 'empty', expected: 5 },
      { statisticFunc: 'filled', expected: 5 },
      { statisticFunc: 'unique', expected: 5 },
      { statisticFunc: 'percentEmpty', expected: 50 },
      { statisticFunc: 'percentFilled', expected: 50 },
      { statisticFunc: 'percentUnique', expected: 50 },
    ])('number field: $statisticFunc = $expected', async ({ statisticFunc, expected }) => {
      const value = await aggregateValue(tableId, viewId, amountFieldId, statisticFunc);
      expect(Number(value)).toBeCloseTo(expected, 4);
    });

    // ---- RATING (v1 RATING_FIELD_CASES) ----
    // Rating column: 5, 3, 4, 1, 2, 5.
    it.each([
      { statisticFunc: 'sum', expected: 20 },
      { statisticFunc: 'average', expected: 20 / 6 },
      { statisticFunc: 'min', expected: 1 },
      { statisticFunc: 'max', expected: 5 },
    ])('rating field: $statisticFunc = $expected', async ({ statisticFunc, expected }) => {
      const value = await aggregateValue(tableId, viewId, ratingFieldId, statisticFunc);
      expect(Number(value)).toBeCloseTo(expected, 4);
    });

    // ---- SINGLE SELECT (v1 SINGLE_SELECT_FIELD_CASES) ----
    // Status column: Todo x3, Doing x1, Done x2 → 6 filled, 4 empty, 3 unique.
    it.each([
      { statisticFunc: 'count', expected: 10 },
      { statisticFunc: 'empty', expected: 4 },
      { statisticFunc: 'filled', expected: 6 },
      { statisticFunc: 'unique', expected: 3 },
      { statisticFunc: 'percentEmpty', expected: 40 },
      { statisticFunc: 'percentFilled', expected: 60 },
      { statisticFunc: 'percentUnique', expected: 30 },
    ])('single select field: $statisticFunc = $expected', async ({ statisticFunc, expected }) => {
      const value = await aggregateValue(tableId, viewId, statusFieldId, statisticFunc);
      expect(Number(value)).toBeCloseTo(expected, 4);
    });

    // ---- DATE (v1 DATE_FIELD_CASES: Empty/Filled + DateRangeOfDays) ----
    // Due column: 2024-01-01, 2024-01-11, 2024-01-16, 2024-01-31 → range 30 days.
    it.each([
      { statisticFunc: 'count', expected: 10 },
      { statisticFunc: 'empty', expected: 6 },
      { statisticFunc: 'filled', expected: 4 },
      { statisticFunc: 'unique', expected: 4 },
      { statisticFunc: 'percentEmpty', expected: 60 },
      { statisticFunc: 'percentFilled', expected: 40 },
      { statisticFunc: 'percentUnique', expected: 40 },
      { statisticFunc: 'dateRangeOfDays', expected: 30 },
      { statisticFunc: 'dateRangeOfMonths', expected: 0 },
    ])('date field: $statisticFunc = $expected', async ({ statisticFunc, expected }) => {
      const value = await aggregateValue(tableId, viewId, dueFieldId, statisticFunc);
      expect(Number(value)).toBe(expected);
    });

    it('date field: earliestDate/latestDate return the boundary timestamps', async () => {
      const earliest = await aggregateValue(tableId, viewId, dueFieldId, 'earliestDate');
      const latest = await aggregateValue(tableId, viewId, dueFieldId, 'latestDate');
      expect(new Date(String(earliest)).toISOString()).toBe('2024-01-01T00:00:00.000Z');
      expect(new Date(String(latest)).toISOString()).toBe('2024-01-31T00:00:00.000Z');
    });

    // ---- CHECKBOX (v1 CHECKBOX_FIELD_CASES) ----
    // Done column: true x3; false/omitted are stored NULL (T6520) and count as
    // UnChecked → checked 3, unChecked 7.
    it.each([
      { statisticFunc: 'count', expected: 10 },
      { statisticFunc: 'checked', expected: 3 },
      { statisticFunc: 'unChecked', expected: 7 },
      { statisticFunc: 'percentChecked', expected: 30 },
      { statisticFunc: 'percentUnChecked', expected: 70 },
    ])('checkbox field: $statisticFunc = $expected', async ({ statisticFunc, expected }) => {
      const value = await aggregateValue(tableId, viewId, doneFieldId, statisticFunc);
      expect(Number(value)).toBeCloseTo(expected, 4);
    });

    // ---- MULTIPLE SELECT (v1 MULTIPLE_SELECT_FIELD_CASES) ----
    // Tags column: four filled rows, six empty rows, three distinct choices.
    it.each([
      { statisticFunc: 'count', expected: 10 },
      { statisticFunc: 'empty', expected: 6 },
      { statisticFunc: 'filled', expected: 4 },
      { statisticFunc: 'unique', expected: 3 },
      { statisticFunc: 'percentEmpty', expected: 60 },
      { statisticFunc: 'percentFilled', expected: 40 },
      // Multi-value percentUnique uses distinct flattened values / all flattened values.
      { statisticFunc: 'percentUnique', expected: 60 },
    ])('multiple select field: $statisticFunc = $expected', async ({ statisticFunc, expected }) => {
      const value = await aggregateValue(tableId, viewId, tagsFieldId, statisticFunc);
      expect(Number(value)).toBeCloseTo(expected, 4);
    });

    // ---- USER (v1 USER_FIELD_CASES) ----
    // Owner column: two filled rows referring to one distinct user.
    it.each([
      { statisticFunc: 'count', expected: 10 },
      { statisticFunc: 'empty', expected: 8 },
      { statisticFunc: 'filled', expected: 2 },
      { statisticFunc: 'unique', expected: 1 },
      { statisticFunc: 'percentEmpty', expected: 80 },
      { statisticFunc: 'percentFilled', expected: 20 },
      { statisticFunc: 'percentUnique', expected: 10 },
    ])('user field: $statisticFunc = $expected', async ({ statisticFunc, expected }) => {
      const value = await aggregateValue(tableId, viewId, ownerFieldId, statisticFunc);
      expect(Number(value)).toBeCloseTo(expected, 4);
    });

    // ---- MULTIPLE USER (v1 MULTIPLE_USER_FIELD_CASES) ----
    it.each([
      { statisticFunc: 'count', expected: 10 },
      { statisticFunc: 'empty', expected: 8 },
      { statisticFunc: 'filled', expected: 2 },
    ])('multiple user field: $statisticFunc = $expected', async ({ statisticFunc, expected }) => {
      const value = await aggregateValue(tableId, viewId, collaboratorsFieldId, statisticFunc);
      expect(Number(value)).toBeCloseTo(expected, 4);
    });

    // ---- FILTERED AGGREGATION (v1 aggregation.e2e-spec.ts filter cases) ----
    it('applies a filter before aggregating (Status is Todo)', async () => {
      const filter: RecordFilter = {
        fieldId: statusFieldId,
        operator: 'is',
        value: 'Todo',
      };
      // Rows 1, 4, 5: Amount 10 + 40 + 100, one checked (row 1).
      expect(Number(await aggregateValue(tableId, viewId, amountFieldId, 'sum', filter))).toBe(150);
      expect(Number(await aggregateValue(tableId, viewId, nameFieldId, 'count', filter))).toBe(3);
      expect(Number(await aggregateValue(tableId, viewId, doneFieldId, 'checked', filter))).toBe(1);
      expect(Number(await aggregateValue(tableId, viewId, doneFieldId, 'unChecked', filter))).toBe(
        2
      );
    });

    it('supports multiple statistics for multiple fields in a single query', async () => {
      const result = await aggregate({
        tableId,
        viewId,
        fields: [
          { fieldId: nameFieldId, statisticFunc: 'filled' },
          { fieldId: amountFieldId, statisticFunc: 'sum' },
          { fieldId: doneFieldId, statisticFunc: 'checked' },
        ],
      });
      const byKey = new Map(
        result.values.map((v) => [`${v.fieldId.toString()}:${v.statisticFunc}`, v.value])
      );
      expect(Number(byKey.get(`${nameFieldId}:filled`))).toBe(8);
      expect(Number(byKey.get(`${amountFieldId}:sum`))).toBe(200);
      expect(Number(byKey.get(`${doneFieldId}:checked`))).toBe(3);
    });

    it('applies hide-not-matching search before aggregating', async () => {
      const result = await aggregate({
        tableId,
        viewId,
        search: ['Beta', nameFieldId, true],
        fields: [{ fieldId: amountFieldId, statisticFunc: 'sum' }],
      });

      expect(result.values).toHaveLength(1);
      expect(result.values[0]?.value).toBe(50);
    });

    it('applies hide-not-matching search to every requested statistic', async () => {
      const result = await aggregate({
        tableId,
        viewId,
        search: ['Beta', nameFieldId, true],
        fields: [
          { fieldId: amountFieldId, statisticFunc: 'sum' },
          { fieldId: amountFieldId, statisticFunc: 'average' },
          { fieldId: amountFieldId, statisticFunc: 'min' },
          { fieldId: amountFieldId, statisticFunc: 'max' },
          { fieldId: amountFieldId, statisticFunc: 'count' },
        ],
      });
      const byFunction = new Map(
        result.values.map(({ statisticFunc, value }) => [statisticFunc, value])
      );

      expect(Number(byFunction.get('sum'))).toBe(50);
      expect(Number(byFunction.get('average'))).toBe(25);
      expect(Number(byFunction.get('min'))).toBe(20);
      expect(Number(byFunction.get('max'))).toBe(30);
      expect(Number(byFunction.get('count'))).toBe(2);
    });

    it('returns zero for percent statistics when the filter matches no records', async () => {
      const result = await aggregate({
        tableId,
        viewId,
        filter: {
          fieldId: nameFieldId,
          operator: 'is',
          value: 'does-not-exist',
        },
        fields: [
          { fieldId: nameFieldId, statisticFunc: 'percentFilled' },
          { fieldId: nameFieldId, statisticFunc: 'percentUnique' },
          { fieldId: nameFieldId, statisticFunc: 'percentEmpty' },
          { fieldId: doneFieldId, statisticFunc: 'percentChecked' },
          { fieldId: doneFieldId, statisticFunc: 'percentUnChecked' },
        ],
      });

      expect(result.values).toHaveLength(5);
      expect(result.values.every(({ value }) => Number(value) === 0)).toBe(true);
    });

    it('returns total and grouped aggregation buckets', async () => {
      const result = await aggregate({
        tableId,
        viewId,
        fields: [{ fieldId: amountFieldId, statisticFunc: 'sum' }],
        groupBy: [{ fieldId: statusFieldId, order: 'asc' }],
      });

      expect(result.groupBy.map((group) => group.fieldId.toString())).toEqual([statusFieldId]);
      expect(result.values.find(({ groupValues }) => groupValues === undefined)?.value).toBe(200);

      const groups = result.values.filter(({ groupValues }) => groupValues !== undefined);
      expect(groups).toHaveLength(4);
      expect(
        new Map(
          groups
            .filter(({ groupValues }) => groupValues?.[0] !== null)
            .map(({ value, groupValues }) => [groupValues?.[0], value])
        )
      ).toEqual(
        new Map([
          ['Todo', 150],
          ['Doing', 20],
          ['Done', 30],
        ])
      );
      expect(groups.find(({ groupValues }) => groupValues?.[0] === null)?.value).toBeNull();
    });

    it('orders text group buckets in the requested direction', async () => {
      const groupValues = async (order: 'asc' | 'desc') => {
        const result = await aggregate({
          tableId,
          viewId,
          fields: [{ fieldId: amountFieldId, statisticFunc: 'sum' }],
          groupBy: [{ fieldId: nameFieldId, order }],
        });
        return result.values
          .filter(({ groupValues }) => groupValues !== undefined)
          .map(({ groupValues }) => groupValues?.[0] ?? null);
      };

      const ascending = await groupValues('asc');
      const descending = await groupValues('desc');
      expect(descending).toEqual([...ascending].reverse());
      expect(ascending.filter((value) => value !== null)).toEqual([
        'Alpha',
        'Beta',
        'Delta',
        'Epsilon',
        'Eta',
        'Gamma',
        'Zeta',
      ]);
    });

    it('returns no values when no statistics are requested', async () => {
      const result = await aggregate({ tableId, viewId });
      expect(result.values).toEqual([]);
    });
  });

  // ----------------------------------------------------------------
  // Link and lookup aggregation remains database-pushed through QueryBus.
  // ----------------------------------------------------------------
  describe('link and lookup aggregation parity', () => {
    it('aggregates link occupancy and filters a number aggregation by lookup values', async () => {
      const source = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Aggregation Lookup Source ${Date.now()}`,
        fields: [
          { name: 'Order', type: 'singleLineText', isPrimary: true },
          { name: 'Amount', type: 'number' },
          { name: 'Tag', type: 'singleLineText' },
        ],
        views: [{ type: 'grid' }],
      });
      const sourceNameFieldId = source.fields.find((field) => field.name === 'Order')?.id ?? '';
      const sourceTagFieldId = source.fields.find((field) => field.name === 'Tag')?.id ?? '';
      const sourceRecords = await ctx.createRecords(source.id, [
        { fields: { [sourceNameFieldId]: 'Order A', [sourceTagFieldId]: 'include' } },
        { fields: { [sourceNameFieldId]: 'Order B', [sourceTagFieldId]: 'exclude' } },
      ]);

      const target = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Aggregation Lookup Target ${Date.now()}`,
        fields: [
          { name: 'Task', type: 'singleLineText', isPrimary: true },
          { name: 'Budget', type: 'number' },
          {
            name: 'Orders',
            type: 'link',
            options: {
              relationship: 'manyMany',
              foreignTableId: source.id,
              lookupFieldId: sourceNameFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const taskFieldId = target.fields.find((field) => field.name === 'Task')?.id ?? '';
      const budgetFieldId = target.fields.find((field) => field.name === 'Budget')?.id ?? '';
      const linkFieldId = target.fields.find((field) => field.name === 'Orders')?.id ?? '';
      const targetWithLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: target.id,
        field: {
          name: 'Order Tags',
          type: 'lookup',
          options: {
            foreignTableId: source.id,
            linkFieldId,
            lookupFieldId: sourceTagFieldId,
          },
        },
      });
      const lookupFieldId =
        targetWithLookup.fields.find((field) => field.name === 'Order Tags')?.id ?? '';

      await ctx.createRecords(target.id, [
        {
          fields: {
            [taskFieldId]: 'Task A',
            [budgetFieldId]: 10,
            [linkFieldId]: [{ id: sourceRecords[0].id }],
          },
        },
        {
          fields: {
            [taskFieldId]: 'Task B',
            [budgetFieldId]: 30,
            [linkFieldId]: [{ id: sourceRecords[1].id }],
          },
        },
        { fields: { [taskFieldId]: 'Task C' } },
      ]);
      await ctx.drainOutbox();

      expect(
        Number(await aggregateValue(target.id, target.views[0].id, linkFieldId, 'count'))
      ).toBe(3);
      expect(
        Number(await aggregateValue(target.id, target.views[0].id, linkFieldId, 'empty'))
      ).toBe(1);
      expect(
        Number(await aggregateValue(target.id, target.views[0].id, linkFieldId, 'filled'))
      ).toBe(2);
      expect(
        Number(await aggregateValue(target.id, target.views[0].id, linkFieldId, 'percentEmpty'))
      ).toBeCloseTo(100 / 3, 4);
      expect(
        Number(await aggregateValue(target.id, target.views[0].id, linkFieldId, 'percentFilled'))
      ).toBeCloseTo(200 / 3, 4);

      // Merely projecting a lookup must not change aggregation of a stored number field.
      expect(
        Number(await aggregateValue(target.id, target.views[0].id, budgetFieldId, 'sum'))
      ).toBe(40);
      expect(
        Number(
          await aggregateValue(target.id, target.views[0].id, budgetFieldId, 'sum', {
            fieldId: lookupFieldId,
            operator: 'is',
            value: 'include',
          })
        )
      ).toBe(10);
    }, 30000);

    it('sums decimal values from a multi-value number lookup without truncation', async () => {
      const source = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Aggregation Decimal Lookup Source ${Date.now()}`,
        fields: [
          { name: 'Order', type: 'singleLineText', isPrimary: true },
          { name: 'Amount', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      const sourceNameFieldId = source.fields.find((field) => field.name === 'Order')?.id ?? '';
      const sourceAmountFieldId = source.fields.find((field) => field.name === 'Amount')?.id ?? '';
      const amounts = [299.88, 42.12, 10.5];
      const sourceRecords = await ctx.createRecords(
        source.id,
        amounts.map((amount, index) => ({
          fields: {
            [sourceNameFieldId]: `Order ${index + 1}`,
            [sourceAmountFieldId]: amount,
          },
        }))
      );

      const target = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Aggregation Decimal Lookup Target ${Date.now()}`,
        fields: [
          { name: 'Summary', type: 'singleLineText', isPrimary: true },
          {
            name: 'Orders',
            type: 'link',
            options: {
              relationship: 'manyMany',
              foreignTableId: source.id,
              lookupFieldId: sourceNameFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const summaryFieldId = target.fields.find((field) => field.name === 'Summary')?.id ?? '';
      const linkFieldId = target.fields.find((field) => field.name === 'Orders')?.id ?? '';
      const targetWithLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: target.id,
        field: {
          name: 'Order Amounts',
          type: 'lookup',
          options: {
            foreignTableId: source.id,
            linkFieldId,
            lookupFieldId: sourceAmountFieldId,
          },
        },
      });
      const lookupFieldId =
        targetWithLookup.fields.find((field) => field.name === 'Order Amounts')?.id ?? '';

      await ctx.createRecord(target.id, {
        [summaryFieldId]: 'All Orders',
        [linkFieldId]: sourceRecords.map((record) => ({ id: record.id })),
      });
      await ctx.drainOutbox();

      const sum = await aggregateValue(target.id, target.views[0].id, lookupFieldId, 'sum');
      expect(Number(sum)).toBeCloseTo(352.5, 4);
    }, 30000);
  });

  describe('attachment aggregation parity', () => {
    it('computes total attachment size for total and grouped buckets', async () => {
      await ensureAttachmentTables(ctx);
      const file10 = await seedAttachment(ctx, 10);
      const file20a = await seedAttachment(ctx, 20);
      const file20b = await seedAttachment(ctx, 20);

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Aggregation Attachment ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'Group',
            type: 'singleSelect',
            options: ['A', 'B'],
          },
          { name: 'Files', type: 'attachment' },
        ],
        views: [{ type: 'grid' }],
      });
      const nameFieldId = table.fields.find((field) => field.name === 'Name')?.id ?? '';
      const groupFieldId = table.fields.find((field) => field.name === 'Group')?.id ?? '';
      const attachmentFieldId = table.fields.find((field) => field.name === 'Files')?.id ?? '';

      await ctx.createRecords(table.id, [
        {
          fields: {
            [nameFieldId]: 'A-10',
            [groupFieldId]: 'A',
            [attachmentFieldId]: makeAttachmentCell(file10, '10.bin'),
          },
        },
        {
          fields: {
            [nameFieldId]: 'A-20',
            [groupFieldId]: 'A',
            [attachmentFieldId]: makeAttachmentCell(file20a, '20-a.bin'),
          },
        },
        {
          fields: {
            [nameFieldId]: 'B-20',
            [groupFieldId]: 'B',
            [attachmentFieldId]: makeAttachmentCell(file20b, '20-b.bin'),
          },
        },
        { fields: { [nameFieldId]: 'Ungrouped' } },
      ]);
      await ctx.drainOutbox();

      const result = await aggregate({
        tableId: table.id,
        viewId: table.views[0].id,
        fields: [{ fieldId: attachmentFieldId, statisticFunc: 'totalAttachmentSize' }],
        groupBy: [{ fieldId: groupFieldId, order: 'asc' }],
      });
      const total = result.values.find(({ groupValues }) => groupValues === undefined);
      expect(Number(total?.value)).toBe(50);

      const groupedValues = result.values
        .filter(({ groupValues }) => groupValues !== undefined)
        .map(({ value }) => Number(value))
        .sort((left, right) => left - right);
      expect(groupedValues).toEqual([0, 20, 30]);
    }, 30000);
  });

  describe('search and empty-table aggregation parity', () => {
    it('handles literal question marks and number precision in search bindings', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Aggregation Search Bindings ${Date.now()}`,
        fields: [
          { name: 'URL 1', type: 'singleLineText', isPrimary: true },
          { name: 'URL 2', type: 'singleLineText' },
          {
            name: 'Number',
            type: 'number',
            options: { formatting: { type: 'decimal', precision: 1 } },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const url1FieldId = table.fields.find((field) => field.name === 'URL 1')?.id ?? '';
      const url2FieldId = table.fields.find((field) => field.name === 'URL 2')?.id ?? '';
      const numberFieldId = table.fields.find((field) => field.name === 'Number')?.id ?? '';
      const url = 'https://example.com/path?param=value';
      await ctx.createRecords(table.id, [
        { fields: { [url1FieldId]: url, [url2FieldId]: 'no', [numberFieldId]: 10.1 } },
        { fields: { [url1FieldId]: 'no', [url2FieldId]: url, [numberFieldId]: 20.2 } },
        { fields: { [url1FieldId]: 'no', [url2FieldId]: 'no', [numberFieldId]: 30.3 } },
      ]);

      const questionMarkResult = await aggregate({
        tableId: table.id,
        viewId: table.views[0].id,
        search: [url, '', true],
        fields: [{ fieldId: url1FieldId, statisticFunc: 'count' }],
      });
      expect(Number(questionMarkResult.values[0]?.value)).toBe(2);

      const numberResult = await aggregate({
        tableId: table.id,
        viewId: table.views[0].id,
        search: ['10', numberFieldId, true],
        fields: [{ fieldId: url1FieldId, statisticFunc: 'count' }],
      });
      expect(Number(numberResult.values[0]?.value)).toBe(1);
    }, 30000);

    it('returns count zero for an empty table', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Aggregation Empty ${Date.now()}`,
        fields: [{ name: 'Name', type: 'singleLineText', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const fieldId = table.fields.find((field) => field.name === 'Name')?.id ?? '';

      expect(Number(await aggregateValue(table.id, table.views[0].id, fieldId, 'count'))).toBe(0);
    });
  });

  describe('selection aggregation v1 parity', () => {
    const hashGroupFlag = (value: string) => {
      let hash = 5381;
      let index = value.length;
      while (index) hash = (hash * 33) ^ value.charCodeAt(--index);
      return hash >>> 0;
    };
    const findAgg = (result: AggregateTableRecordsResult, fieldId: string, statisticFunc: string) =>
      result.values.find(
        (value) => value.fieldId.toString() === fieldId && value.statisticFunc === statisticFunc
      )?.value;

    it('aggregates sum/filled over a contiguous row range in view order', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Sel Agg Main ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'qty', type: 'number' },
          { name: 'price', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      const qtyFieldId = table.fields.find((field) => field.name === 'qty')?.id ?? '';
      const priceFieldId = table.fields.find((field) => field.name === 'price')?.id ?? '';
      await ctx.createRecords(
        table.id,
        [
          { qty: 10, price: 100 },
          { qty: 20, price: 200 },
          { qty: 30, price: 300 },
          { qty: 40, price: 400 },
          { qty: null, price: null },
        ].map((row, index) => ({
          fields: {
            [table.fields[0]!.id]: `r${index + 1}`,
            ...(row.qty != null ? { [qtyFieldId]: row.qty } : {}),
            ...(row.price != null ? { [priceFieldId]: row.price } : {}),
          },
        }))
      );
      await ctx.drainOutbox();

      const result = await aggregate({
        tableId: table.id,
        viewId: table.views[0].id,
        fields: [
          { fieldId: qtyFieldId, statisticFunc: 'sum' },
          { fieldId: qtyFieldId, statisticFunc: 'filled' },
          { fieldId: priceFieldId, statisticFunc: 'sum' },
          { fieldId: priceFieldId, statisticFunc: 'filled' },
        ],
        skip: 1,
        take: 2,
      });
      expect(findAgg(result, qtyFieldId, 'sum')).toBe(50);
      expect(findAgg(result, qtyFieldId, 'filled')).toBe(2);
      expect(findAgg(result, priceFieldId, 'sum')).toBe(500);
      expect(findAgg(result, priceFieldId, 'filled')).toBe(2);
    }, 30000);

    it('returns null sum and zero filled for an all-null range', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Sel Agg Null ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'qty', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      const qtyFieldId = table.fields.find((field) => field.name === 'qty')?.id ?? '';
      await ctx.createRecords(
        table.id,
        [10, 20, 30, 40, null].map((qty, index) => ({
          fields: {
            [table.fields[0]!.id]: `r${index + 1}`,
            ...(qty != null ? { [qtyFieldId]: qty } : {}),
          },
        }))
      );
      await ctx.drainOutbox();

      const result = await aggregate({
        tableId: table.id,
        viewId: table.views[0].id,
        fields: [
          { fieldId: qtyFieldId, statisticFunc: 'sum' },
          { fieldId: qtyFieldId, statisticFunc: 'filled' },
        ],
        skip: 4,
        take: 1,
      });
      expect(findAgg(result, qtyFieldId, 'sum')).toBeNull();
      expect(findAgg(result, qtyFieldId, 'filled')).toBe(0);
    }, 30000);

    it('honors view filter and sort so the slice matches grid row order', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Sel Agg View ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'qty', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      const qtyFieldId = table.fields.find((field) => field.name === 'qty')?.id ?? '';
      await ctx.createRecords(
        table.id,
        [10, 20, 30, 40, null].map((qty, index) => ({
          fields: {
            [table.fields[0]!.id]: `r${index + 1}`,
            ...(qty != null ? { [qtyFieldId]: qty } : {}),
          },
        }))
      );
      await ctx.drainOutbox();
      const client = createV2HttpClient({ baseUrl: ctx.baseUrl });
      const created = await client.tables.createView({
        tableId: table.id,
        view: {
          type: 'grid',
          name: 'sel_agg_filtered',
          sourceFilter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: qtyFieldId,
                operator: 'isGreaterEqual',
                value: 20,
              },
            ],
          },
          sort: [{ fieldId: qtyFieldId, order: 'desc' }],
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.error.message);

      const result = await aggregate({
        tableId: table.id,
        viewId: created.data.viewId,
        fields: [
          { fieldId: qtyFieldId, statisticFunc: 'sum' },
          { fieldId: qtyFieldId, statisticFunc: 'filled' },
        ],
        skip: 0,
        take: 2,
      });
      expect(findAgg(result, qtyFieldId, 'sum')).toBe(70);
      expect(findAgg(result, qtyFieldId, 'filled')).toBe(2);
    }, 30000);

    it('ignoreViewQuery bypasses the view filter and sees all rows', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Sel Agg Ignore ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'qty', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      const qtyFieldId = table.fields.find((field) => field.name === 'qty')?.id ?? '';
      await ctx.createRecords(
        table.id,
        [10, 20, 30, 40, null].map((qty, index) => ({
          fields: {
            [table.fields[0]!.id]: `r${index + 1}`,
            ...(qty != null ? { [qtyFieldId]: qty } : {}),
          },
        }))
      );
      await ctx.drainOutbox();
      const client = createV2HttpClient({ baseUrl: ctx.baseUrl });
      const created = await client.tables.createView({
        tableId: table.id,
        view: {
          type: 'grid',
          name: 'sel_agg_ignored',
          sourceFilter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: qtyFieldId,
                operator: 'isGreaterEqual',
                value: 999,
              },
            ],
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.error.message);

      const result = await aggregate({
        tableId: table.id,
        viewId: created.data.viewId,
        ignoreViewQuery: true,
        fields: [
          { fieldId: qtyFieldId, statisticFunc: 'sum' },
          { fieldId: qtyFieldId, statisticFunc: 'filled' },
        ],
        skip: 0,
        take: 5,
      });
      expect(findAgg(result, qtyFieldId, 'sum')).toBe(100);
      expect(findAgg(result, qtyFieldId, 'filled')).toBe(4);
    }, 30000);

    it('aggregates the full slice when no groups are collapsed', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Sel Agg Grouped ${Date.now()}`,
        fields: [
          { name: 'category', type: 'singleLineText', isPrimary: true },
          { name: 'qty', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      const categoryFieldId = table.fields.find((field) => field.name === 'category')?.id ?? '';
      const qtyFieldId = table.fields.find((field) => field.name === 'qty')?.id ?? '';
      await ctx.createRecords(
        table.id,
        [
          { category: 'A', qty: 10 },
          { category: 'A', qty: 20 },
          { category: 'A', qty: 30 },
          { category: 'B', qty: 100 },
          { category: 'B', qty: 200 },
        ].map((row) => ({
          fields: { [categoryFieldId]: row.category, [qtyFieldId]: row.qty },
        }))
      );
      await ctx.drainOutbox();

      const result = await aggregate({
        tableId: table.id,
        viewId: table.views[0].id,
        groupBy: [{ fieldId: categoryFieldId, order: 'asc' }],
        fields: [
          { fieldId: qtyFieldId, statisticFunc: 'sum' },
          { fieldId: qtyFieldId, statisticFunc: 'filled' },
        ],
        skip: 0,
        take: 5,
      });
      expect(findAgg(result, qtyFieldId, 'sum')).toBe(360);
      expect(findAgg(result, qtyFieldId, 'filled')).toBe(5);
    }, 30000);

    it('excludes records of collapsed groups so skip/take aligns with the visible slice', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Sel Agg Collapse ${Date.now()}`,
        fields: [
          { name: 'category', type: 'singleLineText', isPrimary: true },
          { name: 'qty', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      const categoryFieldId = table.fields.find((field) => field.name === 'category')?.id ?? '';
      const qtyFieldId = table.fields.find((field) => field.name === 'qty')?.id ?? '';
      await ctx.createRecords(
        table.id,
        [
          { category: 'A', qty: 10 },
          { category: 'A', qty: 20 },
          { category: 'A', qty: 30 },
          { category: 'B', qty: 100 },
          { category: 'B', qty: 200 },
        ].map((row) => ({
          fields: { [categoryFieldId]: row.category, [qtyFieldId]: row.qty },
        }))
      );
      await ctx.drainOutbox();
      const groupAId = String(hashGroupFlag(`${categoryFieldId}_A`));

      const result = await aggregate({
        tableId: table.id,
        viewId: table.views[0].id,
        groupBy: [{ fieldId: categoryFieldId, order: 'asc' }],
        collapsedGroupIds: [groupAId],
        fields: [
          { fieldId: qtyFieldId, statisticFunc: 'sum' },
          { fieldId: qtyFieldId, statisticFunc: 'filled' },
        ],
        skip: 0,
        take: 5,
      });
      expect(findAgg(result, qtyFieldId, 'sum')).toBe(300);
      expect(findAgg(result, qtyFieldId, 'filled')).toBe(2);
    }, 30000);

    it('applies search before skip/take so the slice is taken from matching rows', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Sel Agg Search ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'qty', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      const nameFieldId = table.fields.find((field) => field.name === 'Name')?.id ?? '';
      const qtyFieldId = table.fields.find((field) => field.name === 'qty')?.id ?? '';
      await ctx.createRecords(table.id, [
        { fields: { [nameFieldId]: 'no', [qtyFieldId]: 100 } },
        { fields: { [nameFieldId]: 'match', [qtyFieldId]: 20 } },
        { fields: { [nameFieldId]: 'match', [qtyFieldId]: 30 } },
      ]);
      await ctx.drainOutbox();

      const result = await aggregate({
        tableId: table.id,
        viewId: table.views[0].id,
        search: ['match', nameFieldId, true],
        fields: [
          { fieldId: qtyFieldId, statisticFunc: 'sum' },
          { fieldId: qtyFieldId, statisticFunc: 'filled' },
        ],
        skip: 0,
        take: 2,
      });
      expect(findAgg(result, qtyFieldId, 'sum')).toBe(50);
      expect(findAgg(result, qtyFieldId, 'filled')).toBe(2);
    }, 30000);

    it('ignoreViewQuery can aggregate a field hidden in the ignored view', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Sel Agg Hidden ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'qty', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      const qtyFieldId = table.fields.find((field) => field.name === 'qty')?.id ?? '';
      await ctx.createRecords(
        table.id,
        [10, 20, 30, 40, null].map((qty, index) => ({
          fields: {
            [table.fields[0]!.id]: `r${index + 1}`,
            ...(qty != null ? { [qtyFieldId]: qty } : {}),
          },
        }))
      );
      await ctx.drainOutbox();
      const client = createV2HttpClient({ baseUrl: ctx.baseUrl });
      const hidden = await client.tables.updateViewColumnMeta({
        tableId: table.id,
        viewId: table.views[0].id,
        columnMeta: [{ fieldId: qtyFieldId, columnMeta: { hidden: true } }],
      });
      expect(hidden.ok).toBe(true);

      const hiddenResult = await queryBus.execute<
        AggregateTableRecordsQuery,
        AggregateTableRecordsResult
      >(
        { actorId, windowId: 'e2e-window' },
        AggregateTableRecordsQuery.create({
          tableId: table.id,
          viewId: table.views[0].id,
          fields: [{ fieldId: qtyFieldId, statisticFunc: 'sum' }],
          skip: 0,
          take: 5,
        })._unsafeUnwrap()
      );
      expect(hiddenResult.isErr()).toBe(true);
      expect(hiddenResult._unsafeUnwrapErr()).toMatchObject({
        code: 'record_aggregation.field_hidden',
      });

      const result = await aggregate({
        tableId: table.id,
        viewId: table.views[0].id,
        ignoreViewQuery: true,
        fields: [
          { fieldId: qtyFieldId, statisticFunc: 'sum' },
          { fieldId: qtyFieldId, statisticFunc: 'filled' },
        ],
        skip: 0,
        take: 5,
      });
      expect(findAgg(result, qtyFieldId, 'sum')).toBe(100);
      expect(findAgg(result, qtyFieldId, 'filled')).toBe(4);
    }, 30000);

    it('ignoreViewQuery slices by auto number instead of the view row order', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Sel Agg Row ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'qty', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      const viewId = table.views[0].id;
      const qtyFieldId = table.fields.find((field) => field.name === 'qty')?.id ?? '';
      const records = await ctx.createRecords(
        table.id,
        [10, 20, 30].map((qty, index) => ({
          fields: {
            [table.fields[0]!.id]: `r${index + 1}`,
            [qtyFieldId]: qty,
          },
        }))
      );
      await ctx.drainOutbox();
      const lastRecordId = records[2]!.id;
      const firstRecordId = records[0]!.id;
      const reorder = await fetch(`${ctx.baseUrl}/tables/reorderRecords`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordIds: [lastRecordId],
          order: { viewId, anchorId: firstRecordId, position: 'before' },
        }),
      });
      expect(reorder.ok).toBe(true);
      await ctx.drainOutbox();

      const viewSlice = await aggregate({
        tableId: table.id,
        viewId,
        fields: [{ fieldId: qtyFieldId, statisticFunc: 'sum' }],
        skip: 0,
        take: 1,
      });
      expect(findAgg(viewSlice, qtyFieldId, 'sum')).toBe(30);

      const ignoredSlice = await aggregate({
        tableId: table.id,
        viewId,
        ignoreViewQuery: true,
        fields: [{ fieldId: qtyFieldId, statisticFunc: 'sum' }],
        skip: 0,
        take: 1,
      });
      expect(findAgg(ignoredSlice, qtyFieldId, 'sum')).toBe(10);
    }, 30000);

    it('ignoreViewQuery with omitted fields does not use view statistic defaults', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Sel Agg Defaults ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'qty', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      const qtyFieldId = table.fields.find((field) => field.name === 'qty')?.id ?? '';
      await ctx.createRecords(
        table.id,
        [10, 20, 30, 40, null].map((qty, index) => ({
          fields: {
            [table.fields[0]!.id]: `r${index + 1}`,
            ...(qty != null ? { [qtyFieldId]: qty } : {}),
          },
        }))
      );
      await ctx.drainOutbox();
      const client = createV2HttpClient({ baseUrl: ctx.baseUrl });
      const patched = await client.tables.updateViewColumnMeta({
        tableId: table.id,
        viewId: table.views[0].id,
        columnMeta: [{ fieldId: qtyFieldId, columnMeta: { statisticFunc: 'sum' } }],
      });
      expect(patched.ok).toBe(true);

      const fromView = await aggregate({
        tableId: table.id,
        viewId: table.views[0].id,
        skip: 0,
        take: 5,
      });
      expect(findAgg(fromView, qtyFieldId, 'sum')).toBe(100);

      const ignored = await aggregate({
        tableId: table.id,
        viewId: table.views[0].id,
        ignoreViewQuery: true,
        skip: 0,
        take: 5,
      });
      expect(ignored.values).toEqual([]);
    }, 30000);
  });

  describe('aggregation contract errors', () => {
    it('rejects invalid fields and unsupported functions', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Aggregation Errors ${Date.now()}`,
        fields: [{ name: 'Name', type: 'singleLineText', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const fieldId = table.fields.find((field) => field.name === 'Name')?.id ?? '';

      await expect(
        aggregate({
          tableId: table.id,
          viewId: table.views[0].id,
          fields: [{ fieldId: `fld${'f'.repeat(16)}`, statisticFunc: 'count' }],
        })
      ).rejects.toThrow();
      await expect(
        aggregate({
          tableId: table.id,
          viewId: table.views[0].id,
          fields: [{ fieldId, statisticFunc: 'sum' }],
        })
      ).rejects.toThrow();
    });

    it('rejects invalid table and view identifiers', async () => {
      await expect(
        aggregate({
          tableId: 'invalid-table-id',
          viewId: `viw${'f'.repeat(16)}`,
        })
      ).rejects.toThrow();
      await expect(
        aggregate({
          tableId: `tbl${'f'.repeat(16)}`,
          viewId: 'invalid-view-id',
        })
      ).rejects.toThrow();
    });
  });

  // ----------------------------------------------------------------
  // T6520: clearing values ("" / false) stores NULL → Empty / UnChecked
  // ----------------------------------------------------------------
  describe('T6520 cleared-value semantics', () => {
    it('counts cleared "" and false as Empty / UnChecked', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Aggregation T6520 ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Done', type: 'checkbox' },
        ],
        views: [{ type: 'grid' }],
      });
      const tableId = table.id;
      const viewId = table.views[0].id;
      const nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      const doneFieldId = table.fields.find((f) => f.name === 'Done')?.id ?? '';

      const records = await ctx.createRecords(tableId, [
        { fields: { [nameFieldId]: 'A', [doneFieldId]: true } },
        { fields: { [nameFieldId]: 'B', [doneFieldId]: true } },
        { fields: { [nameFieldId]: 'C', [doneFieldId]: true } },
      ]);
      await ctx.drainOutbox();

      // Baseline: everything filled/checked.
      expect(Number(await aggregateValue(tableId, viewId, nameFieldId, 'empty'))).toBe(0);
      expect(Number(await aggregateValue(tableId, viewId, doneFieldId, 'checked'))).toBe(3);

      // Clear record B: "" and false must store NULL (T6520).
      await ctx.updateRecord(tableId, records[1].id, {
        [nameFieldId]: '',
        [doneFieldId]: false,
      });
      await ctx.drainOutbox();

      expect(Number(await aggregateValue(tableId, viewId, nameFieldId, 'empty'))).toBe(1);
      expect(Number(await aggregateValue(tableId, viewId, nameFieldId, 'filled'))).toBe(2);
      expect(Number(await aggregateValue(tableId, viewId, doneFieldId, 'checked'))).toBe(2);
      expect(Number(await aggregateValue(tableId, viewId, doneFieldId, 'unChecked'))).toBe(1);
    }, 30000);
  });
});
