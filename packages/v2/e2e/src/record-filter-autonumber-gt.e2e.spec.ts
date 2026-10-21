/* eslint-disable @typescript-eslint/naming-convention */
import { listTableRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * T7071: autoNumber view-filter UI falls through to FilterInput and sends a
 * string ("50"), not a number. v2 numeric comparison rejected that payload
 * with "Record condition requires numeric value".
 *
 * Fixture is sanitized and structure-equivalent: autoNumber field, isGreater
 * operator, string numeric value on listRecords (same WHERE visitor as
 * row-count).
 */
describe('T7071: autoNumber greater-than filter with string value (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let autoNumberFieldId: string;

  const listRecordsWithFilter = async (filter: unknown) => {
    await ctx.drainOutbox();

    const params = new URLSearchParams({
      tableId,
      fieldKeyType: FieldKeyType.Id,
      filter: JSON.stringify(filter),
    });

    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });

    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`ListRecords failed: ${JSON.stringify(rawBody)}`);
    }

    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`ListRecords response invalid: ${JSON.stringify(rawBody)}`);
    }

    return parsed.data.data.records;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T7071 AutoNumber Gt Filter',
      fields: [
        { name: 'Title', type: 'singleLineText', isPrimary: true },
        { name: 'No.', type: 'autoNumber' },
      ],
      views: [{ type: 'grid' }],
    });

    tableId = table.id;
    autoNumberFieldId = table.fields.find((field) => field.name === 'No.')?.id ?? '';
    const titleFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    if (!autoNumberFieldId || !titleFieldId) {
      throw new Error('Required field ids not found');
    }

    for (const title of ['A', 'B', 'C', 'D', 'E']) {
      await ctx.createRecord(tableId, { [titleFieldId]: title });
    }
  }, 30000);

  afterAll(async () => {
    if (tableId) {
      await ctx.deleteTable(tableId, { mode: 'permanent' });
    }
  });

  it('filters autoNumber isGreater with a string numeric value', async () => {
    const records = await listRecordsWithFilter({
      conjunction: 'and',
      filterSet: [{ fieldId: autoNumberFieldId, operator: 'isGreater', value: '2' }],
    });

    const numbers = records
      .map((record) => record.fields[autoNumberFieldId] as number)
      .sort((left, right) => left - right);
    expect(numbers).toEqual([3, 4, 5]);
  });
});
