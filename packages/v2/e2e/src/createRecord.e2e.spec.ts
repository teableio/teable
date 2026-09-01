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

  /**
   * v1 reference: record.e2e-spec.ts:529 — formula fields are calculated in
   * the create response, both constant and field-dependent expressions.
   */
  it('creates a record and auto calculates computed formula fields', async () => {
    const titleId = createFieldId();
    const constFormulaId = createFieldId();
    const dependentFormulaId = createFieldId();

    const table = await createTable({
      baseId: ctx.baseId,
      name: 'Create Formula Compute',
      fields: [
        { type: 'singleLineText', id: titleId, name: 'Title', isPrimary: true },
        { type: 'formula', id: constFormulaId, name: 'Const', options: { expression: '1 + 1' } },
        {
          type: 'formula',
          id: dependentFormulaId,
          name: 'Suffixed',
          options: { expression: `{${titleId}} & "1"` },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const record = await createRecord(table.id, { [titleId]: 'text value' });

    expect(record.fields[constFormulaId]).toBe(2);
    expect(record.fields[dependentFormulaId]).toBe('text value1');
  });

  /**
   * v1 reference: record.e2e-spec.ts:1689 — chained numeric formulas
   * (f2 depends on f1) are computed in the create response.
   */
  it('creates with chained numeric formulas (f2 depends on f1)', async () => {
    const baseNumId = createFieldId();
    const f1Id = createFieldId();
    const f2Id = createFieldId();

    const table = await createTable({
      baseId: ctx.baseId,
      name: 'Create Numeric Formula Chain',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', id: baseNumId, name: 'Base' },
        { type: 'formula', id: f1Id, name: 'F1', options: { expression: `{${baseNumId}} + 1` } },
        { type: 'formula', id: f2Id, name: 'F2', options: { expression: `{${f1Id}} + 2` } },
      ],
      views: [{ type: 'grid' }],
    });

    const record = await createRecord(table.id, { [baseNumId]: 10 });

    expect(record.fields[f1Id]).toBe(11);
    expect(record.fields[f2Id]).toBe(13);
  });

  /**
   * v1 reference: record.e2e-spec.ts:1714 — chained string formulas are
   * computed in the create response.
   */
  it('creates with chained string formulas', async () => {
    const txtId = createFieldId();
    const f1Id = createFieldId();
    const f2Id = createFieldId();

    const table = await createTable({
      baseId: ctx.baseId,
      name: 'Create String Formula Chain',
      fields: [
        { type: 'singleLineText', id: txtId, name: 'Title', isPrimary: true },
        { type: 'formula', id: f1Id, name: 'F1', options: { expression: `{${txtId}} & '-x'` } },
        { type: 'formula', id: f2Id, name: 'F2', options: { expression: `{${f1Id}} & '-y'` } },
      ],
      views: [{ type: 'grid' }],
    });

    const record = await createRecord(table.id, { [txtId]: 'abc' });

    expect(record.fields[f1Id]).toBe('abc-x');
    expect(record.fields[f2Id]).toBe('abc-x-y');
  });

  /**
   * v1 reference: record.e2e-spec.ts:742 — a singleSelect default value is
   * applied when the field is omitted on create.
   */
  it('creates a record with default single select', async () => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: 'Create Default Single Select',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [{ name: 'default value' }],
            defaultValue: 'default value',
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const statusFieldId = table.fields.find((f) => f.name === 'Status')?.id ?? '';

    const record = await createRecord(table.id, {});

    expect(record.fields[statusFieldId]).toBe('default value');
  });

  /**
   * v1 reference: record.e2e-spec.ts:762 — a multipleSelect default value is
   * applied when the field is omitted on create.
   */
  it('creates a record with default multiple select', async () => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: 'Create Default Multiple Select',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'multipleSelect',
          name: 'Tags',
          options: {
            choices: [{ name: 'default value' }, { name: 'default value2' }],
            defaultValue: ['default value', 'default value2'],
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const tagsFieldId = table.fields.find((f) => f.name === 'Tags')?.id ?? '';

    const record = await createRecord(table.id, {});

    expect(record.fields[tagsFieldId]).toEqual(['default value', 'default value2']);
  });

  /**
   * v1 reference: record.e2e-spec.ts:782 — a number default value is applied
   * when the field is omitted on create.
   */
  it('creates a record with default number', async () => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: 'Create Default Number',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount', options: { defaultValue: 1 } },
      ],
      views: [{ type: 'grid' }],
    });
    const amountFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';

    const record = await createRecord(table.id, {});

    expect(record.fields[amountFieldId]).toBe(1);
  });

  /**
   * v1 reference: record.e2e-spec.ts:801 — user default values (explicit user
   * id and the "me" alias) are resolved to full user cell values on create.
   */
  it('creates a record with default user', async () => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: 'Create Default User',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'user', name: 'Single Owner', options: { defaultValue: ctx.testUser.id } },
        {
          type: 'user',
          name: 'Me Team',
          options: { isMultiple: true, defaultValue: ['me'] },
        },
        {
          type: 'user',
          name: 'Id Team',
          options: { isMultiple: true, defaultValue: [ctx.testUser.id] },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const singleOwnerFieldId = table.fields.find((f) => f.name === 'Single Owner')?.id ?? '';
    const meTeamFieldId = table.fields.find((f) => f.name === 'Me Team')?.id ?? '';
    const idTeamFieldId = table.fields.find((f) => f.name === 'Id Team')?.id ?? '';

    const record = await createRecord(table.id, {});

    const expectedUser = {
      id: ctx.testUser.id,
      title: ctx.testUser.name,
      email: ctx.testUser.email,
    };
    expect(record.fields[singleOwnerFieldId]).toMatchObject(expectedUser);
    expect(record.fields[meTeamFieldId]).toMatchObject([expectedUser]);
    expect(record.fields[idTeamFieldId]).toMatchObject([expectedUser]);
  });

  /**
   * v1 reference: record.e2e-spec.ts:621 — creating a record still succeeds
   * when a formula references a deleted field; the errored formula stays empty.
   */
  it('creates a record when a formula references a deleted field', async () => {
    const table = await createTable({
      baseId: ctx.baseId,
      name: 'Create Errored Formula',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Doomed' },
      ],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
    const doomedFieldId = table.fields.find((f) => f.name === 'Doomed')?.id ?? '';

    const withFormula = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: { type: 'formula', name: 'Errored', options: { expression: `{${doomedFieldId}}` } },
    });
    const formulaFieldId = withFormula.fields.find((f) => f.name === 'Errored')?.id ?? '';

    await ctx.deleteField({ tableId: table.id, fieldId: doomedFieldId });

    const record = await createRecord(table.id, { [titleFieldId]: 'after delete' });

    expect(record.fields[titleFieldId]).toBe('after delete');
    expect(record.fields[formulaFieldId] == null).toBe(true);
  });

  /**
   * v1 reference: record.e2e-spec.ts:646 — creating a record with a link value
   * still succeeds when the lookup/rollup source field was deleted; the
   * errored computed fields stay empty.
   */
  it('creates a record when lookup and rollup reference a deleted field', async () => {
    const foreignTable = await createTable({
      baseId: ctx.baseId,
      name: 'Errored Lookup Foreign',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Value' },
      ],
      views: [{ type: 'grid' }],
    });
    const foreignNameFieldId = foreignTable.fields.find((f) => f.isPrimary)?.id ?? '';
    const foreignValueFieldId = foreignTable.fields.find((f) => f.name === 'Value')?.id ?? '';
    const foreignRecord = await createRecord(foreignTable.id, {
      [foreignNameFieldId]: 'Target',
      [foreignValueFieldId]: 42,
    });

    const linkId = createFieldId();
    const table = await createTable({
      baseId: ctx.baseId,
      name: 'Errored Lookup Host',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          id: linkId,
          name: 'Link',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignNameFieldId,
            isOneWay: true,
          },
        },
        {
          type: 'lookup',
          name: 'Value Lookup',
          options: {
            linkFieldId: linkId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignValueFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
    const lookupFieldId = table.fields.find((f) => f.name === 'Value Lookup')?.id ?? '';

    const withRollup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'rollup',
        name: 'Value Sum',
        options: { expression: 'sum({values})' },
        config: {
          linkFieldId: linkId,
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignValueFieldId,
        },
      },
    });
    const rollupFieldId = withRollup.fields.find((f) => f.name === 'Value Sum')?.id ?? '';

    await ctx.deleteField({ tableId: foreignTable.id, fieldId: foreignValueFieldId });

    const record = await createRecord(table.id, {
      [titleFieldId]: 'after source delete',
      [linkId]: { id: foreignRecord.id },
    });

    expect(record.fields[lookupFieldId] == null).toBe(true);
    expect(record.fields[rollupFieldId] == null).toBe(true);
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

    // FK constraint on junction table prevents inserting non-existent record IDs;
    // the foreign key violation surfaces as a validation error
    expect(response.status).toBe(400);

    const body = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('validation.link.invalid_reference');
  });

  /**
   * v1 reference: record.e2e-spec.ts:905 — a record can be created when a
   * notNull-constrained link field is provided, even with an empty title and a
   * dependent lookup field present.
   */
  it('creates a record with a required (notNull) link field', async () => {
    const foreignTable = await createTable({
      baseId: ctx.baseId,
      name: 'Required Link Foreign',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const requiredForeignNameFieldId = foreignTable.fields.find((f) => f.isPrimary)?.id ?? '';
    const foreignRecord = await createRecord(foreignTable.id, {
      [requiredForeignNameFieldId]: 'Constraint Target',
    });

    const table = await createTable({
      baseId: ctx.baseId,
      name: 'Required Link Main',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

    const withLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'link',
        name: 'Required Link',
        options: {
          relationship: 'manyMany',
          foreignTableId: foreignTable.id,
          lookupFieldId: requiredForeignNameFieldId,
          isOneWay: true,
        },
      },
    });
    const requiredLinkFieldId = withLink.fields.find((f) => f.name === 'Required Link')?.id ?? '';

    await ctx.updateField({
      tableId: table.id,
      fieldId: requiredLinkFieldId,
      field: { notNull: true },
    });

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'lookup',
        name: 'Name Lookup',
        options: {
          linkFieldId: requiredLinkFieldId,
          foreignTableId: foreignTable.id,
          lookupFieldId: requiredForeignNameFieldId,
        },
      },
    });

    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: table.id,
        fields: {
          [titleFieldId]: 'Satisfies Constraint',
          [requiredLinkFieldId]: [{ id: foreignRecord.id, title: '' }],
        },
      }),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.ok).toBe(true);
  });
});
