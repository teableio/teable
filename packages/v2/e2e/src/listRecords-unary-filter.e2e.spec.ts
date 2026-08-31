/* eslint-disable @typescript-eslint/naming-convention */
import { listTableRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 listRecords unary filter operators (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let statusFieldId: string;

  const drainOutbox = async (rounds = 10) => {
    for (let i = 0; i < rounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  const listRecordsWithFilter = async (filter: unknown) => {
    await drainOutbox();

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
      name: 'V2 Unary Filter Table',
      fields: [
        { name: 'Name', type: 'singleLineText', isPrimary: true },
        { name: 'Status', type: 'singleSelect', options: ['Day0 sent', 'Pending'] },
      ],
      views: [{ type: 'grid' }],
    });

    tableId = table.id;

    const nameFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';

    if (!nameFieldId || !statusFieldId) {
      throw new Error('Required field ids not found');
    }

    await ctx.createRecord(tableId, {
      [nameFieldId]: 'Has Status',
      [statusFieldId]: 'Day0 sent',
    });
    await ctx.createRecord(tableId, {
      [nameFieldId]: 'No Status',
    });
  }, 30000);

  it('supports isNotEmpty without explicit value', async () => {
    const records = await listRecordsWithFilter({
      fieldId: statusFieldId,
      operator: 'isNotEmpty',
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.fields?.[statusFieldId]).toBe('Day0 sent');
  });

  it('supports isEmpty without explicit value', async () => {
    const records = await listRecordsWithFilter({
      fieldId: statusFieldId,
      operator: 'isEmpty',
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.fields?.[statusFieldId] ?? null).toBeNull();
  });

  /**
   * Cells cleared with "" (text) or [] (multi-value) are stored as null
   * (T6520), so unary emptiness filters must treat them as empty.
   * v1 reference: record-filter-query.e2e-spec isEmpty/isNotEmpty cases.
   */
  it('treats cells cleared with "" and [] as empty', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'V2 Unary Filter Cleared Cells',
      fields: [
        { name: 'Name', type: 'singleLineText', isPrimary: true },
        { name: 'Text', type: 'singleLineText' },
        { name: 'Tags', type: 'multipleSelect', options: ['A'] },
      ],
      views: [{ type: 'grid' }],
    });
    const nameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
    const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';
    const tagsFieldId = table.fields.find((f) => f.name === 'Tags')?.id ?? '';

    const filled = await ctx.createRecord(table.id, {
      [nameFieldId]: 'filled',
      [textFieldId]: 'value',
      [tagsFieldId]: ['A'],
    });
    const cleared = await ctx.createRecord(table.id, {
      [nameFieldId]: 'cleared',
      [textFieldId]: 'temp',
      [tagsFieldId]: ['A'],
    });
    const untouched = await ctx.createRecord(table.id, { [nameFieldId]: 'untouched' });

    await ctx.updateRecord(table.id, cleared.id, { [textFieldId]: '', [tagsFieldId]: [] });

    const listWithFilter = async (filter: unknown) => {
      const params = new URLSearchParams({
        tableId: table.id,
        fieldKeyType: FieldKeyType.Id,
        filter: JSON.stringify(filter),
      });
      const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
        method: 'GET',
        headers: { 'content-type': 'application/json' },
      });
      const rawBody = await response.json();
      expect(response.status).toBe(200);
      const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) throw new Error('listRecords failed');
      return parsed.data.data.records;
    };

    const emptyText = await listWithFilter({ fieldId: textFieldId, operator: 'isEmpty' });
    expect(emptyText.map((r) => r.id).sort()).toEqual([cleared.id, untouched.id].sort());

    const notEmptyText = await listWithFilter({ fieldId: textFieldId, operator: 'isNotEmpty' });
    expect(notEmptyText.map((r) => r.id)).toEqual([filled.id]);

    const emptyTags = await listWithFilter({ fieldId: tagsFieldId, operator: 'isEmpty' });
    expect(emptyTags.map((r) => r.id).sort()).toEqual([cleared.id, untouched.id].sort());
  });

  /**
   * v1 reference: record.e2e-spec.ts:92 — listRecords with a projection
   * returns only the projected field in each record's fields map.
   */
  it('returns only projected fields when projection is provided', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'V2 ListRecords Projection',
      fields: [
        { name: 'Name', type: 'singleLineText', isPrimary: true },
        { name: 'Count', type: 'number' },
      ],
      views: [{ type: 'grid' }],
    });
    const nameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
    const countFieldId = table.fields.find((f) => f.name === 'Count')?.id ?? '';

    await ctx.createRecord(table.id, { [nameFieldId]: 'text', [countFieldId]: 1 });

    const params = new URLSearchParams({
      tableId: table.id,
      fieldKeyType: FieldKeyType.Id,
      projection: JSON.stringify([nameFieldId]),
    });
    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const rawBody = await response.json();
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;

    const records = parsed.data.data.records;
    expect(records.length).toBeGreaterThan(0);
    expect(Object.keys(records[0]?.fields ?? {})).toEqual([nameFieldId]);
    expect(records[0]?.fields[nameFieldId]).toBe('text');
  });
});
