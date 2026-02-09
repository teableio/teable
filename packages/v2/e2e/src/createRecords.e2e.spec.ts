/* eslint-disable @typescript-eslint/naming-convention */
import {
  createRecordOkResponseSchema,
  createRecordsOkResponseSchema,
  createTableOkResponseSchema,
  getTableByIdOkResponseSchema,
  listTableRecordsOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import type { ICreateTableCommandInput } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * E2E tests for batch record creation (createRecords).
 *
 * Tests:
 * 1. Basic field types (text, number, checkbox, date, select, etc.)
 * 2. Link field types (all relationship types)
 * 3. Database verification
 * 4. listRecords verification
 */
describe('v2 http createRecords (e2e)', () => {
  let ctx: SharedTestContext;

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

  const createRecord = async (tableId: string, fields: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, fields }),
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

  const createRecords = async (
    tableId: string,
    records: Array<{ fields: Record<string, unknown> }>
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, records }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create records: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createRecordsOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create records response');
    }
    return parsed.data.data.records;
  };

  const getTableById = async (tableId: string) => {
    const response = await fetch(
      `${ctx.baseUrl}/tables/get?baseId=${ctx.baseId}&tableId=${tableId}`
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

  const listRecords = async (tableId: string) => {
    const params = new URLSearchParams({ tableId });
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

  const processOutbox = async (times = 1) => {
    for (let i = 0; i < times; i += 1) {
      await ctx.testContainer.processOutbox();
    }
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  describe('basic field types', () => {
    let tableId: string;
    let textFieldId: string;
    let numberFieldId: string;
    let checkboxFieldId: string;

    beforeAll(async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: 'Batch Basic Fields',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'number', name: 'Amount' },
          { type: 'checkbox', name: 'Approved' },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      textFieldId = table.fields.find((f) => f.name === 'Title')?.id ?? '';
      numberFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';
      checkboxFieldId = table.fields.find((f) => f.name === 'Approved')?.id ?? '';
    });

    it('returns 201 ok when creating multiple records (fetch)', async () => {
      const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId,
          records: [
            {
              fields: {
                [textFieldId]: 'Record 1',
                [numberFieldId]: 100,
                [checkboxFieldId]: true,
              },
            },
            {
              fields: {
                [textFieldId]: 'Record 2',
                [numberFieldId]: 200,
                [checkboxFieldId]: false,
              },
            },
            {
              fields: {
                [textFieldId]: 'Record 3',
                [numberFieldId]: 300,
                [checkboxFieldId]: true,
              },
            },
          ],
        }),
      });

      expect(response.status).toBe(201);

      const rawBody = await response.json();
      const parsed = createRecordsOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      const body = parsed.data;

      expect(body.ok).toBe(true);
      if (!body.ok) return;

      expect(body.data.records.length).toBe(3);
      expect(body.data.records[0].id).toMatch(/^rec/);
      expect(body.data.records[1].id).toMatch(/^rec/);
      expect(body.data.records[2].id).toMatch(/^rec/);

      // Verify field values
      expect(body.data.records[0].fields[textFieldId]).toBe('Record 1');
      expect(body.data.records[0].fields[numberFieldId]).toBe(100);
      expect(body.data.records[0].fields[checkboxFieldId]).toBe(true);
    });

    it('creates records via orpc client', async () => {
      const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

      const body = await client.tables.createRecords({
        tableId,
        records: [
          {
            fields: {
              [textFieldId]: 'Client Record 1',
              [numberFieldId]: 500,
            },
          },
          {
            fields: {
              [textFieldId]: 'Client Record 2',
              [numberFieldId]: 600,
            },
          },
        ],
      });

      expect(body.ok).toBe(true);
      if (!body.ok) return;

      expect(body.data.records.length).toBe(2);
      expect(body.data.records[0].fields[textFieldId]).toBe('Client Record 1');
      expect(body.data.records[1].fields[textFieldId]).toBe('Client Record 2');
    });

    it('creates records with empty fields', async () => {
      const records = await createRecords(tableId, [
        { fields: {} },
        { fields: {} },
        { fields: {} },
      ]);

      expect(records.length).toBe(3);
      for (const record of records) {
        expect(record.id).toMatch(/^rec/);
      }
    });

    it('creates records with mixed field sets', async () => {
      const records = await createRecords(tableId, [
        { fields: { [textFieldId]: 'Only Title' } },
        { fields: { [numberFieldId]: 999 } },
        { fields: { [textFieldId]: 'Both', [numberFieldId]: 888 } },
      ]);

      expect(records.length).toBe(3);
      expect(records[0].fields[textFieldId]).toBe('Only Title');
      expect(records[1].fields[numberFieldId]).toBe(999);
      expect(records[2].fields[textFieldId]).toBe('Both');
      expect(records[2].fields[numberFieldId]).toBe(888);
    });

    it('verifies records via listRecords', async () => {
      const batchRecords = await createRecords(tableId, [
        { fields: { [textFieldId]: 'Verify 1' } },
        { fields: { [textFieldId]: 'Verify 2' } },
      ]);

      const allRecords = await listRecords(tableId);
      const foundRecords = allRecords.filter((r) => batchRecords.some((br) => br.id === r.id));

      expect(foundRecords.length).toBe(2);
      expect(foundRecords.map((r) => r.fields[textFieldId]).sort()).toEqual(
        ['Verify 1', 'Verify 2'].sort()
      );
    });

    it('generates unique IDs for each record', async () => {
      const records = await createRecords(
        tableId,
        Array.from({ length: 10 }, () => ({ fields: {} }))
      );

      const ids = new Set(records.map((r) => r.id));
      expect(ids.size).toBe(10);
    });
  });

  describe('link fields - manyMany', () => {
    let foreignTableId: string;
    let mainTableId: string;
    let foreignTitleFieldId: string;
    let mainTitleFieldId: string;
    let linkFieldId: string;
    let foreignRecordId1: string;
    let foreignRecordId2: string;
    let foreignRecordId3: string;

    beforeAll(async () => {
      // Create foreign table
      const foreignTable = await createTable({
        baseId: ctx.baseId,
        name: 'Batch ManyMany Foreign',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      foreignTableId = foreignTable.id;
      foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';

      // Create records in foreign table
      const fr1 = await createRecord(foreignTableId, { [foreignTitleFieldId]: 'Foreign A' });
      const fr2 = await createRecord(foreignTableId, { [foreignTitleFieldId]: 'Foreign B' });
      const fr3 = await createRecord(foreignTableId, { [foreignTitleFieldId]: 'Foreign C' });
      foreignRecordId1 = fr1.id;
      foreignRecordId2 = fr2.id;
      foreignRecordId3 = fr3.id;

      // Create main table with manyMany link
      const mainTable = await createTable({
        baseId: ctx.baseId,
        name: 'Batch ManyMany Main',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId,
              lookupFieldId: foreignTitleFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      mainTableId = mainTable.id;
      mainTitleFieldId = mainTable.fields.find((f) => f.name === 'Title')?.id ?? '';
      linkFieldId = mainTable.fields.find((f) => f.name === 'Links')?.id ?? '';
    });

    it('creates multiple records with different link combinations', async () => {
      const records = await createRecords(mainTableId, [
        {
          fields: {
            [mainTitleFieldId]: 'Main 1',
            [linkFieldId]: [{ id: foreignRecordId1, title: 'Foreign A' }],
          },
        },
        {
          fields: {
            [mainTitleFieldId]: 'Main 2',
            [linkFieldId]: [
              { id: foreignRecordId1, title: 'Foreign A' },
              { id: foreignRecordId2, title: 'Foreign B' },
            ],
          },
        },
        {
          fields: {
            [mainTitleFieldId]: 'Main 3',
            [linkFieldId]: [
              { id: foreignRecordId1, title: 'Foreign A' },
              { id: foreignRecordId2, title: 'Foreign B' },
              { id: foreignRecordId3, title: 'Foreign C' },
            ],
          },
        },
      ]);

      expect(records.length).toBe(3);

      // Verify via listRecords
      await processOutbox();
      const allRecords = await listRecords(mainTableId);
      const foundRecords = allRecords.filter((r) => records.some((rec) => rec.id === r.id));

      expect(foundRecords.length).toBe(3);

      const record1 = foundRecords.find((r) => r.fields[mainTitleFieldId] === 'Main 1');
      const record2 = foundRecords.find((r) => r.fields[mainTitleFieldId] === 'Main 2');
      const record3 = foundRecords.find((r) => r.fields[mainTitleFieldId] === 'Main 3');

      expect(record1).toBeDefined();
      expect(record2).toBeDefined();
      expect(record3).toBeDefined();

      const links1 = record1?.fields[linkFieldId] as Array<{ id: string }>;
      const links2 = record2?.fields[linkFieldId] as Array<{ id: string }>;
      const links3 = record3?.fields[linkFieldId] as Array<{ id: string }>;

      expect(links1.length).toBe(1);
      expect(links2.length).toBe(2);
      expect(links3.length).toBe(3);
    });

    it('creates records with empty and null link values', async () => {
      const records = await createRecords(mainTableId, [
        { fields: { [mainTitleFieldId]: 'No Link', [linkFieldId]: [] } },
        { fields: { [mainTitleFieldId]: 'Null Link', [linkFieldId]: null } },
        { fields: { [mainTitleFieldId]: 'Missing Link' } },
      ]);

      expect(records.length).toBe(3);

      const allRecords = await listRecords(mainTableId);
      const foundRecords = allRecords.filter((r) => records.some((rec) => rec.id === r.id));

      for (const record of foundRecords) {
        const linkValue = record.fields[linkFieldId];
        expect(linkValue === null || (Array.isArray(linkValue) && linkValue.length === 0)).toBe(
          true
        );
      }
    });
  });

  describe('link fields - manyOne', () => {
    let foreignTableId: string;
    let mainTableId: string;
    let foreignTitleFieldId: string;
    let mainTitleFieldId: string;
    let linkFieldId: string;
    let foreignRecordId: string;

    beforeAll(async () => {
      const foreignTable = await createTable({
        baseId: ctx.baseId,
        name: 'Batch ManyOne Foreign',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      foreignTableId = foreignTable.id;
      foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';

      const fr = await createRecord(foreignTableId, { [foreignTitleFieldId]: 'Parent' });
      foreignRecordId = fr.id;

      const mainTable = await createTable({
        baseId: ctx.baseId,
        name: 'Batch ManyOne Main',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Parent',
            options: {
              relationship: 'manyOne',
              foreignTableId,
              lookupFieldId: foreignTitleFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      mainTableId = mainTable.id;
      mainTitleFieldId = mainTable.fields.find((f) => f.name === 'Title')?.id ?? '';
      linkFieldId = mainTable.fields.find((f) => f.name === 'Parent')?.id ?? '';
    });

    it('creates multiple records linking to same parent', async () => {
      const records = await createRecords(mainTableId, [
        {
          fields: {
            [mainTitleFieldId]: 'Child 1',
            [linkFieldId]: { id: foreignRecordId, title: 'Parent' },
          },
        },
        {
          fields: {
            [mainTitleFieldId]: 'Child 2',
            [linkFieldId]: { id: foreignRecordId, title: 'Parent' },
          },
        },
        {
          fields: {
            [mainTitleFieldId]: 'Child 3',
            [linkFieldId]: { id: foreignRecordId, title: 'Parent' },
          },
        },
      ]);

      expect(records.length).toBe(3);

      // Verify FK columns in database
      const result = await sql<{ count: string }>`
        SELECT COUNT(*) as count
        FROM ${sql.table(`${ctx.baseId}.${mainTableId}`)}
        WHERE ${sql.ref(`__fk_${linkFieldId}`)} = ${foreignRecordId}
      `.execute(ctx.testContainer.db);

      expect(parseInt(result.rows[0].count, 10)).toBeGreaterThanOrEqual(3);
    });
  });

  describe('database verification', () => {
    let tableId: string;
    let textFieldId: string;
    let numberFieldId: string;

    beforeAll(async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: 'DB Verify Table',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'number', name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      textFieldId = table.fields.find((f) => f.name === 'Title')?.id ?? '';
      numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';
    });

    it('verifies all records are inserted into database', async () => {
      const records = await createRecords(tableId, [
        { fields: { [textFieldId]: 'DB Record 1', [numberFieldId]: 111 } },
        { fields: { [textFieldId]: 'DB Record 2', [numberFieldId]: 222 } },
        { fields: { [textFieldId]: 'DB Record 3', [numberFieldId]: 333 } },
      ]);

      // Direct database query
      const result = await sql<{ id: string; title: string; value: number }>`
        SELECT
          "__id" as id
        FROM ${sql.table(`${ctx.baseId}.${tableId}`)}
        WHERE "__id" IN (${sql.join(
          records.map((r) => sql`${r.id}`),
          sql`, `
        )})
      `.execute(ctx.testContainer.db);

      expect(result.rows.length).toBe(3);
      const dbIds = new Set(result.rows.map((r) => r.id));
      for (const record of records) {
        expect(dbIds.has(record.id)).toBe(true);
      }
    });

    it('verifies system columns are set correctly', async () => {
      const records = await createRecords(tableId, [{ fields: { [textFieldId]: 'System Check' } }]);

      const result = await sql<{
        version: number;
        created_by: string;
      }>`
        SELECT
          "__version" as version,
          "__created_by" as created_by
        FROM ${sql.table(`${ctx.baseId}.${tableId}`)}
        WHERE "__id" = ${records[0].id}
      `.execute(ctx.testContainer.db);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].version).toBe(1);
      expect(result.rows[0].created_by).toBe(ctx.testUser.id);
    });
  });

  describe('error handling', () => {
    let tableId: string;
    let numberFieldId: string;

    beforeAll(async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: 'Error Test Table',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'number', name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';
    });

    it('returns 404 when table not found', async () => {
      const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: `tbl${'x'.repeat(16)}`,
          records: [{ fields: {} }],
        }),
      });

      expect(response.status).toBe(404);
    });

    it('returns 400 for empty records array', async () => {
      const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId,
          records: [],
        }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 400 when field validation fails', async () => {
      const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId,
          records: [
            { fields: { [numberFieldId]: 100 } }, // Valid
            { fields: { [numberFieldId]: 'not a number' } }, // Invalid
          ],
        }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 400 for missing tableId', async () => {
      const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          records: [{ fields: {} }],
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('link fields with FK constraint', () => {
    let foreignTableId: string;
    let mainTableId: string;
    let foreignTitleFieldId: string;
    let mainTitleFieldId: string;
    let linkFieldId: string;
    let foreignRecordId: string;

    beforeAll(async () => {
      const foreignTable = await createTable({
        baseId: ctx.baseId,
        name: 'FK Constraint Foreign',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      foreignTableId = foreignTable.id;
      foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';

      const fr = await createRecord(foreignTableId, { [foreignTitleFieldId]: 'Valid Target' });
      foreignRecordId = fr.id;

      const mainTable = await createTable({
        baseId: ctx.baseId,
        name: 'FK Constraint Main',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Link',
            options: {
              relationship: 'manyMany',
              foreignTableId,
              lookupFieldId: foreignTitleFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      mainTableId = mainTable.id;
      mainTitleFieldId = mainTable.fields.find((f) => f.name === 'Title')?.id ?? '';
      linkFieldId = mainTable.fields.find((f) => f.name === 'Link')?.id ?? '';
    });

    it('creates records with valid link references', async () => {
      const records = await createRecords(mainTableId, [
        {
          fields: {
            [mainTitleFieldId]: 'Valid Link 1',
            [linkFieldId]: [{ id: foreignRecordId, title: 'Valid Target' }],
          },
        },
        {
          fields: {
            [mainTitleFieldId]: 'Valid Link 2',
            [linkFieldId]: [{ id: foreignRecordId, title: 'Valid Target' }],
          },
        },
      ]);

      expect(records.length).toBe(2);
    });

    it('fails when linking to non-existent record (FK constraint)', async () => {
      const nonExistentId = `rec${'x'.repeat(16)}`;

      const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: mainTableId,
          records: [
            {
              fields: {
                [mainTitleFieldId]: 'Invalid Link',
                [linkFieldId]: [{ id: nonExistentId, title: 'Non-existent' }],
              },
            },
          ],
        }),
      });

      // FK constraint violation should result in 500
      expect(response.status).toBe(500);
    });
  });

  describe('multiple field types', () => {
    let tableId: string;
    let textFieldId: string;
    let numberFieldId: string;
    let checkboxFieldId: string;
    let dateFieldId: string;
    let singleSelectFieldId: string;
    let multiSelectFieldId: string;
    // Store choice IDs for select fields
    let singleSelectChoices: Array<{ id: string; name: string }>;
    let multiSelectChoices: Array<{ id: string; name: string }>;

    beforeAll(async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: 'Multi Field Types',
        fields: [
          { type: 'singleLineText', name: 'Text', isPrimary: true },
          { type: 'number', name: 'Number' },
          { type: 'checkbox', name: 'Checkbox' },
          { type: 'date', name: 'Date' },
          {
            type: 'singleSelect',
            name: 'SingleSelect',
            options: ['Option A', 'Option B', 'Option C'],
          },
          {
            type: 'multipleSelect',
            name: 'MultiSelect',
            options: ['Tag 1', 'Tag 2', 'Tag 3'],
          },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';
      numberFieldId = table.fields.find((f) => f.name === 'Number')?.id ?? '';
      checkboxFieldId = table.fields.find((f) => f.name === 'Checkbox')?.id ?? '';
      dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const singleSelectField = table.fields.find((f) => f.name === 'SingleSelect');
      singleSelectFieldId = singleSelectField?.id ?? '';
      singleSelectChoices =
        (singleSelectField?.options as { choices?: Array<{ id: string; name: string }> })
          ?.choices ?? [];

      const multiSelectField = table.fields.find((f) => f.name === 'MultiSelect');
      multiSelectFieldId = multiSelectField?.id ?? '';
      multiSelectChoices =
        (multiSelectField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ??
        [];
    });

    it('creates records with all field types', async () => {
      const now = new Date().toISOString();

      // Get choice IDs by name
      const optionA = singleSelectChoices.find((c) => c.name === 'Option A');
      const optionB = singleSelectChoices.find((c) => c.name === 'Option B');
      const optionAId = optionA?.id ?? '';
      const optionBId = optionB?.id ?? '';
      const optionAName = optionA?.name ?? '';
      const tag1Id = multiSelectChoices.find((c) => c.name === 'Tag 1')?.id ?? '';
      const tag2Id = multiSelectChoices.find((c) => c.name === 'Tag 2')?.id ?? '';
      const tag3Id = multiSelectChoices.find((c) => c.name === 'Tag 3')?.id ?? '';

      const records = await createRecords(tableId, [
        {
          fields: {
            [textFieldId]: 'Full Record 1',
            [numberFieldId]: 100,
            [checkboxFieldId]: true,
            [dateFieldId]: now,
            [singleSelectFieldId]: optionAId,
            [multiSelectFieldId]: [tag1Id, tag2Id],
          },
        },
        {
          fields: {
            [textFieldId]: 'Full Record 2',
            [numberFieldId]: 200,
            [checkboxFieldId]: false,
            [dateFieldId]: now,
            [singleSelectFieldId]: optionBId,
            [multiSelectFieldId]: [tag2Id, tag3Id],
          },
        },
      ]);

      expect(records.length).toBe(2);

      // Verify via listRecords
      const allRecords = await listRecords(tableId);
      const foundRecords = allRecords.filter((r) => records.some((rec) => rec.id === r.id));

      expect(foundRecords.length).toBe(2);

      const record1 = foundRecords.find((r) => r.fields[textFieldId] === 'Full Record 1');
      expect(record1).toBeDefined();
      expect(record1?.fields[numberFieldId]).toBe(100);
      expect(record1?.fields[checkboxFieldId]).toBe(true);
      expect(record1?.fields[singleSelectFieldId]).toBe(optionAName);
    });
  });

  describe('typecast mode', () => {
    let tableId: string;
    let textFieldId: string;
    let numberFieldId: string;

    beforeAll(async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: 'Typecast Test Table',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'number', name: 'Amount' },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      textFieldId = table.fields.find((f) => f.name === 'Title')?.id ?? '';
      numberFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';
    });

    it('converts string to number when typecast is true', async () => {
      const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId,
          records: [
            {
              fields: {
                [textFieldId]: 'Typecast Record',
                [numberFieldId]: '123',
              },
            },
          ],
          typecast: true,
        }),
      });

      expect(response.status).toBe(201);
      const rawBody = await response.json();
      const parsed = createRecordsOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.ok).toBe(true);
      if (!parsed.data.ok) return;

      expect(parsed.data.data.records[0].fields[numberFieldId]).toBe(123);
    });

    it('auto creates select options when typecast is enabled', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: 'Typecast Select Options',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'singleSelect', name: 'Status', options: ['Open', 'Done'] },
          { type: 'multipleSelect', name: 'Tags', options: ['Tag A', 'Tag B'] },
        ],
        views: [{ type: 'grid' }],
      });

      const primaryFieldId = table.fields.find((f) => f.name === 'Title')?.id ?? '';
      const singleSelectFieldId = table.fields.find((f) => f.name === 'Status')?.id ?? '';
      const multiSelectFieldId = table.fields.find((f) => f.name === 'Tags')?.id ?? '';

      const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          typecast: true,
          records: [
            {
              fields: {
                [primaryFieldId]: 'Auto Create',
                [singleSelectFieldId]: 'In Progress',
                [multiSelectFieldId]: ['Tag A', 'Tag Z'],
              },
            },
          ],
        }),
      });

      expect(response.status).toBe(201);
      const rawBody = await response.json();
      const parsed = createRecordsOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.ok).toBe(true);
      if (!parsed.data.ok) return;

      const recordFields = parsed.data.data.records[0].fields;
      expect(recordFields[singleSelectFieldId]).toBe('In Progress');
      const multiValue = recordFields[multiSelectFieldId];
      const normalizedMulti = Array.isArray(multiValue)
        ? multiValue
        : normalizeJsonArray(multiValue);
      expect(normalizedMulti).toContain('Tag Z');

      const updatedTable = await getTableById(table.id);
      const singleSelectField = updatedTable.fields.find(
        (field) => field.id === singleSelectFieldId
      );
      const singleChoices =
        (singleSelectField?.options as { choices?: Array<{ name: string }> })?.choices ?? [];
      expect(singleChoices.some((choice) => choice.name === 'In Progress')).toBe(true);

      const multiSelectField = updatedTable.fields.find((field) => field.id === multiSelectFieldId);
      const multiChoices =
        (multiSelectField?.options as { choices?: Array<{ name: string }> })?.choices ?? [];
      expect(multiChoices.some((choice) => choice.name === 'Tag Z')).toBe(true);
    });

    it('rejects string for number field when typecast is false', async () => {
      const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId,
          records: [
            {
              fields: {
                [textFieldId]: 'No Typecast Record',
                [numberFieldId]: '456',
              },
            },
          ],
          typecast: false,
        }),
      });

      expect(response.status).toBe(400);
    });

    describe('link field typecast with title lookup', () => {
      let foreignTableId: string;
      let mainTableId: string;
      let foreignTitleFieldId: string;
      let mainTitleFieldId: string;
      let linkFieldId: string;
      let foreignRecordId: string;
      let foreignRecordIdB: string;
      let foreignRecordIdC: string;

      beforeAll(async () => {
        // Create foreign table with a known record
        const foreignTable = await createTable({
          baseId: ctx.baseId,
          name: 'Typecast Link Foreign',
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        });
        foreignTableId = foreignTable.id;
        foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';

        // Create a foreign record with known title
        const fr = await createRecord(foreignTableId, { [foreignTitleFieldId]: 'Known Title' });
        foreignRecordId = fr.id;
        const frB = await createRecord(foreignTableId, { [foreignTitleFieldId]: 'Known Title B' });
        foreignRecordIdB = frB.id;
        const frC = await createRecord(foreignTableId, { [foreignTitleFieldId]: 'Known Title C' });
        foreignRecordIdC = frC.id;

        // Create main table with manyMany link
        const mainTable = await createTable({
          baseId: ctx.baseId,
          name: 'Typecast Link Main',
          fields: [
            { type: 'singleLineText', name: 'Title', isPrimary: true },
            {
              type: 'link',
              name: 'Links',
              options: {
                relationship: 'manyMany',
                foreignTableId,
                lookupFieldId: foreignTitleFieldId,
                isOneWay: true,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });
        mainTableId = mainTable.id;
        mainTitleFieldId = mainTable.fields.find((f) => f.name === 'Title')?.id ?? '';
        linkFieldId = mainTable.fields.find((f) => f.name === 'Links')?.id ?? '';
      });

      it('resolves link by title when typecast is true', async () => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: mainTableId,
            records: [
              {
                fields: {
                  [mainTitleFieldId]: 'Link by Title',
                  [linkFieldId]: ['Known Title'],
                },
              },
            ],
            typecast: true,
          }),
        });

        expect(response.status).toBe(201);
        const rawBody = await response.json();
        const parsed = createRecordsOkResponseSchema.safeParse(rawBody);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;

        expect(parsed.data.ok).toBe(true);
        if (!parsed.data.ok) return;

        // Verify via listRecords that link was resolved
        await processOutbox();
        const records = await listRecords(mainTableId);
        const foundRecord = records.find((r) => r.fields[mainTitleFieldId] === 'Link by Title');
        expect(foundRecord).toBeDefined();

        const links = foundRecord?.fields[linkFieldId] as Array<{ id: string; title?: string }>;
        expect(links).toBeDefined();
        expect(links.length).toBe(1);
        expect(links[0].id).toBe(foreignRecordId);
      });

      it('resolves comma-separated titles when typecast is true', async () => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: mainTableId,
            records: [
              {
                fields: {
                  [mainTitleFieldId]: 'Link by Title List',
                  [linkFieldId]: 'Known Title B,Known Title C',
                },
              },
            ],
            typecast: true,
          }),
        });

        expect(response.status).toBe(201);
        const rawBody = await response.json();
        const parsed = createRecordsOkResponseSchema.safeParse(rawBody);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return;

        const links = parsed.data.data.records[0]?.fields[linkFieldId] as Array<{
          id: string;
          title?: string;
        }>;
        expect(links).toEqual([
          { id: foreignRecordIdB, title: 'Known Title B' },
          { id: foreignRecordIdC, title: 'Known Title C' },
        ]);
      });

      it('rejects string array for link field when typecast is false', async () => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: mainTableId,
            records: [
              {
                fields: {
                  [mainTitleFieldId]: 'Should Fail',
                  [linkFieldId]: ['Known Title'],
                },
              },
            ],
            typecast: false,
          }),
        });

        expect(response.status).toBe(400);
      });
    });
  });
});
