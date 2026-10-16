import {
  createRecordsOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
} from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('date field format and timezone (T7814 T7815 T7817 T7818)', () => {
  let ctx: SharedTestContext;

  const uniqueName = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  const createTable = async (payload: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const rawBody = await response.json();
    expect(response.status).toBe(201);
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to parse create table response: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.table;
  };

  const createRecords = async (
    tableId: string,
    records: Array<{ fields: Record<string, unknown> }>,
    typecast: boolean
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        records,
        typecast,
        fieldKeyType: FieldKeyType.Id,
      }),
    });
    const rawBody = await response.json();
    return { status: response.status, rawBody };
  };

  const listFieldValue = async (tableId: string, recordId: string, fieldId: string) => {
    const params = new URLSearchParams({ tableId, fieldKeyType: FieldKeyType.Id });
    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    const rawBody = await response.json();
    expect(response.status).toBe(200);
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to parse list records response: ${JSON.stringify(rawBody)}`);
    }
    const record = parsed.data.data.records.find((item) => item.id === recordId);
    return record?.fields[fieldId];
  };

  it('T7814 parses D/M/YYYY with typecast in the field timezone', async () => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: uniqueName('t7814-dmY'),
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'date',
          name: 'Date',
          options: {
            formatting: { date: 'D/M/YYYY', time: 'None', timeZone: 'Asia/Shanghai' },
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const dateFieldId = table.fields.find((field) => field.name === 'Date')?.id ?? '';
    const created = await createRecords(
      table.id,
      [{ fields: { [dateFieldId]: '04/03/2024' } }],
      true
    );
    expect(created.status).toBe(201);
    const parsed = createRecordsOkResponseSchema.safeParse(created.rawBody);
    expect(parsed.success && parsed.data.ok).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;
    const recordId = parsed.data.data.records[0]?.id ?? '';
    expect(parsed.data.data.records[0]?.fields[dateFieldId]).toBe('2024-03-03T16:00:00.000Z');
    expect(await listFieldValue(table.id, recordId, dateFieldId)).toBe('2024-03-03T16:00:00.000Z');
  });

  it('T7815 parses D/M/YYYY without typecast instead of rejecting non-ISO text', async () => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: uniqueName('t7815-dmY'),
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'date',
          name: 'Date',
          options: {
            formatting: { date: 'D/M/YYYY', time: 'None', timeZone: 'Asia/Shanghai' },
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const dateFieldId = table.fields.find((field) => field.name === 'Date')?.id ?? '';
    const created = await createRecords(
      table.id,
      [{ fields: { [dateFieldId]: '15/03/2024' } }],
      false
    );
    expect(created.status).toBe(201);
    const parsed = createRecordsOkResponseSchema.safeParse(created.rawBody);
    expect(parsed.success && parsed.data.ok).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;
    const recordId = parsed.data.data.records[0]?.id ?? '';
    expect(parsed.data.data.records[0]?.fields[dateFieldId]).toBe('2024-03-14T16:00:00.000Z');
    expect(await listFieldValue(table.id, recordId, dateFieldId)).toBe('2024-03-14T16:00:00.000Z');
  });

  it('T7817 formats a date as text in the field timezone', async () => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: uniqueName('t7817-date-text'),
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'date',
          name: 'Date',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'Asia/Tokyo' },
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const dateFieldId = table.fields.find((field) => field.name === 'Date')?.id ?? '';
    const created = await createRecords(
      table.id,
      [{ fields: { [dateFieldId]: '2024-03-15T01:30:00.000Z' } }],
      false
    );
    expect(created.status).toBe(201);
    const parsed = createRecordsOkResponseSchema.safeParse(created.rawBody);
    expect(parsed.success && parsed.data.ok).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;
    const recordId = parsed.data.data.records[0]?.id ?? '';

    await ctx.updateField({
      tableId: table.id,
      fieldId: dateFieldId,
      field: { type: 'singleLineText', name: 'Date' },
    });

    expect(await listFieldValue(table.id, recordId, dateFieldId)).toBe('2024-03-15 10:30');
  });

  it('T7818 converts date-only text using the new field timezone and clears invalid text', async () => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: uniqueName('t7818-text-date'),
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Text' },
      ],
      views: [{ type: 'grid' }],
    });
    const textFieldId = table.fields.find((field) => field.name === 'Text')?.id ?? '';
    const created = await createRecords(
      table.id,
      [{ fields: { [textFieldId]: '2024-03-15' } }, { fields: { [textFieldId]: 'abc' } }],
      false
    );
    expect(created.status).toBe(201);
    const parsed = createRecordsOkResponseSchema.safeParse(created.rawBody);
    expect(parsed.success && parsed.data.ok).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;
    const validId = parsed.data.data.records[0]?.id ?? '';
    const invalidId = parsed.data.data.records[1]?.id ?? '';

    await ctx.updateField({
      tableId: table.id,
      fieldId: textFieldId,
      field: {
        type: 'date',
        name: 'Text',
        options: {
          formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'Asia/Shanghai' },
        },
      },
    });

    expect(await listFieldValue(table.id, validId, textFieldId)).toBe('2024-03-14T16:00:00.000Z');
    expect((await listFieldValue(table.id, invalidId, textFieldId)) ?? null).toBeNull();
  });

  it('round-trips a D/M/YYYY value through text and back to the same instant', async () => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: uniqueName('t7817-round-trip'),
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'date',
          name: 'Date',
          options: {
            formatting: { date: 'D/M/YYYY', time: 'None', timeZone: 'Asia/Shanghai' },
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const dateFieldId = table.fields.find((field) => field.name === 'Date')?.id ?? '';
    const created = await createRecords(
      table.id,
      [{ fields: { [dateFieldId]: '2024-03-03T16:00:00.000Z' } }],
      false
    );
    expect(created.status).toBe(201);
    const parsed = createRecordsOkResponseSchema.safeParse(created.rawBody);
    expect(parsed.success && parsed.data.ok).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;
    const recordId = parsed.data.data.records[0]?.id ?? '';

    await ctx.updateField({
      tableId: table.id,
      fieldId: dateFieldId,
      field: { type: 'singleLineText', name: 'Date' },
    });
    expect(await listFieldValue(table.id, recordId, dateFieldId)).toBe('4/3/2024');

    await ctx.updateField({
      tableId: table.id,
      fieldId: dateFieldId,
      field: {
        type: 'date',
        name: 'Date',
        options: {
          formatting: { date: 'D/M/YYYY', time: 'None', timeZone: 'Asia/Shanghai' },
        },
      },
    });
    expect(await listFieldValue(table.id, recordId, dateFieldId)).toBe('2024-03-03T16:00:00.000Z');
  });

  it('converts a timezone-less timestamp in the field timezone', async () => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: uniqueName('t7818-tzless'),
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Text' },
      ],
      views: [{ type: 'grid' }],
    });
    const textFieldId = table.fields.find((field) => field.name === 'Text')?.id ?? '';
    const created = await createRecords(
      table.id,
      [{ fields: { [textFieldId]: '2024-03-15 10:30' } }],
      false
    );
    expect(created.status).toBe(201);
    const parsed = createRecordsOkResponseSchema.safeParse(created.rawBody);
    expect(parsed.success && parsed.data.ok).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;
    const recordId = parsed.data.data.records[0]?.id ?? '';

    await ctx.updateField({
      tableId: table.id,
      fieldId: textFieldId,
      field: {
        type: 'date',
        name: 'Text',
        options: {
          formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'Asia/Shanghai' },
        },
      },
    });
    expect(await listFieldValue(table.id, recordId, textFieldId)).toBe('2024-03-15T02:30:00.000Z');
  });

  it('round-trips YYYY-MM-DD hh:mm A and clears an invalid hour', async () => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: uniqueName('t7817-hour12'),
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'date',
          name: 'Date',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'hh:mm A', timeZone: 'Asia/Tokyo' },
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const dateFieldId = table.fields.find((field) => field.name === 'Date')?.id ?? '';
    const created = await createRecords(
      table.id,
      [{ fields: { [dateFieldId]: '2024-03-15T01:30:00.000Z' } }],
      false
    );
    expect(created.status).toBe(201);
    const parsed = createRecordsOkResponseSchema.safeParse(created.rawBody);
    expect(parsed.success && parsed.data.ok).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;
    const recordId = parsed.data.data.records[0]?.id ?? '';

    await ctx.updateField({
      tableId: table.id,
      fieldId: dateFieldId,
      field: { type: 'singleLineText', name: 'Date' },
    });
    expect(await listFieldValue(table.id, recordId, dateFieldId)).toBe('2024-03-15 10:30 AM');

    await ctx.updateField({
      tableId: table.id,
      fieldId: dateFieldId,
      field: {
        type: 'date',
        name: 'Date',
        options: {
          formatting: { date: 'YYYY-MM-DD', time: 'hh:mm A', timeZone: 'Asia/Tokyo' },
        },
      },
    });
    expect(await listFieldValue(table.id, recordId, dateFieldId)).toBe('2024-03-15T01:30:00.000Z');

    const invalid = await createTable({
      baseId: ctx.baseId,
      name: uniqueName('t7817-hour12-invalid'),
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Text' },
      ],
      views: [{ type: 'grid' }],
    });
    const textFieldId = invalid.fields.find((field) => field.name === 'Text')?.id ?? '';
    const invalidCreated = await createRecords(
      invalid.id,
      [{ fields: { [textFieldId]: '2024-03-15 13:30 AM' } }],
      false
    );
    expect(invalidCreated.status).toBe(201);
    const invalidParsed = createRecordsOkResponseSchema.safeParse(invalidCreated.rawBody);
    expect(invalidParsed.success && invalidParsed.data.ok).toBe(true);
    if (!invalidParsed.success || !invalidParsed.data.ok) return;
    const invalidId = invalidParsed.data.data.records[0]?.id ?? '';
    await ctx.updateField({
      tableId: invalid.id,
      fieldId: textFieldId,
      field: {
        type: 'date',
        name: 'Text',
        options: {
          formatting: { date: 'YYYY-MM-DD', time: 'hh:mm A', timeZone: 'Asia/Tokyo' },
        },
      },
    });
    expect((await listFieldValue(invalid.id, invalidId, textFieldId)) ?? null).toBeNull();
  });
});
