/* eslint-disable @typescript-eslint/naming-convention */
import {
  createRecordsOkResponseSchema,
  createTableOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type DateCase = {
  name: string;
  formatting: {
    date: string;
    time: 'None' | 'HH:mm' | 'hh:mm A';
    timeZone: 'Asia/Singapore' | 'America/New_York' | 'utc';
  };
  create: { input: string; expected: string };
  update: { input: string; expected: string };
};

describe('v2 http date time parsing (e2e)', () => {
  let ctx: SharedTestContext;

  const uniqueName = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const dateCases: DateCase[] = [
    {
      name: 'date-only-asia-singapore',
      formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'Asia/Singapore' },
      create: { input: '2024-01-15', expected: '2024-01-14T16:00:00.000Z' },
      update: { input: '2024-02-02', expected: '2024-02-01T16:00:00.000Z' },
    },
    {
      name: 'date-only-new-york',
      formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'America/New_York' },
      create: { input: '2024-01-15', expected: '2024-01-15T05:00:00.000Z' },
      update: { input: '2024-01-20', expected: '2024-01-20T05:00:00.000Z' },
    },
    {
      name: 'datetime-no-tz-asia-singapore',
      formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'Asia/Singapore' },
      create: { input: '2024-01-15T08:30:00', expected: '2024-01-15T00:30:00.000Z' },
      update: { input: '2024-01-15 23:15', expected: '2024-01-15T15:15:00.000Z' },
    },
    {
      name: 'datetime-no-tz-utc',
      formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
      create: { input: '2024-01-15T08:30:00', expected: '2024-01-15T08:30:00.000Z' },
      update: { input: '2024-01-16 00:00', expected: '2024-01-16T00:00:00.000Z' },
    },
    {
      name: 'datetime-with-z',
      formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'Asia/Singapore' },
      create: { input: '2024-01-15T08:30:00.000Z', expected: '2024-01-15T08:30:00.000Z' },
      update: { input: '2024-01-16T00:00:00.000Z', expected: '2024-01-16T00:00:00.000Z' },
    },
    {
      name: 'datetime-with-offset',
      formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'Asia/Singapore' },
      create: { input: '2024-01-15T08:30:00+08:00', expected: '2024-01-15T00:30:00.000Z' },
      update: { input: '2024-01-15T18:00:00+02:00', expected: '2024-01-15T16:00:00.000Z' },
    },
  ];

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
    records: Array<{ fields: Record<string, unknown> }>
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        records,
        typecast: false,
        fieldKeyType: FieldKeyType.Id,
      }),
    });
    const rawBody = await response.json();
    expect(response.status).toBe(201);
    const parsed = createRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to parse create records response: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.records;
  };

  const updateRecord = async (
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        recordId,
        fields,
        typecast: false,
        fieldKeyType: FieldKeyType.Id,
      }),
    });
    const rawBody = await response.json();
    expect(response.status).toBe(200);
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to parse update record response: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.record;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  // No afterAll dispose needed - handled by vitest.setup.ts

  it.each(dateCases)('parses date fields - $name', async (dateCase) => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: uniqueName(`date-case-${dateCase.name}`),
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'date',
          name: 'Event Date',
          options: {
            formatting: dateCase.formatting,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const primaryFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    const dateFieldId = table.fields.find((field) => field.name === 'Event Date')?.id ?? '';

    const createdRecords = await createRecords(table.id, [
      {
        fields: {
          [primaryFieldId]: `create-${dateCase.name}`,
          [dateFieldId]: dateCase.create.input,
        },
      },
    ]);
    expect(createdRecords).toHaveLength(1);
    expect(createdRecords[0]?.fields[dateFieldId]).toBe(dateCase.create.expected);

    const updatedRecord = await updateRecord(table.id, createdRecords[0]!.id, {
      [dateFieldId]: dateCase.update.input,
    });
    expect(updatedRecord.fields[dateFieldId]).toBe(dateCase.update.expected);
  });
});
