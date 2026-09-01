/* eslint-disable @typescript-eslint/naming-convention */
import {
  createRecordsOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
} from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
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

  const maxActualRows = (plan: unknown): number => {
    if (!plan || typeof plan !== 'object') {
      return 0;
    }
    const node = plan as { 'Actual Rows'?: number; Plans?: unknown[] };
    let highest = typeof node['Actual Rows'] === 'number' ? node['Actual Rows'] : 0;
    for (const child of node.Plans ?? []) {
      const childRows = maxActualRows(child);
      if (childRows > highest) {
        highest = childRows;
      }
    }
    return highest;
  };

  const explainSelect = async (options: {
    physicalTable: string;
    limit: number;
    offset?: number;
    afterAutoNumber?: number;
  }) => {
    const result =
      options.afterAutoNumber != null
        ? await sql<{ 'QUERY PLAN': unknown }>`
            EXPLAIN (ANALYZE, FORMAT JSON)
            SELECT __id
            FROM ${sql.table(options.physicalTable)} AS t
            WHERE t.__auto_number > ${options.afterAutoNumber}
            ORDER BY t.__auto_number ASC
            LIMIT ${options.limit}
          `.execute(ctx.testContainer.db)
        : await sql<{ 'QUERY PLAN': unknown }>`
            EXPLAIN (ANALYZE, FORMAT JSON)
            SELECT __id
            FROM ${sql.table(options.physicalTable)} AS t
            ORDER BY t.__auto_number ASC
            LIMIT ${options.limit}
            OFFSET ${options.offset ?? 0}
          `.execute(ctx.testContainer.db);
    const queryPlan = result.rows[0]?.['QUERY PLAN'];
    const root = Array.isArray(queryPlan) ? queryPlan[0] : queryPlan;
    if (root && typeof root === 'object' && 'Plan' in root) {
      return (root as { Plan: unknown }).Plan;
    }
    return root;
  };

  const median = (samples: number[]): number => {
    const sorted = [...samples].sort((left, right) => left - right);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1]! + sorted[mid]!) / 2;
    }
    return sorted[mid]!;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
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

    const physicalTable = `${ctx.baseId}.${table.id}`;
    const cursorRow = await sql<{ __auto_number: number }>`
      SELECT __auto_number
      FROM ${sql.table(physicalTable)}
      ORDER BY __auto_number ASC
      OFFSET ${unfilteredSkip - 1}
      LIMIT 1
    `.execute(ctx.testContainer.db);
    const unfilteredCursor = String(cursorRow.rows[0]?.__auto_number);
    expect(unfilteredCursor).not.toBe('undefined');

    const unfilteredOffsetPage = await listRecords(table.id, {
      limit: String(limit),
      offset: String(unfilteredSkip),
    });
    const unfilteredCursorPage = await listRecords(table.id, {
      limit: String(limit),
      cursor: unfilteredCursor,
    });
    expect(unfilteredCursorPage.records.map((record) => record.id)).toEqual(
      unfilteredOffsetPage.records.map((record) => record.id)
    );
    expect(unfilteredCursorPage.records).toHaveLength(limit);

    const offsetPlan = await explainSelect({
      physicalTable,
      limit,
      offset: unfilteredSkip,
    });
    const cursorPlan = await explainSelect({
      physicalTable,
      limit,
      afterAutoNumber: Number(unfilteredCursor),
    });
    expect(maxActualRows(cursorPlan)).toBeLessThanOrEqual(limit + 2);
    expect(maxActualRows(offsetPlan)).toBeGreaterThan(unfilteredSkip);

    const keepFilter = JSON.stringify({
      conjunction: 'and',
      filterSet: [{ fieldId: nameFieldId, operator: 'contains', value: 'keep-' }],
    });
    const groupBy = JSON.stringify([statusFieldId]);
    const sort = JSON.stringify([{ fieldId: rankFieldId, order: 'desc' }]);
    const orderedQuery = {
      filter: keepFilter,
      groupBy,
      sort,
    };

    const beforePage = await listRecords(table.id, {
      ...orderedQuery,
      limit: '1',
      offset: String(filteredSkip - 1),
    });
    expect(beforePage.pagination.nextCursor).toBeTruthy();
    const filteredCursor = beforePage.pagination.nextCursor!;

    const filteredOffsetPage = await listRecords(table.id, {
      ...orderedQuery,
      limit: String(limit),
      offset: String(filteredSkip),
    });
    const filteredCursorPage = await listRecords(table.id, {
      ...orderedQuery,
      limit: String(limit),
      cursor: filteredCursor,
    });
    expect(filteredCursorPage.records.map((record) => record.id)).toEqual(
      filteredOffsetPage.records.map((record) => record.id)
    );
    expect(filteredCursorPage.records).toHaveLength(limit);
    expect(
      filteredCursorPage.records.every((record) =>
        String(record.fields[nameFieldId!]).startsWith('keep-')
      )
    ).toBe(true);

    await listRecords(table.id, {
      ...orderedQuery,
      limit: String(limit),
      offset: String(filteredSkip),
    });
    await listRecords(table.id, {
      ...orderedQuery,
      limit: String(limit),
      cursor: filteredCursor,
    });
    const offsetSamples: number[] = [];
    const cursorSamples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const offsetStarted = performance.now();
      await listRecords(table.id, {
        ...orderedQuery,
        limit: String(limit),
        offset: String(filteredSkip),
      });
      offsetSamples.push(performance.now() - offsetStarted);
      const cursorStarted = performance.now();
      await listRecords(table.id, {
        ...orderedQuery,
        limit: String(limit),
        cursor: filteredCursor,
      });
      cursorSamples.push(performance.now() - cursorStarted);
    }
    const offsetMedian = median(offsetSamples);
    const cursorMedian = median(cursorSamples);
    expect(
      cursorMedian,
      `filter/group/sort HTTP median cursor=${cursorMedian.toFixed(2)}ms offset=${offsetMedian.toFixed(2)}ms samples cursor=${cursorSamples.join(',')} offset=${offsetSamples.join(',')}`
    ).toBeLessThan(offsetMedian);
  }, 180_000);
});
