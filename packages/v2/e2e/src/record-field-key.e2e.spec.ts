/* eslint-disable @typescript-eslint/naming-convention */
import {
  createRecordsOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http record field key (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let fieldId: string;
  let dbFieldName: string;
  let recordId: string;

  const createTable = async (payload: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const rawBody = await response.json();
    if (response.status !== 201) {
      throw new Error(`CreateTable failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create table: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.table;
  };

  const createRecords = async (
    tableIdParam: string,
    fieldKeyType: FieldKeyType,
    records: Array<{ fields: Record<string, unknown> }>
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: tableIdParam, records, fieldKeyType }),
    });
    const rawBody = await response.json();
    if (response.status !== 201) {
      throw new Error(`CreateRecords failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create records: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.records;
  };

  const updateRecord = async (
    tableIdParam: string,
    recordIdParam: string,
    fieldKeyType: FieldKeyType,
    fields: Record<string, unknown>
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: tableIdParam,
        recordId: recordIdParam,
        fields,
        fieldKeyType,
      }),
    });
    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`UpdateRecord failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to update record: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.record;
  };

  const listRecords = async (tableIdParam: string, fieldKeyType: FieldKeyType) => {
    const params = new URLSearchParams({
      tableId: tableIdParam,
      fieldKeyType,
    });
    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
    });
    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`ListRecords failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to list records: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.records;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await createTable({
      baseId: ctx.baseId,
      name: 'RecordFieldKey',
      fields: [{ type: 'singleLineText', name: 'field1' }],
      views: [{ type: 'grid' }],
    });

    tableId = table.id;
    fieldId = table.fields[0]?.id ?? '';
    dbFieldName = table.fields[0]?.dbFieldName ?? '';
    if (!fieldId || !dbFieldName) {
      throw new Error('Missing field metadata for dbFieldName test');
    }

    const createdRecords = await createRecords(tableId, FieldKeyType.Id, [
      { fields: { [fieldId]: 'test1' } },
      { fields: { [fieldId]: 'test2' } },
    ]);
    recordId = createdRecords[0]?.id ?? '';
    if (!recordId) {
      throw new Error('Missing record id for dbFieldName test');
    }
  }, 30000);

  // No afterAll dispose needed - handled by vitest.setup.ts

  it('lists records with db field name keys', async () => {
    const records = await listRecords(tableId, FieldKeyType.DbFieldName);
    const record = records.find((entry) => entry.id === recordId);
    expect(record?.fields[dbFieldName]).toBe('test1');
  });

  it('updates record with db field name', async () => {
    const updated = await updateRecord(tableId, recordId, FieldKeyType.DbFieldName, {
      [dbFieldName]: 'test3',
    });
    expect(updated.fields[dbFieldName]).toBe('test3');
  });

  it('creates record with db field name', async () => {
    const created = await createRecords(tableId, FieldKeyType.DbFieldName, [
      { fields: { [dbFieldName]: 'test4' } },
    ]);
    expect(created[0]?.fields[dbFieldName]).toBe('test4');
  });
});
