/* eslint-disable @typescript-eslint/naming-convention */
import {
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  getTableByIdOkResponseSchema,
  listTableRecordsOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import type { ICreateTableCommandInput } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http createRecord (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let textFieldId: string;
  let numberFieldId: string;
  let checkboxFieldId: string;
  let typecastTableId: string;
  let typecastPrimaryFieldId: string;
  let typecastNumberFieldId: string;
  let typecastCheckboxFieldId: string;
  let typecastDateFieldId: string;
  let typecastSingleSelectFieldId: string;
  let typecastMultiSelectFieldId: string;
  let typecastRatingFieldId: string;
  let typecastSingleSelectOpenOptionId: string;
  let typecastMultiSelectTagAId: string;
  let typecastMultiSelectTagCId: string;
  let typecastSingleSelectOpenOptionName: string;
  let typecastMultiSelectTagAName: string;
  let typecastMultiSelectTagCName: string;
  let typecastSingleSelectDbFieldName: string;
  let typecastMultiSelectDbFieldName: string;

  let fieldIdCounter = 0;

  const typecastCaseKeys = [
    'number',
    'checkbox',
    'date',
    'singleSelect',
    'multipleSelect',
    'rating',
  ] as const;

  type TypecastCaseKey = (typeof typecastCaseKeys)[number];

  interface TypecastCase {
    name: TypecastCaseKey;
    fieldId: () => string;
    input: unknown;
    assert: (value: unknown) => void;
  }

  const createTypecastCases = () =>
    ({
      number: {
        name: 'number',
        fieldId: () => typecastNumberFieldId,
        input: '123.5',
        assert: (value) => {
          expect(value).toBe(123.5);
        },
      },
      checkbox: {
        name: 'checkbox',
        fieldId: () => typecastCheckboxFieldId,
        input: 'true',
        assert: (value) => {
          expect(value).toBe(true);
        },
      },
      date: {
        name: 'date',
        fieldId: () => typecastDateFieldId,
        input: '2024-01-02T03:04:05.000Z',
        assert: (value) => {
          expect(value).toBe('2024-01-02T03:04:05.000Z');
        },
      },
      singleSelect: {
        name: 'singleSelect',
        fieldId: () => typecastSingleSelectFieldId,
        input: 'Open',
        assert: (value) => {
          // v2 now stores by name to align with v1 behavior
          expect(value).toBe(typecastSingleSelectOpenOptionName);
        },
      },
      multipleSelect: {
        name: 'multipleSelect',
        fieldId: () => typecastMultiSelectFieldId,
        input: ['Tag A', 'Tag C'],
        assert: (value) => {
          // v2 now stores by name to align with v1 behavior
          expect(Array.isArray(value)).toBe(true);
          expect(value).toEqual([typecastMultiSelectTagAName, typecastMultiSelectTagCName]);
        },
      },
      rating: {
        name: 'rating',
        fieldId: () => typecastRatingFieldId,
        input: '4',
        assert: (value) => {
          expect(value).toBe(4);
        },
      },
    }) satisfies Record<TypecastCaseKey, TypecastCase>;
  const typecastCaseMap = createTypecastCases();
  const _exhaustiveCheck: Record<TypecastCaseKey, TypecastCase> = typecastCaseMap;
  void _exhaustiveCheck;
  const typecastCases = Object.values(typecastCaseMap);

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const normalizeJsonArray = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const createTable = async (payload: ICreateTableCommandInput) => {
    const response = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create table: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create table response');
    }
    return parsed.data.data.table;
  };

  const createRecord = async (tableIdParam: string, fields: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: tableIdParam, fields }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create record: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create record response');
    }
    return parsed.data.data.record;
  };

  const getTableById = async (tableIdParam: string) => {
    const response = await fetch(
      `${ctx.baseUrl}/tables/get?baseId=${ctx.baseId}&tableId=${tableIdParam}`
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch table: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = getTableByIdOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse get table response');
    }
    return parsed.data.data.table;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    // Create a test table for record operations
    const table = await createTable({
      baseId: ctx.baseId,
      name: 'Record Test Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
        { type: 'checkbox', name: 'Approved' },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    const fields = table.fields;
    textFieldId = fields.find((f) => f.name === 'Title')?.id ?? '';
    numberFieldId = fields.find((f) => f.name === 'Amount')?.id ?? '';
    checkboxFieldId = fields.find((f) => f.name === 'Approved')?.id ?? '';

    const typecastTable = await createTable({
      baseId: ctx.baseId,
      name: 'Typecast Record Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Number' },
        { type: 'checkbox', name: 'Checkbox' },
        { type: 'date', name: 'Date' },
        {
          type: 'singleSelect',
          name: 'Status',
          options: ['Open', 'Closed'],
        },
        {
          type: 'multipleSelect',
          name: 'Tags',
          options: ['Tag A', 'Tag B', 'Tag C'],
        },
        { type: 'rating', name: 'Score' },
      ],
      views: [{ type: 'grid' }],
    });
    typecastTableId = typecastTable.id;
    typecastPrimaryFieldId = typecastTable.fields.find((f) => f.name === 'Title')?.id ?? '';
    typecastNumberFieldId = typecastTable.fields.find((f) => f.name === 'Number')?.id ?? '';
    typecastCheckboxFieldId = typecastTable.fields.find((f) => f.name === 'Checkbox')?.id ?? '';
    typecastDateFieldId = typecastTable.fields.find((f) => f.name === 'Date')?.id ?? '';
    typecastSingleSelectFieldId = typecastTable.fields.find((f) => f.name === 'Status')?.id ?? '';
    typecastMultiSelectFieldId = typecastTable.fields.find((f) => f.name === 'Tags')?.id ?? '';
    typecastRatingFieldId = typecastTable.fields.find((f) => f.name === 'Score')?.id ?? '';

    const singleSelectField = typecastTable.fields.find((f) => f.name === 'Status');
    typecastSingleSelectDbFieldName = singleSelectField?.dbFieldName ?? '';
    const singleSelectChoices =
      (singleSelectField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ??
      [];
    typecastSingleSelectOpenOptionId =
      singleSelectChoices.find((choice) => choice.name === 'Open')?.id ?? '';
    typecastSingleSelectOpenOptionName =
      singleSelectChoices.find((choice) => choice.name === 'Open')?.name ?? '';
    if (!typecastSingleSelectOpenOptionId || !typecastSingleSelectOpenOptionName) {
      throw new Error('Missing single select option "Open"');
    }
    if (!typecastSingleSelectDbFieldName) {
      throw new Error('Missing dbFieldName for typecast single select field');
    }

    const multiSelectField = typecastTable.fields.find((f) => f.name === 'Tags');
    typecastMultiSelectDbFieldName = multiSelectField?.dbFieldName ?? '';
    const multiSelectChoices =
      (multiSelectField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ??
      [];
    typecastMultiSelectTagAId =
      multiSelectChoices.find((choice) => choice.name === 'Tag A')?.id ?? '';
    typecastMultiSelectTagCId =
      multiSelectChoices.find((choice) => choice.name === 'Tag C')?.id ?? '';
    typecastMultiSelectTagAName =
      multiSelectChoices.find((choice) => choice.name === 'Tag A')?.name ?? '';
    typecastMultiSelectTagCName =
      multiSelectChoices.find((choice) => choice.name === 'Tag C')?.name ?? '';
    if (
      !typecastMultiSelectTagAId ||
      !typecastMultiSelectTagCId ||
      !typecastMultiSelectTagAName ||
      !typecastMultiSelectTagCName
    ) {
      throw new Error('Missing multi select options');
    }
    if (!typecastMultiSelectDbFieldName) {
      throw new Error('Missing dbFieldName for typecast multi select field');
    }
  });

  it('returns 201 ok when creating a record (fetch)', async () => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        fields: {
          [textFieldId]: 'Test Record',
          [numberFieldId]: 42,
          [checkboxFieldId]: true,
        },
      }),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.record.id).toMatch(/^rec/);
    expect(body.data.record.fields[textFieldId]).toBe('Test Record');
    expect(body.data.record.fields[numberFieldId]).toBe(42);
    expect(body.data.record.fields[checkboxFieldId]).toBe(true);
  });

  it('returns ok response via orpc client', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const body = await client.tables.createRecord({
      tableId,
      fields: {
        [textFieldId]: 'Client Record',
        [numberFieldId]: 100,
      },
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.record.id).toMatch(/^rec/);
    expect(body.data.record.fields[textFieldId]).toBe('Client Record');
    expect(body.data.record.fields[numberFieldId]).toBe(100);
  });

  it('creates a record with empty fields', async () => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        fields: {},
      }),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.record.id).toMatch(/^rec/);
  });

  it('creates multiple records with unique IDs', async () => {
    const recordIds: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId,
          fields: { [textFieldId]: `Record ${i + 1}` },
        }),
      });
      expect(response.status).toBe(201);

      const rawBody = await response.json();
      const parsed = createRecordOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      recordIds.push(parsed.data.data.record.id);
    }

    // All record IDs should be unique
    expect(new Set(recordIds).size).toBe(3);
  });

  it('returns 404 when table not found', async () => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: `tbl${'x'.repeat(16)}`,
        fields: {},
      }),
    });

    expect(response.status).toBe(404);
  });

  it('returns 400 for invalid input', async () => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        // missing tableId
        fields: {},
      }),
    });

    expect(response.status).toBe(400);
  });

  it('returns 400 when field validation fails', async () => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        fields: {
          [numberFieldId]: 'not a number',
        },
      }),
    });

    expect(response.status).toBe(400);
  });

  it.each(typecastCases)('creates a record with typecast $name', async (testCase) => {
    const fieldId = testCase.fieldId();
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: typecastTableId,
        typecast: true,
        fields: {
          [typecastPrimaryFieldId]: `Typecast ${testCase.name}`,
          [fieldId]: testCase.input,
        },
      }),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    const value = body.data.record.fields[fieldId];
    testCase.assert(value);
  });

  it('auto creates select options when typecast is enabled', async () => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: typecastTableId,
        typecast: true,
        fields: {
          [typecastPrimaryFieldId]: 'Auto Create',
          [typecastSingleSelectFieldId]: 'In Progress',
          [typecastMultiSelectFieldId]: ['Tag A', 'Tag Z'],
        },
      }),
    });

    expect(response.status).toBe(201);
    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.ok).toBe(true);
    if (!parsed.data.ok) return;

    const recordFields = parsed.data.data.record.fields;
    expect(recordFields[typecastSingleSelectFieldId]).toBe('In Progress');
    const multiValue = recordFields[typecastMultiSelectFieldId];
    const normalizedMulti = Array.isArray(multiValue) ? multiValue : normalizeJsonArray(multiValue);
    expect(normalizedMulti).toContain('Tag Z');

    const updatedTable = await getTableById(typecastTableId);
    const singleSelectField = updatedTable.fields.find(
      (field) => field.id === typecastSingleSelectFieldId
    );
    const singleChoices =
      (singleSelectField?.options as { choices?: Array<{ name: string }> })?.choices ?? [];
    expect(singleChoices.some((choice) => choice.name === 'In Progress')).toBe(true);

    const multiSelectField = updatedTable.fields.find(
      (field) => field.id === typecastMultiSelectFieldId
    );
    const multiChoices =
      (multiSelectField?.options as { choices?: Array<{ name: string }> })?.choices ?? [];
    expect(multiChoices.some((choice) => choice.name === 'Tag Z')).toBe(true);
  });

  it('stores select option names in database for new records', async () => {
    const record = await createRecord(typecastTableId, {
      [typecastPrimaryFieldId]: 'Stored Select Names',
      [typecastSingleSelectFieldId]: typecastSingleSelectOpenOptionId,
      [typecastMultiSelectFieldId]: [typecastMultiSelectTagAId, typecastMultiSelectTagCId],
    });

    const result = await sql<{ single_value: string | null; multi_value: unknown }>`
      SELECT
        ${sql.ref(typecastSingleSelectDbFieldName)} as single_value,
        ${sql.ref(typecastMultiSelectDbFieldName)} as multi_value
      FROM ${sql.table(`${ctx.baseId}.${typecastTableId}`)}
      WHERE "__id" = ${record.id}
    `.execute(ctx.testContainer.db);

    expect(result.rows.length).toBe(1);
    const row = result.rows[0];
    expect(row.single_value).toBe(typecastSingleSelectOpenOptionName);
    expect(normalizeJsonArray(row.multi_value)).toEqual([
      typecastMultiSelectTagAName,
      typecastMultiSelectTagCName,
    ]);
  });

  it('stores lookup select values as option names', async () => {
    const sourceTable = await createTable({
      baseId: ctx.baseId,
      name: 'Lookup Source Selects',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleSelect', name: 'Status', options: ['Open', 'Done'] },
      ],
      views: [{ type: 'grid' }],
    });

    const sourceNameFieldId = sourceTable.fields.find((f) => f.name === 'Name')?.id ?? '';
    const sourceStatusField = sourceTable.fields.find((f) => f.name === 'Status');
    const sourceStatusFieldId = sourceStatusField?.id ?? '';
    const sourceStatusDbFieldName = sourceStatusField?.dbFieldName ?? '';
    const sourceStatusChoices =
      (sourceStatusField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ??
      [];
    const sourceStatusOpen = sourceStatusChoices.find((choice) => choice.name === 'Open');
    const sourceStatusId = sourceStatusOpen?.id ?? '';
    const sourceStatusName = sourceStatusOpen?.name ?? '';

    if (!sourceNameFieldId || !sourceStatusFieldId) {
      throw new Error('Missing source table fields');
    }
    if (!sourceStatusId || !sourceStatusName || !sourceStatusDbFieldName) {
      throw new Error('Missing source status option metadata');
    }

    const sourceRecord = await createRecord(sourceTable.id, {
      [sourceNameFieldId]: 'Source 1',
      [sourceStatusFieldId]: sourceStatusId,
    });

    const linkFieldId = createFieldId();
    const hostTable = await createTable({
      baseId: ctx.baseId,
      name: 'Lookup Host Selects',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Source',
          options: {
            relationship: 'manyOne',
            foreignTableId: sourceTable.id,
            lookupFieldId: sourceNameFieldId,
            isOneWay: true,
          },
        },
        {
          type: 'lookup',
          name: 'Status Lookup',
          options: {
            linkFieldId,
            foreignTableId: sourceTable.id,
            lookupFieldId: sourceStatusFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const hostTitleFieldId = hostTable.fields.find((f) => f.name === 'Title')?.id ?? '';
    const hostLookupField = hostTable.fields.find((f) => f.name === 'Status Lookup');
    const hostLookupDbFieldName = hostLookupField?.dbFieldName ?? '';
    if (!hostTitleFieldId || !hostLookupDbFieldName) {
      throw new Error('Missing host table fields');
    }

    const hostRecord = await createRecord(hostTable.id, {
      [hostTitleFieldId]: 'Host 1',
      [linkFieldId]: { id: sourceRecord.id, title: 'Source 1' },
    });

    await ctx.testContainer.processOutbox();

    const sourceRow = await sql<{ status_value: string | null }>`
      SELECT ${sql.ref(sourceStatusDbFieldName)} as status_value
      FROM ${sql.table(`${ctx.baseId}.${sourceTable.id}`)}
      WHERE "__id" = ${sourceRecord.id}
    `.execute(ctx.testContainer.db);

    expect(sourceRow.rows.length).toBe(1);
    expect(sourceRow.rows[0].status_value).toBe(sourceStatusName);

    const hostRow = await sql<{ lookup_value: unknown }>`
      SELECT ${sql.ref(hostLookupDbFieldName)} as lookup_value
      FROM ${sql.table(`${ctx.baseId}.${hostTable.id}`)}
      WHERE "__id" = ${hostRecord.id}
    `.execute(ctx.testContainer.db);

    expect(hostRow.rows.length).toBe(1);
    expect(normalizeJsonArray(hostRow.rows[0].lookup_value)).toEqual([sourceStatusName]);
  });
});

describe('v2 http createRecord with link fields (e2e)', () => {
  let ctx: SharedTestContext;
  let foreignTableId: string;
  let mainTableId: string;
  let mainTextFieldId: string;
  let linkFieldId: string;
  let foreignRecordId: string;
  const foreignRecordTitle = 'Foreign Record 1';

  const createTable = async (payload: ICreateTableCommandInput) => {
    const response = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create table: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create table response');
    }
    return parsed.data.data.table;
  };

  const createRecord = async (tableIdParam: string, fields: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: tableIdParam, fields }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create record: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create record response');
    }
    return parsed.data.data.record;
  };

  const listRecords = async (tableIdParam: string) => {
    const params = new URLSearchParams({ tableId: tableIdParam });
    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list records: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse list records response');
    }
    return parsed.data.data.records;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    // Create a foreign table to link to
    const foreignTable = await createTable({
      baseId: ctx.baseId,
      name: 'Foreign Table',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Value' },
      ],
      views: [{ type: 'grid' }],
    });
    foreignTableId = foreignTable.id;
    const foreignTextFieldId = foreignTable.fields.find((f) => f.name === 'Name')?.id ?? '';

    // Create a record in the foreign table
    const foreignRecord = await createRecord(foreignTableId, {
      [foreignTextFieldId]: foreignRecordTitle,
    });
    foreignRecordId = foreignRecord.id;

    // Create main table with link field
    const mainTable = await createTable({
      baseId: ctx.baseId,
      name: 'Main Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          name: 'Related',
          options: {
            relationship: 'manyMany',
            foreignTableId,
            lookupFieldId: foreignTextFieldId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    mainTableId = mainTable.id;
    mainTextFieldId = mainTable.fields.find((f) => f.name === 'Title')?.id ?? '';
    linkFieldId = mainTable.fields.find((f) => f.name === 'Related')?.id ?? '';
  });

  it('creates a record with link field value and verifies with listRecords', async () => {
    // Create a record with link field
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: mainTableId,
        fields: {
          [mainTextFieldId]: 'Main Record With Link',
          [linkFieldId]: [{ id: foreignRecordId, title: 'Foreign Record 1' }],
        },
      }),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    const createdRecordId = body.data.record.id;
    expect(createdRecordId).toMatch(/^rec/);

    await ctx.testContainer.processOutbox();

    // Verify with listRecords that link field is correctly saved and retrieved
    const records = await listRecords(mainTableId);
    const foundRecord = records.find((r) => r.id === createdRecordId);

    expect(foundRecord).toBeDefined();
    if (!foundRecord) return;

    expect(foundRecord.fields[mainTextFieldId]).toBe('Main Record With Link');

    // Verify link field value is correctly stored and returned
    const linkValue = foundRecord.fields[linkFieldId] as unknown;
    expect(linkValue).toBeDefined();
    expect(Array.isArray(linkValue)).toBe(true);

    const linkArray = linkValue as Array<{ id: string; title?: string }>;
    expect(linkArray.length).toBeGreaterThanOrEqual(1);
    expect(linkArray.some((link) => link.id === foreignRecordId)).toBe(true);
  });

  it('creates a record with link titles when typecast is enabled', async () => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: mainTableId,
        typecast: true,
        fields: {
          [mainTextFieldId]: 'Main Record With Title Link',
          [linkFieldId]: [foreignRecordTitle],
        },
      }),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    const createdRecordId = body.data.record.id;

    await ctx.testContainer.processOutbox();

    const records = await listRecords(mainTableId);
    const foundRecord = records.find((r) => r.id === createdRecordId);

    expect(foundRecord).toBeDefined();
    if (!foundRecord) return;

    const linkValue = foundRecord.fields[linkFieldId] as unknown;
    expect(Array.isArray(linkValue)).toBe(true);
    const linkArray = linkValue as Array<{ id: string; title?: string }>;
    expect(linkArray.some((link) => link.id === foreignRecordId)).toBe(true);
  });

  it('creates a record with empty link field', async () => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: mainTableId,
        fields: {
          [mainTextFieldId]: 'Main Record No Link',
        },
      }),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
  });

  it('creates a record with null link field', async () => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: mainTableId,
        fields: {
          [mainTextFieldId]: 'Main Record Null Link',
          [linkFieldId]: null,
        },
      }),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
  });

  it('returns error when linking to non-existent record (FK constraint enforced)', async () => {
    const nonExistentRecordId = `rec${'x'.repeat(16)}`;
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: mainTableId,
        fields: {
          [mainTextFieldId]: 'Main Record Invalid Link',
          [linkFieldId]: [{ id: nonExistentRecordId, title: 'Non-existent' }],
        },
      }),
    });

    // FK constraint on junction table prevents inserting non-existent record IDs
    // The database returns a foreign key violation error
    expect(response.status).toBe(500);

    const body = (await response.json()) as { ok?: boolean; error?: { message?: string } };
    expect(body.ok).toBe(false);
    // The error message should indicate a foreign key constraint violation
    expect(body.error?.message ?? '').toContain('Failed to insert record');
  });
});
