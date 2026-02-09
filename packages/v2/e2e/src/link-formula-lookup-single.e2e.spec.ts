/* eslint-disable @typescript-eslint/naming-convention */
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import type { ICreateTableCommandInput } from '@teable/v2-core';
import { FieldKeyType } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 link formula lookup single-value (e2e)', () => {
  let ctx: SharedTestContext;

  const createTable = async (payload: ICreateTableCommandInput) => {
    const response = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const rawBody = await response.json();
    if (!response.ok) {
      throw new Error(`CreateTable failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create table: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.table;
  };

  const createField = async (tableId: string, field: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId: ctx.baseId, tableId, field }),
    });
    const rawBody = await response.json();
    if (!response.ok) {
      throw new Error(`CreateField failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createFieldOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create field: ${JSON.stringify(rawBody)}`);
    }
    const table = parsed.data.data.table;
    const fieldId = typeof field.id === 'string' ? field.id : undefined;
    const fieldName = typeof field.name === 'string' ? field.name : undefined;
    const created =
      (fieldId && table.fields.find((item) => item.id === fieldId)) ||
      (fieldName && table.fields.find((item) => item.name === fieldName));
    if (!created) {
      throw new Error(`Failed to resolve created field: ${JSON.stringify(field)}`);
    }
    return created;
  };

  const createRecord = async (tableId: string, fields: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, fields }),
    });
    const rawBody = await response.json();
    if (!response.ok) {
      throw new Error(`CreateRecord failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create record: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.record;
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
        fieldKeyType: FieldKeyType.Id,
      }),
    });
    const rawBody = await response.json();
    if (!response.ok) {
      throw new Error(`UpdateRecord failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to update record: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.record;
  };

  const listRecords = async (tableId: string, fieldKeyType: FieldKeyType = FieldKeyType.Id) => {
    await ctx.drainOutbox();
    const params = new URLSearchParams({
      tableId,
      fieldKeyType,
    });
    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
    });
    const rawBody = await response.json();
    if (!response.ok) {
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
  }, 30000);

  // No afterAll dispose needed - handled by vitest.setup.ts

  it('returns single object when many-one link uses formula lookup', async () => {
    const expectedTitle = 'New Face - Stage';

    const table2 = await createTable({
      baseId: ctx.baseId,
      name: 'manyone-lookup-src',
      fields: [
        { type: 'singleLineText', name: 'Name' },
        { type: 'singleLineText', name: 'Stage' },
      ],
      views: [{ type: 'grid' }],
    });

    const nameFieldId = table2.fields.find((f) => f.name === 'Name')?.id;
    const stageFieldId = table2.fields.find((f) => f.name === 'Stage')?.id;
    if (!nameFieldId || !stageFieldId) {
      throw new Error('Failed to resolve Name/Stage field IDs');
    }

    const formulaField = await createField(table2.id, {
      name: 'Display Title',
      type: 'formula',
      options: {
        expression: `{${nameFieldId}} & " - " & {${stageFieldId}}`,
      },
    });

    const sourceRecord = await createRecord(table2.id, {
      Name: 'New Face',
      Stage: 'Stage',
    });

    const table1 = await createTable({
      baseId: ctx.baseId,
      name: 'manyone-host',
      fields: [{ type: 'singleLineText', name: 'Label' }],
      views: [{ type: 'grid' }],
    });
    const hostRecord = await createRecord(table1.id, { Label: 'Row 1' });

    const linkField = await createField(table1.id, {
      name: 'Studio',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: table2.id,
        lookupFieldId: formulaField.id,
      },
    });

    await updateRecord(table1.id, hostRecord.id, {
      [linkField.id]: { id: sourceRecord.id },
    });

    await ctx.drainOutbox();
    const records = await listRecords(table1.id);
    expect(records[0].fields[linkField.id]).toEqual({
      id: sourceRecord.id,
      title: expectedTitle,
    });
  });

  it('returns single object when one-one link uses formula lookup', async () => {
    const expectedTitle = 'New Face - Stage';

    const table2 = await createTable({
      baseId: ctx.baseId,
      name: 'oneone-lookup-src',
      fields: [
        { type: 'singleLineText', name: 'Name' },
        { type: 'singleLineText', name: 'Stage' },
      ],
      views: [{ type: 'grid' }],
    });

    const nameFieldId = table2.fields.find((f) => f.name === 'Name')?.id;
    const stageFieldId = table2.fields.find((f) => f.name === 'Stage')?.id;
    if (!nameFieldId || !stageFieldId) {
      throw new Error('Failed to resolve Name/Stage field IDs');
    }

    const formulaField = await createField(table2.id, {
      name: 'Display Title',
      type: 'formula',
      options: {
        expression: `{${nameFieldId}} & " - " & {${stageFieldId}}`,
      },
    });

    const sourceRecord = await createRecord(table2.id, {
      Name: 'New Face',
      Stage: 'Stage',
    });

    const table1 = await createTable({
      baseId: ctx.baseId,
      name: 'oneone-host',
      fields: [{ type: 'singleLineText', name: 'Label' }],
      views: [{ type: 'grid' }],
    });
    const hostRecord = await createRecord(table1.id, { Label: 'Row 1' });

    const linkField = await createField(table1.id, {
      name: 'Studio',
      type: 'link',
      options: {
        relationship: 'oneOne',
        foreignTableId: table2.id,
        lookupFieldId: formulaField.id,
      },
    });

    await updateRecord(table1.id, hostRecord.id, {
      [linkField.id]: { id: sourceRecord.id },
    });

    await ctx.drainOutbox();
    const hostRecords = await listRecords(table1.id);
    expect(hostRecords[0].fields[linkField.id]).toEqual({
      id: sourceRecord.id,
      title: expectedTitle,
    });

    const symmetricFieldId = (linkField.options as { symmetricFieldId?: string } | undefined)
      ?.symmetricFieldId;
    if (symmetricFieldId) {
      const foreignRecords = await listRecords(table2.id);
      expect(foreignRecords[0].fields[symmetricFieldId]).toEqual({
        id: hostRecord.id,
        title: 'Row 1',
      });
    }
  });

  it('updates link values across tables without scalar array errors', async () => {
    const table1 = await createTable({
      baseId: ctx.baseId,
      name: 'table1',
      fields: [
        { type: 'singleLineText', name: 'Name' },
        { type: 'formula', name: 'formula field', options: { expression: '"x"' } },
      ],
      views: [{ type: 'grid' }],
    });

    const formulaFieldId = table1.fields.find((f) => f.name === 'formula field')?.id;
    if (!formulaFieldId) {
      throw new Error('Failed to resolve formula field id');
    }

    const table1RecordA = await createRecord(table1.id, { Name: 't1 r1' });
    const table1RecordB = await createRecord(table1.id, { Name: 't1 r2' });

    const table2 = await createTable({
      baseId: ctx.baseId,
      name: 'table2',
      fields: [{ type: 'singleLineText', name: 'text field' }],
      views: [{ type: 'grid' }],
    });

    const table2RecordA = await createRecord(table2.id, { ['text field']: 't2 r1' });
    const table2RecordB = await createRecord(table2.id, { ['text field']: 't2 r2' });

    const table3 = await createTable({
      baseId: ctx.baseId,
      name: 'table3',
      fields: [{ type: 'singleLineText', name: 'text field' }],
      views: [{ type: 'grid' }],
    });
    const table3Record = await createRecord(table3.id, { ['text field']: 't3 r1' });

    const table2LinkField = await createField(table2.id, {
      name: '1 - 2 link',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: table1.id,
        lookupFieldId: formulaFieldId,
      },
    });

    const table2TitleFieldId = table2.fields.find((f) => f.name === 'text field')?.id;
    if (!table2TitleFieldId) {
      throw new Error('Failed to resolve table2 text field id');
    }

    const table3LinkField = await createField(table3.id, {
      name: '2 - 3 link',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: table2.id,
        lookupFieldId: table2TitleFieldId,
      },
    });

    const lookupField = await createField(table3.id, {
      name: 'lookup',
      type: 'lookup',
      options: {
        linkFieldId: table3LinkField.id,
        foreignTableId: table2.id,
        lookupFieldId: table2LinkField.id,
      },
    });

    await updateRecord(table3.id, table3Record.id, {
      [table3LinkField.id]: [{ id: table2RecordA.id }, { id: table2RecordB.id }],
    });

    await updateRecord(table2.id, table2RecordA.id, {
      [table2LinkField.id]: [{ id: table1RecordA.id }, { id: table1RecordB.id }],
    });

    await ctx.drainOutbox();
    const records = await listRecords(table3.id);
    expect(records[0].fields[lookupField.id]).toBeDefined();
  });
});
