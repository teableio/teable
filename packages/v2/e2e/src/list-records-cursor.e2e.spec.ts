/* eslint-disable @typescript-eslint/naming-convention */
import {
  createRecordsOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
} from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { CompiledQuery } from 'kysely';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http list records cursor pagination (e2e)', () => {
  let ctx: SharedTestContext;

  const createTable = async (payload: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const raw = await response.json();
    expect(response.status).toBe(201);
    const parsed = createTableOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Create table failed: ${JSON.stringify(raw)}`);
    }
    return parsed.data.data.table;
  };

  const createRecords = async (
    tableId: string,
    records: Array<{ fields: Record<string, unknown> }>
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, records }),
    });
    const raw = await response.json();
    expect(response.status).toBe(201);
    const parsed = createRecordsOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Create records failed: ${JSON.stringify(raw)}`);
    }
    return parsed.data.data.records;
  };

  const listRecords = async (tableId: string, query: Record<string, string>) => {
    const params = new URLSearchParams({
      tableId,
      fieldKeyType: FieldKeyType.Id,
      ...query,
    });
    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    const raw = await response.json();
    const parsed = listTableRecordsOkResponseSchema.safeParse(raw);
    expect(parsed.success, JSON.stringify(raw)).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`List records failed: ${JSON.stringify(raw)}`);
    }
    return parsed.data.data;
  };

  const captureListRecords = async (tableId: string, query: Record<string, string>) => {
    const queries: CompiledQuery[] = [];
    const executor = ctx.testContainer.db.getExecutor();
    const executeQuery = executor.executeQuery.bind(executor);
    const querySpy = vi
      .spyOn(executor, 'executeQuery')
      .mockImplementation(<R>(...args: Parameters<typeof executor.executeQuery>) =>
        executeQuery<R>(...args).then((result) => {
          // Group metadata reads touch the same table but do not return record IDs.
          if (
            args[0].sql.includes(`"${ctx.baseId}"."${tableId}"`) &&
            result.rows.some((row) => Object.prototype.hasOwnProperty.call(row, '__id'))
          ) {
            queries.push(args[0]);
          }
          return result;
        })
      );
    try {
      const page = await listRecords(tableId, query);
      expect(
        queries,
        `Expected one HTTP page statement: ${queries.map(({ sql }) => sql).join('\n')}`
      ).toHaveLength(1);
      return { page, query: queries[0]! };
    } finally {
      querySpy.mockRestore();
    }
  };

  type PlanNode = {
    'Node Type': string;
    'Relation Name'?: string;
    'Actual Rows': number;
    'Actual Loops': number;
    'Rows Removed by Filter'?: number;
    'Index Cond'?: string;
    'Sort Key'?: string[];
    Plans?: PlanNode[];
  };

  const planNodes = (node: PlanNode): PlanNode[] => [
    node,
    ...(node.Plans ?? []).flatMap(planNodes),
  ];

  const explainPage = async (query: CompiledQuery): Promise<PlanNode> => {
    const result = await ctx.testContainer.db.executeQuery<{
      'QUERY PLAN': Array<{ Plan: PlanNode }>;
    }>(CompiledQuery.raw(`EXPLAIN (ANALYZE, FORMAT JSON) ${query.sql}`, [...query.parameters]));
    const plan = result.rows[0]?.['QUERY PLAN']?.[0]?.Plan;
    if (!plan) throw new Error(`Missing HTTP page plan: ${JSON.stringify(result.rows)}`);
    return plan;
  };

  const scannedRows = (plan: PlanNode, tableId: string): number => {
    const scans = planNodes(plan).filter(
      (node) => node['Relation Name'] === tableId && node['Node Type'].includes('Scan')
    );
    expect(scans.length, JSON.stringify(plan)).toBeGreaterThan(0);
    // Native page selection and record hydration can each scan one page. Bound
    // the largest scan, including repeated nested-loop probes, not their sum.
    return Math.max(
      ...scans.map(
        (node) =>
          (node['Actual Rows'] + (node['Rows Removed by Filter'] ?? 0)) * node['Actual Loops']
      )
    );
  };

  const rowsEnteringPageSort = (plan: PlanNode, tableId: string): number => {
    // The native query may sort the hydrated page again. Measure the largest
    // order-sort input so that final page-sized reorder cannot hide deep work.
    const sorts = planNodes(plan).filter(
      (node) =>
        node['Sort Key']?.length &&
        (node.Plans ?? []).some((child) =>
          planNodes(child).some((descendant) => descendant['Relation Name'] === tableId)
        )
    );
    if (!sorts.length) {
      throw new Error(`Expected an HTTP page order sort with table input: ${JSON.stringify(plan)}`);
    }
    return Math.max(
      ...sorts.map((sort) =>
        sort.Plans!.reduce(
          (total, child) => total + child['Actual Rows'] * child['Actual Loops'],
          0
        )
      )
    );
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(['postgres:', 'postgresql:']).toContain(
      new URL(ctx.testContainer.connectionString).protocol
    );
  });

  it('pages with cursor instead of offset and skips count(*) by default', async () => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: 'List Cursor Test',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'Notes' },
      ],
      views: [{ type: 'grid' }],
    });
    const nameFieldId = table.fields.find((field) => field.name === 'Name')?.id;
    const notesFieldId = table.fields.find((field) => field.name === 'Notes')?.id;
    expect(nameFieldId).toBeTruthy();
    expect(notesFieldId).toBeTruthy();

    const created = await createRecords(
      table.id,
      ['A', 'B', 'C', 'D', 'E'].map((name) => ({
        fields: { [nameFieldId!]: name, [notesFieldId!]: `${name}-notes` },
      }))
    );
    expect(created).toHaveLength(5);

    const firstPage = await listRecords(table.id, { limit: '2' });
    expect(firstPage.records).toHaveLength(2);
    expect(firstPage.pagination.hasMore).toBe(true);
    expect(firstPage.pagination.nextCursor).toBeTruthy();
    expect(firstPage.pagination.total).toBe(2);

    const counted = await listRecords(table.id, { limit: '2', includeTotal: 'true' });
    expect(counted.pagination.total).toBe(5);

    const secondPage = await listRecords(table.id, {
      limit: '2',
      cursor: firstPage.pagination.nextCursor!,
    });
    expect(secondPage.records).toHaveLength(2);
    const firstIds = new Set(firstPage.records.map((record) => record.id));
    expect(secondPage.records.every((record) => !firstIds.has(record.id))).toBe(true);

    const thirdPage = await listRecords(table.id, {
      limit: '2',
      cursor: secondPage.pagination.nextCursor!,
    });
    expect(thirdPage.records).toHaveLength(1);
    expect(thirdPage.pagination.hasMore).toBe(false);
    expect(thirdPage.pagination.nextCursor).toBeUndefined();

    const allIds = [...firstPage.records, ...secondPage.records, ...thirdPage.records].map(
      (record) => record.id
    );
    expect(new Set(allIds).size).toBe(5);

    const projected = await listRecords(table.id, {
      limit: '5',
      projection: JSON.stringify([nameFieldId]),
    });
    expect(projected.records.length).toBeGreaterThan(0);
    for (const record of projected.records) {
      expect(record.fields).toHaveProperty(nameFieldId!);
      expect(record.fields).not.toHaveProperty(notesFieldId!);
    }
  });

  it('rejects cursor combined with a positive offset', async () => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: 'List Cursor Offset Conflict',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const params = new URLSearchParams({
      tableId: table.id,
      fieldKeyType: FieldKeyType.Id,
      limit: '2',
      offset: '1',
      cursor: '1',
    });
    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('matches offset results at a deep page with filter group and sort', async () => {
    const rowCount = 5000;
    const unfilteredSkip = 4000;
    const filteredSkip = 2000;
    const limit = 50;
    const table = await createTable({
      baseId: ctx.baseId,
      name: 'List Cursor Deep Page',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'Status' },
        { type: 'number', name: 'Rank' },
      ],
      views: [{ type: 'grid' }],
    });
    const nameFieldId = table.fields.find((field) => field.name === 'Name')?.id;
    const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id;
    const rankFieldId = table.fields.find((field) => field.name === 'Rank')?.id;
    expect(nameFieldId).toBeTruthy();
    expect(statusFieldId).toBeTruthy();
    expect(rankFieldId).toBeTruthy();

    const statuses = ['A', 'B', 'C'] as const;
    for (let start = 0; start < rowCount; start += 250) {
      const batch = Array.from({ length: Math.min(250, rowCount - start) }, (_, index) => {
        const n = start + index;
        return {
          fields: {
            [nameFieldId!]: n % 2 === 0 ? `keep-${n}` : `drop-${n}`,
            [statusFieldId!]: statuses[n % statuses.length],
            [rankFieldId!]: n % 17,
          },
        };
      });
      await createRecords(table.id, batch);
    }

    const { page: unfilteredBeforePage } = await captureListRecords(table.id, {
      limit: '1',
      offset: String(unfilteredSkip - 1),
    });
    expect(unfilteredBeforePage.pagination.nextCursor).toBeTruthy();
    const unfilteredCursor = unfilteredBeforePage.pagination.nextCursor!;

    const { page: unfilteredOffsetPage, query: offsetQuery } = await captureListRecords(table.id, {
      limit: String(limit),
      offset: String(unfilteredSkip),
    });
    const { page: unfilteredCursorPage, query: cursorQuery } = await captureListRecords(table.id, {
      limit: String(limit),
      cursor: unfilteredCursor,
    });
    expect(unfilteredCursorPage.records.map((record) => record.id)).toEqual(
      unfilteredOffsetPage.records.map((record) => record.id)
    );
    expect(unfilteredCursorPage.records).toHaveLength(limit);

    const offsetPlan = await explainPage(offsetQuery);
    const cursorPlan = await explainPage(cursorQuery);
    expect(scannedRows(cursorPlan, table.id), JSON.stringify(cursorPlan)).toBeLessThanOrEqual(
      limit + 2
    );
    expect(scannedRows(offsetPlan, table.id), JSON.stringify(offsetPlan)).toBeGreaterThan(
      unfilteredSkip
    );
    expect(
      planNodes(cursorPlan).some(
        (node) =>
          node['Relation Name'] === table.id &&
          node['Index Cond']?.includes('__auto_number') &&
          node['Index Cond'].includes('>')
      ),
      JSON.stringify(cursorPlan)
    ).toBe(true);

    const keepFilter = JSON.stringify({
      conjunction: 'and',
      filterSet: [{ fieldId: nameFieldId, operator: 'contains', value: 'keep-' }],
    });
    const groupBy = JSON.stringify([statusFieldId]);
    const sort = JSON.stringify([{ fieldId: rankFieldId, order: 'desc' }]);
    const orderedQuery = {
      filter: keepFilter,
      groupBy,
      includeGroups: 'true',
      sort,
    };

    const { page: beforePage } = await captureListRecords(table.id, {
      ...orderedQuery,
      limit: '1',
      offset: String(filteredSkip - 1),
    });
    expect(beforePage.records).toHaveLength(1);
    expect(beforePage.pagination.nextCursor).toBeTruthy();
    const filteredCursor = beforePage.pagination.nextCursor!;

    const { page: filteredOffsetPage, query: filteredOffsetQuery } = await captureListRecords(
      table.id,
      {
        ...orderedQuery,
        limit: String(limit),
        offset: String(filteredSkip),
      }
    );
    const { page: filteredCursorPage, query: filteredCursorQuery } = await captureListRecords(
      table.id,
      {
        ...orderedQuery,
        limit: String(limit),
        cursor: filteredCursor,
      }
    );
    expect(filteredCursorPage.records.map((record) => record.id)).toEqual(
      filteredOffsetPage.records.map((record) => record.id)
    );
    expect(filteredCursorPage.records).toHaveLength(limit);
    expect(
      filteredCursorPage.records.every((record) =>
        String(record.fields[nameFieldId!]).startsWith('keep-')
      )
    ).toBe(true);

    expect(filteredCursorPage.groups).toEqual(filteredOffsetPage.groups);
    expect(filteredCursorPage.groups).toEqual(
      statuses.map((status, index) => ({
        fields: { [statusFieldId!]: status },
        count: index === 0 ? 834 : 833,
      }))
    );

    const filteredOffsetPlan = await explainPage(filteredOffsetQuery);
    const filteredCursorPlan = await explainPage(filteredCursorQuery);
    // Mixed-direction lexicographic OR predicates can still scan all 5,000 rows.
    // The contract is fewer candidates entering the sort, not faster HTTP wall time.
    const offsetSortRows = rowsEnteringPageSort(filteredOffsetPlan, table.id);
    const cursorSortRows = rowsEnteringPageSort(filteredCursorPlan, table.id);
    expect(offsetSortRows, JSON.stringify(filteredOffsetPlan)).toBe(rowCount / 2);
    expect(cursorSortRows, JSON.stringify(filteredCursorPlan)).toBe(rowCount / 2 - filteredSkip);
    expect(cursorSortRows).toBeLessThan(offsetSortRows);

    // Only mutate after both baseline pages and their plans: the emitted cursor must
    // remain usable without looking up the deleted bookmark record.
    await ctx.deleteRecord(table.id, beforePage.records[0]!.id);
    const { page: afterBookmarkDeletion } = await captureListRecords(table.id, {
      ...orderedQuery,
      limit: String(limit),
      cursor: filteredCursor,
    });
    expect(afterBookmarkDeletion.records.map((record) => record.id)).toEqual(
      filteredCursorPage.records.map((record) => record.id)
    );
  }, 180_000);

  it('reports hasMore instead of ending the list when a cursor would be oversized', async () => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: 'List Cursor Oversized Value',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'longText', name: 'Notes' },
      ],
      views: [{ type: 'grid' }],
    });
    const notesFieldId = table.fields.find((field) => field.name === 'Notes')?.id;
    expect(notesFieldId).toBeTruthy();
    const longNote = 'L'.repeat(3100);

    await createRecords(
      table.id,
      Array.from({ length: 3 }, (_, index) => ({
        fields: { [notesFieldId!]: `${longNote}${index}` },
      }))
    );

    const sort = JSON.stringify([{ fieldId: notesFieldId, order: 'asc' }]);
    const firstPage = await listRecords(table.id, { limit: '1', sort });
    expect(firstPage.records).toHaveLength(1);
    // The sort value does not fit the cursor contract, so no cursor is handed out — but
    // the page came back full and the client has to keep paging by offset.
    expect(firstPage.pagination.nextCursor).toBeUndefined();
    expect(firstPage.pagination.hasMore).toBe(true);

    const secondPage = await listRecords(table.id, { limit: '1', offset: '1', sort });
    expect(secondPage.records).toHaveLength(1);
    expect(secondPage.records[0]!.id).not.toBe(firstPage.records[0]!.id);
  });
});
