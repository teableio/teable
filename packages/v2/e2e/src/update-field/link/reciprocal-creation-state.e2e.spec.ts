import { createTablesOkResponseSchema } from '@teable/v2-contract-http';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('mutually referencing tables', () => {
  let ctx: SharedTestContext;
  const cleanupTableIds: string[] = [];

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  afterEach(async () => {
    for (const tableId of cleanupTableIds.splice(0)) {
      await ctx.deleteTable(tableId, { mode: 'permanent' });
    }
  });

  test('keeps every reciprocal field in the createTables response and in storage', async () => {
    const response = await fetch(`${ctx.baseUrl}/tables/createTables`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tables: [
          {
            tableId: `tbl${'a'.repeat(16)}`,
            name: 'Cycle left',
            fields: [
              { id: `fld${'a'.repeat(16)}`, type: 'singleLineText', name: 'Name', isPrimary: true },
              {
                id: `fld${'c'.repeat(16)}`,
                type: 'link',
                name: 'Link to right',
                options: {
                  foreignTableId: `tbl${'b'.repeat(16)}`,
                  lookupFieldId: `fld${'b'.repeat(16)}`,
                  relationship: 'manyMany',
                  isOneWay: false,
                },
              },
            ],
          },
          {
            tableId: `tbl${'b'.repeat(16)}`,
            name: 'Cycle right',
            fields: [
              { id: `fld${'b'.repeat(16)}`, type: 'singleLineText', name: 'Name', isPrimary: true },
              {
                id: `fld${'d'.repeat(16)}`,
                type: 'link',
                name: 'Link to left',
                options: {
                  foreignTableId: `tbl${'a'.repeat(16)}`,
                  lookupFieldId: `fld${'a'.repeat(16)}`,
                  relationship: 'manyMany',
                  isOneWay: false,
                },
              },
            ],
          },
        ],
      }),
    });
    const raw = await response.json();
    expect(response.status, JSON.stringify(raw)).toBe(201);
    const parsed = createTablesOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) throw new Error(JSON.stringify(raw));
    expect(parsed.data.data.tables.map((table) => table.fields.length)).toEqual([3, 3]);

    for (const table of parsed.data.data.tables) {
      cleanupTableIds.push(table.id);
      const fresh = await ctx.getTableById(table.id);
      const liveFieldIds = fresh.fields.map((field) => field.id).sort();
      expect(table.fields.map((field) => field.id).sort()).toEqual(liveFieldIds);
      const stored = await ctx.testContainer.db
        .selectFrom('view')
        .select('column_meta')
        .where('table_id', '=', table.id)
        .where('deleted_time', 'is', null)
        .execute();
      expect(stored.length).toBeGreaterThan(0);
      for (const view of stored) {
        expect(Object.keys(JSON.parse(view.column_meta)).sort()).toEqual(liveFieldIds);
      }
    }
  });
});
