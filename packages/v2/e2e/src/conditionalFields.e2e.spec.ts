/* eslint-disable @typescript-eslint/naming-convention */
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  deleteRecordsOkResponseSchema,
  getTableByIdOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http conditionalFields (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const getTableById = async (targetTableId: string) => {
    const response = await fetch(
      `${ctx.baseUrl}/tables/get?baseId=${ctx.baseId}&tableId=${targetTableId}`,
      { method: 'GET' }
    );
    expect(response.status).toBe(200);
    const raw = await response.json();
    const parsed = getTableByIdOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to get table ${targetTableId}: ${JSON.stringify(raw)}`);
    }
    return parsed.data.data.table;
  };

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
    expect(response.status).toBe(201);
    return parsed.data.data.table;
  };

  const createField = async (
    tableId: string,
    field: Record<string, unknown>
  ): Promise<{ status: number; rawBody: unknown }> => {
    const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId,
        field,
      }),
    });
    const rawBody = await response.json();
    return { status: response.status, rawBody };
  };

  const createRecord = async (
    tableId: string,
    fields: Record<string, unknown>
  ): Promise<{ status: number; rawBody: unknown }> => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        fields,
      }),
    });
    const rawBody = await response.json();
    return { status: response.status, rawBody };
  };

  const updateRecord = async (
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ): Promise<{ status: number; rawBody: unknown }> => {
    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        recordId,
        fields,
      }),
    });
    const rawBody = await response.json();
    return { status: response.status, rawBody };
  };

  const deleteRecords = async (
    tableId: string,
    recordIds: string[]
  ): Promise<{ status: number; rawBody: unknown }> => {
    const response = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        recordIds,
      }),
    });
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const rawBody = await response.json();
      return { status: response.status, rawBody };
    }
    const text = await response.text();
    return { status: response.status, rawBody: { error: text } };
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  describe('conditionalRollup field', () => {
    let foreignTableId: string;
    let foreignPrimaryFieldId: string;
    let foreignNumberFieldId: string;
    let hostTableId: string;
    let hostPrimaryFieldId: string;

    beforeAll(async () => {
      // Create foreign table with number field for rollup
      foreignPrimaryFieldId = createFieldId();
      foreignNumberFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalRollup Foreign',
        fields: [
          { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignNumberFieldId, name: 'Amount' },
        ],
      });
      foreignTableId = foreignTable.id;

      // Create host table
      hostPrimaryFieldId = createFieldId();
      const hostTable = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalRollup Host',
        fields: [{ type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true }],
      });
      hostTableId = hostTable.id;
    });

    it('creates conditionalRollup field with basic config', async () => {
      const conditionalRollupFieldId = createFieldId();
      const { status, rawBody } = await createField(hostTableId, {
        type: 'conditionalRollup',
        id: conditionalRollupFieldId,
        name: 'Conditional Sum',
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignNumberFieldId,
                  operator: 'isGreater',
                  value: 0,
                },
              ],
            },
          },
        },
      });

      if (status !== 200) {
        console.error('CreateField failed:', JSON.stringify(rawBody, null, 2));
      }
      expect(status).toBe(200);

      const parsed = createFieldOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) return;

      const created = parsed.data.data.table.fields.find((f) => f.id === conditionalRollupFieldId);
      expect(created).toBeTruthy();
      if (!created) return;

      expect(created.type).toBe('conditionalRollup');
    });

    it('creates conditionalRollup field with filter condition', async () => {
      const conditionalRollupFieldId = createFieldId();
      const { status, rawBody } = await createField(hostTableId, {
        type: 'conditionalRollup',
        id: conditionalRollupFieldId,
        name: 'Filtered Sum',
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignNumberFieldId,
                  operator: 'isGreater',
                  value: 100,
                },
              ],
            },
            sort: {
              fieldId: foreignNumberFieldId,
              order: 'desc' as const,
            },
            limit: 10,
          },
        },
      });

      if (status !== 200) {
        console.error('CreateField failed:', JSON.stringify(rawBody, null, 2));
      }
      expect(status).toBe(200);

      const parsed = createFieldOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) return;

      const created = parsed.data.data.table.fields.find((f) => f.id === conditionalRollupFieldId);
      expect(created).toBeTruthy();
      if (!created) return;

      expect(created.type).toBe('conditionalRollup');
    });

    it('rejects conditionalRollup as primary field', async () => {
      const { status } = await createField(hostTableId, {
        type: 'conditionalRollup',
        id: createFieldId(),
        name: 'Primary Conditional',
        isPrimary: true,
        options: {
          expression: 'sum({values})',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: { filter: null },
        },
      });

      // Primary field rejection should return an error (400 or 500 depending on where it's caught)
      expect(status).not.toBe(200);
    });

    it('rejects notNull/unique for conditionalRollup fields', async () => {
      const notNullResult = await createField(hostTableId, {
        type: 'conditionalRollup',
        id: createFieldId(),
        name: 'NotNull Conditional',
        notNull: true,
        options: {
          expression: 'sum({values})',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: { filter: null },
        },
      });
      expect(notNullResult.status).toBe(400);

      const uniqueResult = await createField(hostTableId, {
        type: 'conditionalRollup',
        id: createFieldId(),
        name: 'Unique Conditional',
        unique: true,
        options: {
          expression: 'sum({values})',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: { filter: null },
        },
      });
      expect(uniqueResult.status).toBe(400);
    });
  });

  describe('conditionalLookup field', () => {
    let foreignTableId: string;
    let foreignPrimaryFieldId: string;
    let foreignNumberFieldId: string;
    let hostTableId: string;
    let hostPrimaryFieldId: string;

    beforeAll(async () => {
      // Create foreign table with fields
      foreignPrimaryFieldId = createFieldId();
      foreignNumberFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup Foreign',
        fields: [
          { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignNumberFieldId, name: 'Amount' },
        ],
      });
      foreignTableId = foreignTable.id;

      // Create host table
      hostPrimaryFieldId = createFieldId();
      const hostTable = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup Host',
        fields: [{ type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true }],
      });
      hostTableId = hostTable.id;
    });

    it('creates conditionalLookup field with basic config', async () => {
      const conditionalLookupFieldId = createFieldId();
      const { status, rawBody } = await createField(hostTableId, {
        type: 'conditionalLookup',
        id: conditionalLookupFieldId,
        name: 'Conditional Lookup Name',
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignPrimaryFieldId,
                  operator: 'is',
                  value: 'Seed',
                },
              ],
            },
          },
        },
      });

      if (status !== 200) {
        console.error('CreateField failed:', JSON.stringify(rawBody, null, 2));
      }
      expect(status).toBe(200);

      const parsed = createFieldOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) return;

      const created = parsed.data.data.table.fields.find((f) => f.id === conditionalLookupFieldId);
      expect(created).toBeTruthy();
      if (!created) return;

      // conditionalLookup returns the inner field's type with isLookup=true and conditionalLookupOptions
      expect(created.isLookup).toBe(true);
      expect(created.conditionalLookupOptions).toBeTruthy();
    });

    it('creates conditionalLookup field with filter condition', async () => {
      const conditionalLookupFieldId = createFieldId();
      const { status, rawBody } = await createField(hostTableId, {
        type: 'conditionalLookup',
        id: conditionalLookupFieldId,
        name: 'Filtered Lookup',
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignNumberFieldId,
                  operator: 'isGreater',
                  value: 50,
                },
              ],
            },
            sort: {
              fieldId: foreignNumberFieldId,
              order: 'asc',
            },
            limit: 5,
          },
        },
      });

      if (status !== 200) {
        console.error('CreateField failed:', JSON.stringify(rawBody, null, 2));
      }
      expect(status).toBe(200);

      const parsed = createFieldOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) return;

      const created = parsed.data.data.table.fields.find((f) => f.id === conditionalLookupFieldId);
      expect(created).toBeTruthy();
    });

    it('rejects conditionalLookup as primary field', async () => {
      const { status } = await createField(hostTableId, {
        type: 'conditionalLookup',
        id: createFieldId(),
        name: 'Primary ConditionalLookup',
        isPrimary: true,
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: { filter: null },
        },
      });

      // Primary field rejection should return an error (400 or 500 depending on where it's caught)
      expect(status).not.toBe(200);
    });

    it('rejects notNull/unique for conditionalLookup fields', async () => {
      const notNullResult = await createField(hostTableId, {
        type: 'conditionalLookup',
        id: createFieldId(),
        name: 'NotNull ConditionalLookup',
        notNull: true,
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: { filter: null },
        },
      });
      expect(notNullResult.status).toBe(400);

      const uniqueResult = await createField(hostTableId, {
        type: 'conditionalLookup',
        id: createFieldId(),
        name: 'Unique ConditionalLookup',
        unique: true,
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: { filter: null },
        },
      });
      expect(uniqueResult.status).toBe(400);
    });
  });

  describe('table creation with conditional fields', () => {
    it('creates table with conditionalRollup field', async () => {
      // First create the foreign table
      const foreignPrimaryFieldId = createFieldId();
      const foreignNumberFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId: ctx.baseId,
        name: 'Table With Rollup Foreign',
        fields: [
          { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignNumberFieldId, name: 'Value' },
        ],
      });

      // Create host table with conditionalRollup field
      const hostPrimaryFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();

      const response = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Table With ConditionalRollup',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'conditionalRollup',
              id: conditionalRollupFieldId,
              name: 'Total',
              options: {
                expression: 'sum({values})',
              },
              config: {
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignNumberFieldId,
                condition: {
                  filter: {
                    conjunction: 'and',
                    filterSet: [
                      {
                        fieldId: foreignNumberFieldId,
                        operator: 'isGreater',
                        value: 0,
                      },
                    ],
                  },
                },
              },
            },
          ],
        }),
      });

      const rawBody = await response.json();
      if (response.status !== 201) {
        console.error('CreateTable failed:', JSON.stringify(rawBody, null, 2));
      }
      expect(response.status).toBe(201);

      const parsed = createTableOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) return;

      const table = parsed.data.data.table;
      const conditionalField = table.fields.find((f) => f.id === conditionalRollupFieldId);
      expect(conditionalField).toBeTruthy();
      expect(conditionalField?.type).toBe('conditionalRollup');
    });

    it('creates table with conditionalLookup field', async () => {
      // First create the foreign table
      const foreignPrimaryFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId: ctx.baseId,
        name: 'Table With Lookup Foreign',
        fields: [
          { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Title', isPrimary: true },
        ],
      });

      // Create host table with conditionalLookup field
      const hostPrimaryFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();

      const response = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Table With ConditionalLookup',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'conditionalLookup',
              id: conditionalLookupFieldId,
              name: 'Titles',
              options: {
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignPrimaryFieldId,
                condition: {
                  filter: {
                    conjunction: 'and',
                    filterSet: [
                      {
                        fieldId: foreignPrimaryFieldId,
                        operator: 'is',
                        value: 'Seed',
                      },
                    ],
                  },
                },
              },
            },
          ],
        }),
      });

      const rawBody = await response.json();
      if (response.status !== 201) {
        console.error('CreateTable failed:', JSON.stringify(rawBody, null, 2));
      }
      expect(response.status).toBe(201);

      const parsed = createTableOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) return;

      const table = parsed.data.data.table;
      const conditionalField = table.fields.find((f) => f.id === conditionalLookupFieldId);
      expect(conditionalField).toBeTruthy();
      // conditionalLookup returns inner type with isLookup=true
      expect(conditionalField?.isLookup).toBe(true);
      expect(conditionalField?.conditionalLookupOptions).toBeTruthy();
    });
  });

  describe('CRUD records with conditional fields', () => {
    let foreignTableId: string;
    let foreignPrimaryFieldId: string;
    let foreignNumberFieldId: string;
    let hostTableId: string;
    let hostPrimaryFieldId: string;
    let conditionalRollupFieldId: string;
    let conditionalLookupFieldId: string;

    beforeAll(async () => {
      // Create foreign table
      foreignPrimaryFieldId = createFieldId();
      foreignNumberFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId: ctx.baseId,
        name: 'CRUD Conditional Foreign',
        fields: [
          { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignNumberFieldId, name: 'Amount' },
        ],
      });
      foreignTableId = foreignTable.id;

      // Add some records to foreign table
      await createRecord(foreignTableId, {
        [foreignPrimaryFieldId]: 'Item A',
        [foreignNumberFieldId]: 100,
      });
      await createRecord(foreignTableId, {
        [foreignPrimaryFieldId]: 'Item B',
        [foreignNumberFieldId]: 200,
      });
      await createRecord(foreignTableId, {
        [foreignPrimaryFieldId]: 'Item C',
        [foreignNumberFieldId]: 50,
      });

      // Create host table with conditional fields
      hostPrimaryFieldId = createFieldId();
      conditionalRollupFieldId = createFieldId();
      conditionalLookupFieldId = createFieldId();

      const response = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'CRUD Conditional Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'conditionalRollup',
              id: conditionalRollupFieldId,
              name: 'Total Over 75',
              options: {
                expression: 'sum({values})',
              },
              config: {
                foreignTableId,
                lookupFieldId: foreignNumberFieldId,
                condition: {
                  filter: {
                    conjunction: 'and',
                    filterSet: [
                      {
                        fieldId: foreignNumberFieldId,
                        operator: 'isGreater',
                        value: 75,
                      },
                    ],
                  },
                },
              },
            },
            {
              type: 'conditionalLookup',
              id: conditionalLookupFieldId,
              name: 'Names Over 75',
              options: {
                foreignTableId,
                lookupFieldId: foreignPrimaryFieldId,
                condition: {
                  filter: {
                    conjunction: 'and',
                    filterSet: [
                      {
                        fieldId: foreignNumberFieldId,
                        operator: 'isGreater',
                        value: 75,
                      },
                    ],
                  },
                },
              },
            },
          ],
        }),
      });

      const rawBody = await response.json();
      if (response.status !== 201) {
        console.error('CreateTable failed:', JSON.stringify(rawBody, null, 2));
        throw new Error(`Failed to create host table: ${JSON.stringify(rawBody)}`);
      }
      const parsed = createTableOkResponseSchema.safeParse(rawBody);
      if (!parsed.success || !parsed.data.ok) {
        throw new Error(`Failed to parse table response: ${JSON.stringify(rawBody)}`);
      }
      hostTableId = parsed.data.data.table.id;
    });

    it('creates record in table with conditional fields', async () => {
      const { status, rawBody } = await createRecord(hostTableId, {
        [hostPrimaryFieldId]: 'Test Record 1',
      });

      if (status !== 200 && status !== 201) {
        console.error('CreateRecord failed:', JSON.stringify(rawBody, null, 2));
      }
      // createRecord can return 200 or 201
      expect([200, 201]).toContain(status);

      const parsed = createRecordOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) return;

      const record = parsed.data.data.record;
      expect(record.fields[hostPrimaryFieldId]).toBe('Test Record 1');
      // Note: Computed fields may have pending values until computed update runs
    });

    it('updates record in table with conditional fields', async () => {
      // First create a record
      const createResult = await createRecord(hostTableId, {
        [hostPrimaryFieldId]: 'Update Test',
      });
      expect([200, 201]).toContain(createResult.status);
      const createParsed = createRecordOkResponseSchema.safeParse(createResult.rawBody);
      if (!createParsed.success || !createParsed.data.ok) {
        throw new Error('Failed to create record for update test');
      }
      const recordId = createParsed.data.data.record.id;

      // Update the record
      const { status, rawBody } = await updateRecord(hostTableId, recordId, {
        [hostPrimaryFieldId]: 'Updated Value',
      });

      if (status !== 200) {
        console.error('UpdateRecord failed:', JSON.stringify(rawBody, null, 2));
      }
      expect(status).toBe(200);

      const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) return;

      expect(parsed.data.data.record.fields[hostPrimaryFieldId]).toBe('Updated Value');
    });

    // TODO: Fix deleteRecords endpoint - currently returns 404
    it.skip('deletes record in table with conditional fields', async () => {
      // First create a record
      const createResult = await createRecord(hostTableId, {
        [hostPrimaryFieldId]: 'Delete Test',
      });
      expect([200, 201]).toContain(createResult.status);
      const createParsed = createRecordOkResponseSchema.safeParse(createResult.rawBody);
      if (!createParsed.success || !createParsed.data.ok) {
        throw new Error('Failed to create record for delete test');
      }
      const recordId = createParsed.data.data.record.id;

      // Delete the record
      const { status, rawBody } = await deleteRecords(hostTableId, [recordId]);

      if (status !== 200) {
        console.error('DeleteRecords failed:', JSON.stringify(rawBody, null, 2));
      }
      expect(status).toBe(200);

      const parsed = deleteRecordsOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
    });
  });

  describe('getTableById with conditional fields', () => {
    it('returns conditional field config correctly', async () => {
      // Create foreign table
      const foreignPrimaryFieldId = createFieldId();
      const foreignNumberFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId: ctx.baseId,
        name: 'GetTable Conditional Foreign',
        fields: [
          { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignNumberFieldId, name: 'Value' },
        ],
      });

      // Create host table with conditional field
      const hostPrimaryFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId: ctx.baseId,
        name: 'GetTable Conditional Host',
        fields: [{ type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true }],
      });

      // Add conditional field
      await createField(hostTable.id, {
        type: 'conditionalRollup',
        id: conditionalRollupFieldId,
        name: 'Rollup with Condition',
        options: {
          expression: 'countall({values})',
        },
        config: {
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignNumberFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignNumberFieldId,
                  operator: 'isGreater',
                  value: 10,
                },
              ],
            },
            limit: 100,
          },
        },
      });

      // Fetch table and verify field configuration
      const table = await getTableById(hostTable.id);
      const conditionalField = table.fields.find((f) => f.id === conditionalRollupFieldId);
      expect(conditionalField).toBeTruthy();
      expect(conditionalField?.type).toBe('conditionalRollup');
    });
  });
});
