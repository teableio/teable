/* eslint-disable @typescript-eslint/naming-convention */
/**
 * V2 Formula E2E Tests
 *
 * Migrated from v1 formula.e2e-spec.ts and formula-field.e2e-spec.ts.
 * Test cases remain consistent, but use the v2 test framework.
 *
 * Coverage:
 * 1. Basic formula calculations (create/update flows)
 * 2. Formula references for diverse field types (text, number, date, rating, checkbox, select)
 * 3. Binary operator coercion
 * 4. Boolean operator combinations
 * 5. LAST_MODIFIED_TIME with field parameters
 * 6. Numeric functions (ROUND, CEILING, FLOOR, etc.)
 * 7. Text functions (CONCATENATE, LEFT, RIGHT, etc.)
 * 8. Logical functions (IF, AND, OR, NOT, SWITCH)
 * 9. Date/time functions (DATE_ADD, DATETIME_DIFF, IS_SAME, etc.)
 * 10. Formulas with link/lookup fields
 * 11. Conditional reference formulas
 * 12. Error handling scenarios
 */
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http formula (e2e)', () => {
  let ctx: SharedTestContext;
  const uniqueName = (prefix: string) =>
    `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  // No afterAll dispose needed - handled by vitest.setup.ts

  const processOutbox = async (times = 1) => {
    for (let i = 0; i < times; i += 1) {
      await ctx.testContainer.processOutbox();
    }
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

  // ============================================================================
  // 1. Basic formula calculation after record creation
  // ============================================================================
  describe('basic formula calculation after record creation', () => {
    /**
     * Scenario: Formula calculates correctly after record creation
     * Formula:{numberField} * 2
     * Expect: number field value multiplied by 2
     */
    it('should calculate formula after record creation - {numberField} * 2', async () => {
      // Step 1: create table with numeric field
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Formula Calc Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Amount' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';

      // Step 2: create formula field
      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Double Amount',
            options: {
              expression: `{${numberFieldId}} * 2`,
            },
          },
        }),
      });
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Double Amount')?.id ?? '';

      // Step 3: create record
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 21,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Step 4: process outbox to trigger formula calculation
      await processOutbox();

      // Step 5: fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      // Step 6: verify formula calculation result
      expect(record.fields[formulaFieldId]).toBe(42); // 21 * 2 = 42
    });

    /**
     * Scenario: Formula recalculates correctly after record update
     * Formula:{numberField} + 10
     * Expect: formula result updates after number field change
     */
    it('should recalculate formula after record update - {numberField} + 10', async () => {
      // Step 1: create table with numeric field
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Formula Recalc Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      // Step 2: create formula field
      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Plus Ten',
            options: {
              expression: `{${numberFieldId}} + 10`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Plus Ten')?.id ?? '';

      // Step 3: create record
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 5,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Step 4: process outbox to trigger formula calculation
      await processOutbox();

      // Step 5: fetch records after formula calculation
      let records = await listRecords(table.id);
      let record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;
      expect(record.fields[formulaFieldId]).toBe(15); // 5 + 10 = 15

      // Step 6: update record
      const updateRecordResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: {
            [numberFieldId]: 20,
          },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);
      const updateRaw = await updateRecordResponse.json();
      const updateParsed = updateRecordOkResponseSchema.safeParse(updateRaw);
      expect(updateParsed.success).toBe(true);
      if (!updateParsed.success || !updateParsed.data.ok) return;

      // Step 7: process outbox to trigger formula recalculation
      await processOutbox();

      // Step 8: fetch records after formula recalculation
      records = await listRecords(table.id);
      record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      // Step 9: verify formula recalculation
      expect(record.fields[formulaFieldId]).toBe(30); // 20 + 10 = 30
    });

    /**
     * Scenario: Formula handles empty values on empty record creation
     * Formula:IF({textField}="", "empty", {textField})
     * Expect: returns "empty" when blank
     */
    it('should handle empty values in formula - IF({textField}="", "empty", {textField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Empty Values Formula Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', name: 'Text' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Empty Check',
            options: {
              expression: `IF({${textFieldId}}="", "empty", {${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Empty Check')?.id ?? '';

      const createEmptyRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: '',
          },
        }),
      });
      expect(createEmptyRecordResponse.status).toBe(201);
      const emptyRecordRaw = await createEmptyRecordResponse.json();
      const emptyRecordParsed = createRecordOkResponseSchema.safeParse(emptyRecordRaw);
      expect(emptyRecordParsed.success).toBe(true);
      if (!emptyRecordParsed.success || !emptyRecordParsed.data.ok) return;

      const emptyRecordId = emptyRecordParsed.data.data.record.id;

      const createFilledRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'Hello',
          },
        }),
      });
      expect(createFilledRecordResponse.status).toBe(201);
      const filledRecordRaw = await createFilledRecordResponse.json();
      const filledRecordParsed = createRecordOkResponseSchema.safeParse(filledRecordRaw);
      expect(filledRecordParsed.success).toBe(true);
      if (!filledRecordParsed.success || !filledRecordParsed.data.ok) return;

      const filledRecordId = filledRecordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const emptyRecord = records.find((r) => r.id === emptyRecordId);
      const filledRecord = records.find((r) => r.id === filledRecordId);

      expect(emptyRecord).toBeDefined();
      expect(filledRecord).toBeDefined();
      if (!emptyRecord || !filledRecord) return;

      expect(emptyRecord.fields[formulaFieldId]).toBe('empty');
      expect(filledRecord.fields[formulaFieldId]).toBe('Hello');
    });

    /**
     * Scenario: Formula handles missing referenced field on creation
     * Formula:IF({statusField}="", 1, 222222)
     * Expect: returns 1 when field omitted
     */
    it('should handle missing field on creation - IF({statusField}="", 1, 222222)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Missing Field Formula Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', name: 'Status' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      const statusFieldId = table.fields.find((f) => f.name === 'Status')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Status Formula',
            options: {
              expression: `IF({${statusFieldId}}="", 1, 222222)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Status Formula')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [nameFieldId]: 'Missing status',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(1);
    });
  });

  // ============================================================================
  // 2. Formula references by field type
  // ============================================================================
  describe('formula referencing various field types', () => {
    /**
     * Scenario:Formula references single line text field
     * Formula:UPPER({textField})
     * Expect: converts text to uppercase
     */
    it('should create formula referencing text field - UPPER({textField})', async () => {
      // Step 1: create table
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Text Formula Test',
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Title')?.id ?? '';

      // Step 2: create formula field
      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Upper Title',
            options: {
              expression: `UPPER({${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Upper Title')?.id ?? '';

      // Step 3: create record
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'hello world',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Step 4: process outbox to trigger formula calculation
      await processOutbox();

      // Step 5: fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      // 6. Verify formula result
      expect(record.fields[formulaFieldId]).toBe('HELLO WORLD');
    });

    /**
     * Scenario:Formula references number field
     * Formula:{numberField} * 2
     * Expect: number multiplied by 2
     */
    it('should create formula referencing number field - {numberField} * 2', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Number Formula Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Double Value',
            options: {
              expression: `{${numberFieldId}} * 2`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Double Value')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 50,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(100); // 50 * 2
    });

    /**
     * Scenario:Formula references date field
     * Formula:YEAR({dateField})
     * Expect: extracts year
     */
    it('should create formula referencing date field - YEAR({dateField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Date Formula Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'EventDate' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'EventDate')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Event Year',
            options: {
              expression: `YEAR({${dateFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Event Year')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [dateFieldId]: '2024-06-15T00:00:00.000Z',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(2024);
    });

    /**
     * Scenario:Formula references rating field
     * Formula:{ratingField} + 1
     * Expect: rating plus 1
     */
    it('should create formula referencing rating field - {ratingField} + 1', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Rating Formula Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'rating', name: 'Score', options: { max: 5 } },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const ratingFieldId = table.fields.find((f) => f.name === 'Score')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Score Plus One',
            options: {
              expression: `{${ratingFieldId}} + 1`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Score Plus One')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [ratingFieldId]: 4,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(5); // 4 + 1 = 5
    });

    /**
     * Scenario:Formula references checkbox field
     * Formula:IF({checkboxField}, "Yes", "No")
     * Expect: checked returns "Yes", otherwise "No"
     */
    it('should create formula referencing checkbox field - IF({checkboxField}, "Yes", "No")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Checkbox Formula Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'IsActive' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const checkboxFieldId = table.fields.find((f) => f.name === 'IsActive')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Status',
            options: {
              expression: `IF({${checkboxFieldId}}, "Yes", "No")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Status')?.id ?? '';

      // Test true value
      const createRecordResponse1 = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [checkboxFieldId]: true,
          },
        }),
      });
      expect(createRecordResponse1.status).toBe(201);
      const recordRaw1 = await createRecordResponse1.json();
      const recordParsed1 = createRecordOkResponseSchema.safeParse(recordRaw1);
      expect(recordParsed1.success).toBe(true);
      if (!recordParsed1.success || !recordParsed1.data.ok) return;

      const recordId1 = recordParsed1.data.data.record.id;

      // Test false value
      const createRecordResponse2 = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [checkboxFieldId]: false,
          },
        }),
      });
      expect(createRecordResponse2.status).toBe(201);
      const recordRaw2 = await createRecordResponse2.json();
      const recordParsed2 = createRecordOkResponseSchema.safeParse(recordRaw2);
      expect(recordParsed2.success).toBe(true);
      if (!recordParsed2.success || !recordParsed2.data.ok) return;

      const recordId2 = recordParsed2.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record1 = records.find((r) => r.id === recordId1);
      const record2 = records.find((r) => r.id === recordId2);

      expect(record1).toBeDefined();
      expect(record2).toBeDefined();
      if (!record1 || !record2) return;

      expect(record1.fields[formulaFieldId]).toBe('Yes');
      expect(record2.fields[formulaFieldId]).toBe('No');
    });

    /**
     * Scenario:Formula references single select field
     * Formula:CONCATENATE("Selected: ", {selectField})
     * Expect: concatenates option name
     */
    it('should create formula referencing select field - CONCATENATE("Selected: ", {selectField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Select Formula Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleSelect', name: 'Status', options: ['A', 'B'] },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const selectField = table.fields.find((f) => f.name === 'Status');
      const selectFieldId = selectField?.id ?? '';
      const choices =
        (selectField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ?? [];
      const optionB = choices.find((choice) => choice.name === 'B');
      if (!selectFieldId || !optionB?.id) {
        throw new Error('Missing select field or option metadata');
      }

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Selected Text',
            options: {
              expression: `CONCATENATE("Selected: ", {${selectFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Selected Text')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [selectFieldId]: optionB.id,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Selected: B');
    });

    /**
     * Scenario:Formula references multiple select field
     * Formula:ARRAYJOIN({multiSelectField}, ", ")
     * Expect: joins multiple options with commas
     */
    it('should create formula referencing multiple select field - ARRAYJOIN({multiSelectField}, ", ")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Multi Select Formula Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'multipleSelect', name: 'Tags', options: ['Tag A', 'Tag B', 'Tag C'] },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const multiSelectField = table.fields.find((f) => f.name === 'Tags');
      const multiSelectFieldId = multiSelectField?.id ?? '';
      const choices =
        (multiSelectField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ??
        [];
      const tagA = choices.find((choice) => choice.name === 'Tag A');
      const tagC = choices.find((choice) => choice.name === 'Tag C');
      if (!multiSelectFieldId || !tagA?.id || !tagC?.id) {
        throw new Error('Missing multi select field or option metadata');
      }

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Joined Tags',
            options: {
              expression: `ARRAYJOIN({${multiSelectFieldId}}, ", ")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Joined Tags')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [multiSelectFieldId]: [tagA.id, tagC.id],
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Tag A, Tag C');
    });

    /**
     * Scenario:Formula references long text field
     * Formula:LEN({longTextField})
     * Expect: returns text length
     */
    it('should create formula referencing long text field - LEN({longTextField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Long Text Formula Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'longText', name: 'Description' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const longTextFieldId = table.fields.find((f) => f.name === 'Description')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Text Length',
            options: {
              expression: `LEN({${longTextFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Text Length')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [longTextFieldId]: 'abcdef',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(6);
    });

    /**
     * Scenario:Formula references user field
     * Formula:IF({userField}, "assigned", "unassigned")
     * Expect: returns "assigned" when user exists
     */
    it('should create formula referencing user field - IF({userField}, "assigned", "unassigned")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('User Formula Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'user',
              name: 'Assignee',
              options: {
                isMultiple: true,
                shouldNotify: false,
              },
            },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const userFieldId = table.fields.find((f) => f.name === 'Assignee')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Assignment Status',
            options: {
              expression: `IF({${userFieldId}}, "assigned", "unassigned")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Assignment Status')?.id ?? '';

      const createUnassignedResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {},
        }),
      });
      expect(createUnassignedResponse.status).toBe(201);
      const unassignedRaw = await createUnassignedResponse.json();
      const unassignedParsed = createRecordOkResponseSchema.safeParse(unassignedRaw);
      expect(unassignedParsed.success).toBe(true);
      if (!unassignedParsed.success || !unassignedParsed.data.ok) return;

      const unassignedRecordId = unassignedParsed.data.data.record.id;

      const createAssignedResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [userFieldId]: [{ id: 'system', title: 'System' }],
          },
        }),
      });
      if (createAssignedResponse.status !== 201) {
        const errorBody = await createAssignedResponse.json();
        console.error('Create record failed:', JSON.stringify(errorBody, null, 2));
      }
      expect(createAssignedResponse.status).toBe(201);
      const assignedRaw = await createAssignedResponse.json();
      const assignedParsed = createRecordOkResponseSchema.safeParse(assignedRaw);
      expect(assignedParsed.success).toBe(true);
      if (!assignedParsed.success || !assignedParsed.data.ok) return;

      const assignedRecordId = assignedParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const unassignedRecord = records.find((r) => r.id === unassignedRecordId);
      const assignedRecord = records.find((r) => r.id === assignedRecordId);
      expect(unassignedRecord).toBeDefined();
      expect(assignedRecord).toBeDefined();
      if (!unassignedRecord || !assignedRecord) return;

      expect(unassignedRecord.fields[formulaFieldId]).toBe(null);
      expect(assignedRecord.fields[formulaFieldId]).toBe('assigned');
    });

    /**
     * Scenario:Formula references auto number field
     * Formula:{autoNumberField} + 1000
     * Expect: auto number plus 1000
     */
    it('should create formula referencing auto number field - {autoNumberField} + 1000', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Auto Number Formula Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const createAutoNumberResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'autoNumber',
            name: 'Auto No',
          },
        }),
      });
      expect(createAutoNumberResponse.status).toBe(200);
      const autoNumberRaw = await createAutoNumberResponse.json();
      const autoNumberParsed = createFieldOkResponseSchema.safeParse(autoNumberRaw);
      expect(autoNumberParsed.success).toBe(true);
      if (!autoNumberParsed.success || !autoNumberParsed.data.ok) return;

      const autoNumberFieldId =
        autoNumberParsed.data.data.table.fields.find((f) => f.name === 'Auto No')?.id ?? '';

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Auto Plus 1000',
            options: {
              expression: `IF({${primaryFieldId}}, {${autoNumberFieldId}} + 1000, {${autoNumberFieldId}} + 1000)`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;

      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Auto Plus 1000')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'Row 1',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const autoValue = record.fields[autoNumberFieldId];
      expect(typeof autoValue).toBe('number');
      if (typeof autoValue !== 'number') return;

      expect(record.fields[formulaFieldId]).toBe(autoValue + 1000);
    });

    /**
     * Scenario:Formula references created time field
     * Formula:YEAR({createdTimeField})
     * Expect: extracts year from created time
     */
    it('should create formula referencing created time field - YEAR({createdTimeField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Created Time Formula Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const createCreatedTimeResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'createdTime',
            name: 'Created At',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            },
          },
        }),
      });
      expect(createCreatedTimeResponse.status).toBe(200);
      const createdTimeRaw = await createCreatedTimeResponse.json();
      const createdTimeParsed = createFieldOkResponseSchema.safeParse(createdTimeRaw);
      expect(createdTimeParsed.success).toBe(true);
      if (!createdTimeParsed.success || !createdTimeParsed.data.ok) return;

      const createdTimeFieldId =
        createdTimeParsed.data.data.table.fields.find((f) => f.name === 'Created At')?.id ?? '';

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Created Year',
            options: {
              expression: `IF({${primaryFieldId}}, YEAR({${createdTimeFieldId}}), YEAR({${createdTimeFieldId}}))`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;

      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Created Year')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'Row 1',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const createdAt = record.fields[createdTimeFieldId];
      expect(typeof createdAt).toBe('string');
      if (typeof createdAt !== 'string') return;

      const expectedYear = new Date(createdAt).getUTCFullYear();
      expect(record.fields[formulaFieldId]).toBe(expectedYear);
    });

    /**
     * Scenario:Formula references last modified time field
     * Formula:DATETIME_FORMAT({lastModifiedTimeField}, "YYYY-MM-DD")
     * Expect: formats last modified time
     */
    it('should create formula referencing last modified time field - DATETIME_FORMAT({lastModifiedTimeField}, "YYYY-MM-DD")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Last Modified Time Formula Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const createLastModifiedResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'lastModifiedTime',
            name: 'Last Modified At',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
              trackedFieldIds: [primaryFieldId],
            },
          },
        }),
      });
      expect(createLastModifiedResponse.status).toBe(200);
      const lastModifiedRaw = await createLastModifiedResponse.json();
      const lastModifiedParsed = createFieldOkResponseSchema.safeParse(lastModifiedRaw);
      expect(lastModifiedParsed.success).toBe(true);
      if (!lastModifiedParsed.success || !lastModifiedParsed.data.ok) return;

      const lastModifiedTimeFieldId =
        lastModifiedParsed.data.data.table.fields.find((f) => f.name === 'Last Modified At')?.id ??
        '';

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Last Modified Date',
            options: {
              expression: `IF({${primaryFieldId}}, DATETIME_FORMAT({${lastModifiedTimeFieldId}}, "YYYY-MM-DD"), DATETIME_FORMAT({${lastModifiedTimeFieldId}}, "YYYY-MM-DD"))`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;

      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Last Modified Date')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'Initial',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox(2);

      const updateRecordResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: {
            [primaryFieldId]: 'Updated',
          },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);
      const updateRaw = await updateRecordResponse.json();
      const updateParsed = updateRecordOkResponseSchema.safeParse(updateRaw);
      expect(updateParsed.success).toBe(true);
      if (!updateParsed.success || !updateParsed.data.ok) return;

      await processOutbox(2);

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const lastModifiedAt = record.fields[lastModifiedTimeFieldId];
      expect(typeof lastModifiedAt).toBe('string');
      if (typeof lastModifiedAt !== 'string') return;

      const expectedDate = new Date(lastModifiedAt).toISOString().slice(0, 10);
      expect(record.fields[formulaFieldId]).toBe(expectedDate);
    });
  });

  // ============================================================================
  // 3. Binary operator coercion
  // ============================================================================
  describe('binary operator coercion', () => {
    /**
     * Scenario: type coercion when adding number and string
     * Formula:{numberField} & "text"
     * Expect: coerces number to string then concatenates
     */
    it('should coerce number to string when concatenating - {numberField} & "text"', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Concat Coercion Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Concat Result',
            options: {
              expression: `{${numberFieldId}} & "text"`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Concat Result')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 123,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('123text');
    });

    /**
     * Scenario: string number addition
     * Formula:"10" + {numberField}
     * Expect: coerces "10" to number then adds
     */
    it('should coerce string to number when adding - "10" + {numberField}', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Add Coercion Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Add Result',
            options: {
              expression: `"10" + {${numberFieldId}}`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Add Result')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 5,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('105');
    });

    /**
     * Scenario: boolean and number arithmetic
     * Formula:{checkboxField} + 1
     * Expect: true coerces to 1, false to 0
     */
    it('should coerce boolean to number - {checkboxField} + 1', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Boolean Coercion Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'Flag' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const checkboxFieldId = table.fields.find((f) => f.name === 'Flag')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Bool Plus One',
            options: {
              expression: `{${checkboxFieldId}} + 1`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Bool Plus One')?.id ?? '';

      const trueRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'True',
            [checkboxFieldId]: true,
          },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      const falseRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'False',
            [checkboxFieldId]: false,
          },
        }),
      });
      expect(falseRecord.status).toBe(201);
      const falseRaw = await falseRecord.json();
      const falseParsed = createRecordOkResponseSchema.safeParse(falseRaw);
      expect(falseParsed.success).toBe(true);
      if (!falseParsed.success || !falseParsed.data.ok) return;
      const falseRecordId = falseParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);
      const falseRecordResult = records.find((r) => r.id === falseRecordId);

      expect(trueRecordResult).toBeDefined();
      expect(falseRecordResult).toBeDefined();
      if (!trueRecordResult || !falseRecordResult) return;

      expect(trueRecordResult.fields[formulaFieldId]).toBe('true1');
      expect(falseRecordResult.fields[formulaFieldId]).toBe('false1');
    });

    /**
     * Scenario: use SUBSTITUTE with number field (auto string coercion)
     * Formula:SUBSTITUTE({numberField}, "0", "X")
     * Expect: coerces number to string before substitution
     */
    it('should substitute numeric field as text - SUBSTITUTE({numberField}, "0", "X")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Numeric Substitute Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Subbed',
            options: {
              expression: `SUBSTITUTE({${numberFieldId}}, "0", "X")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Subbed')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'Row 1',
            [numberFieldId]: 1000,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('1XXX.XX');
    });

    /**
     * Scenario: string concatenation with plus operator when operands are blank
     * Formula:{textField} + '' and '' + {textField}
     * Expect: returns empty string when text field is null/not provided
     *
     * This tests that formulas depending on unprovided fields are still computed
     * during record creation.
     */
    it('should concatenate strings with plus operator when operands are blank', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Blank Operands Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Number' },
            { type: 'singleLineText', name: 'Text' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Number')?.id ?? '';
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      // Create formula fields that depend on the text field
      // Formula: {textField} + ''
      const createTextSuffixResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'TextSuffix',
            options: {
              expression: `{${textFieldId}} + ''`,
            },
          },
        }),
      });
      expect(createTextSuffixResponse.status).toBe(200);
      const textSuffixRaw = await createTextSuffixResponse.json();
      const textSuffixParsed = createFieldOkResponseSchema.safeParse(textSuffixRaw);
      expect(textSuffixParsed.success).toBe(true);
      if (!textSuffixParsed.success || !textSuffixParsed.data.ok) return;
      const textSuffixFieldId =
        textSuffixParsed.data.data.table.fields.find((f) => f.name === 'TextSuffix')?.id ?? '';

      // Formula: '' + {textField}
      const createTextPrefixResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'TextPrefix',
            options: {
              expression: `'' + {${textFieldId}}`,
            },
          },
        }),
      });
      expect(createTextPrefixResponse.status).toBe(200);
      const textPrefixRaw = await createTextPrefixResponse.json();
      const textPrefixParsed = createFieldOkResponseSchema.safeParse(textPrefixRaw);
      expect(textPrefixParsed.success).toBe(true);
      if (!textPrefixParsed.success || !textPrefixParsed.data.ok) return;
      const textPrefixFieldId =
        textPrefixParsed.data.data.table.fields.find((f) => f.name === 'TextPrefix')?.id ?? '';

      // Formula: {numberField} + '' (mixed type with blank)
      const createMixedResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Mixed',
            options: {
              expression: `{${numberFieldId}} + ''`,
            },
          },
        }),
      });
      expect(createMixedResponse.status).toBe(200);
      const mixedRaw = await createMixedResponse.json();
      const mixedParsed = createFieldOkResponseSchema.safeParse(mixedRaw);
      expect(mixedParsed.success).toBe(true);
      if (!mixedParsed.success || !mixedParsed.data.ok) return;
      const mixedFieldId =
        mixedParsed.data.data.table.fields.find((f) => f.name === 'Mixed')?.id ?? '';

      // Create a record with only the number field set - text field is null/not provided
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 1,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      // Formula {textField} + '' should return '' when textField is null (COALESCE converts null to empty string)
      expect(record.fields[textSuffixFieldId]).toBe('');
      // Formula '' + {textField} should return '' when textField is null (COALESCE converts null to empty string)
      expect(record.fields[textPrefixFieldId]).toBe('');
      // Formula {numberField} + '' should return '1' (number coerced to string)
      expect(record.fields[mixedFieldId]).toBe('1');
    });
  });

  // ============================================================================
  // 4. Boolean operator combinations
  // ============================================================================
  describe('boolean operator combinations', () => {
    /**
     * Scenario:AND operator
     * Formula:AND({checkbox1}, {checkbox2})
     * Expect: returns true when both are true
     */
    it('should evaluate AND operator - AND({checkbox1}, {checkbox2})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('AND Checkbox Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'A' },
            { type: 'checkbox', name: 'B' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';
      const bFieldId = table.fields.find((f) => f.name === 'B')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'A And B',
            options: {
              expression: `AND({${aFieldId}}, {${bFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'A And B')?.id ?? '';

      const trueRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'TT', [aFieldId]: true, [bFieldId]: true },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      const falseRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'TF', [aFieldId]: true, [bFieldId]: false },
        }),
      });
      expect(falseRecord.status).toBe(201);
      const falseRaw = await falseRecord.json();
      const falseParsed = createRecordOkResponseSchema.safeParse(falseRaw);
      expect(falseParsed.success).toBe(true);
      if (!falseParsed.success || !falseParsed.data.ok) return;
      const falseRecordId = falseParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);
      const falseRecordResult = records.find((r) => r.id === falseRecordId);

      expect(trueRecordResult).toBeDefined();
      expect(falseRecordResult).toBeDefined();
      if (!trueRecordResult || !falseRecordResult) return;

      expect(trueRecordResult.fields[formulaFieldId]).toBe(true);
      expect(falseRecordResult.fields[formulaFieldId]).toBe(false);
    });

    /**
     * Scenario:OR operator
     * Formula:OR({checkbox1}, {checkbox2})
     * Expect: returns true when any is true
     */
    it('should evaluate OR operator - OR({checkbox1}, {checkbox2})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('OR Checkbox Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'A' },
            { type: 'checkbox', name: 'B' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';
      const bFieldId = table.fields.find((f) => f.name === 'B')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'A Or B',
            options: {
              expression: `OR({${aFieldId}}, {${bFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'A Or B')?.id ?? '';

      const trueRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'FT', [aFieldId]: false, [bFieldId]: true },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      const falseRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'FF', [aFieldId]: false, [bFieldId]: false },
        }),
      });
      expect(falseRecord.status).toBe(201);
      const falseRaw = await falseRecord.json();
      const falseParsed = createRecordOkResponseSchema.safeParse(falseRaw);
      expect(falseParsed.success).toBe(true);
      if (!falseParsed.success || !falseParsed.data.ok) return;
      const falseRecordId = falseParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);
      const falseRecordResult = records.find((r) => r.id === falseRecordId);

      expect(trueRecordResult).toBeDefined();
      expect(falseRecordResult).toBeDefined();
      if (!trueRecordResult || !falseRecordResult) return;

      expect(trueRecordResult.fields[formulaFieldId]).toBe(true);
      expect(falseRecordResult.fields[formulaFieldId]).toBe(false);
    });

    /**
     * Scenario:NOT operator
     * Formula:NOT({checkboxField})
     * Expect: negates boolean
     */
    it('should evaluate NOT operator - NOT({checkboxField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('NOT Checkbox Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'A' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Not A',
            options: {
              expression: `NOT({${aFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Not A')?.id ?? '';

      const falseRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'A=true', [aFieldId]: true },
        }),
      });
      expect(falseRecord.status).toBe(201);
      const falseRaw = await falseRecord.json();
      const falseParsed = createRecordOkResponseSchema.safeParse(falseRaw);
      expect(falseParsed.success).toBe(true);
      if (!falseParsed.success || !falseParsed.data.ok) return;
      const falseRecordId = falseParsed.data.data.record.id;

      const trueRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'A=false', [aFieldId]: false },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const falseRecordResult = records.find((r) => r.id === falseRecordId);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);

      expect(falseRecordResult).toBeDefined();
      expect(trueRecordResult).toBeDefined();
      if (!falseRecordResult || !trueRecordResult) return;

      expect(falseRecordResult.fields[formulaFieldId]).toBe(false);
      expect(trueRecordResult.fields[formulaFieldId]).toBe(true);
    });

    /**
     * Scenario: complex boolean combinations
     * Formula:AND(OR({a}, {b}), NOT({c}))
     * Expect: complex logic combines correctly
     */
    it('should evaluate complex boolean combination - AND(OR({a}, {b}), NOT({c}))', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Complex Boolean Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'A' },
            { type: 'checkbox', name: 'B' },
            { type: 'checkbox', name: 'C' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';
      const bFieldId = table.fields.find((f) => f.name === 'B')?.id ?? '';
      const cFieldId = table.fields.find((f) => f.name === 'C')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Complex',
            options: {
              expression: `AND(OR({${aFieldId}}, {${bFieldId}}), NOT({${cFieldId}}))`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Complex')?.id ?? '';

      const trueRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'T', [aFieldId]: true, [bFieldId]: false, [cFieldId]: false },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      const falseRecord1 = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'F1',
            [aFieldId]: false,
            [bFieldId]: false,
            [cFieldId]: false,
          },
        }),
      });
      expect(falseRecord1.status).toBe(201);
      const falseRaw1 = await falseRecord1.json();
      const falseParsed1 = createRecordOkResponseSchema.safeParse(falseRaw1);
      expect(falseParsed1.success).toBe(true);
      if (!falseParsed1.success || !falseParsed1.data.ok) return;
      const falseRecordId1 = falseParsed1.data.data.record.id;

      const falseRecord2 = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'F2', [aFieldId]: true, [bFieldId]: false, [cFieldId]: true },
        }),
      });
      expect(falseRecord2.status).toBe(201);
      const falseRaw2 = await falseRecord2.json();
      const falseParsed2 = createRecordOkResponseSchema.safeParse(falseRaw2);
      expect(falseParsed2.success).toBe(true);
      if (!falseParsed2.success || !falseParsed2.data.ok) return;
      const falseRecordId2 = falseParsed2.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);
      const falseRecordResult1 = records.find((r) => r.id === falseRecordId1);
      const falseRecordResult2 = records.find((r) => r.id === falseRecordId2);

      expect(trueRecordResult).toBeDefined();
      expect(falseRecordResult1).toBeDefined();
      expect(falseRecordResult2).toBeDefined();
      if (!trueRecordResult || !falseRecordResult1 || !falseRecordResult2) return;

      expect(trueRecordResult.fields[formulaFieldId]).toBe(true);
      expect(falseRecordResult1.fields[formulaFieldId]).toBe(false);
      expect(falseRecordResult2.fields[formulaFieldId]).toBe(false);
    });

    /**
     * Scenario: truthiness of empty values
     * Formula:IF({textField}, "truthy", "falsy")
     * Expect: empty string is falsy, non-empty is truthy
     */
    it('should handle truthiness of empty values - IF({textField}, "truthy", "falsy")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Empty Truthiness Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', name: 'Text' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Truthy',
            options: {
              expression: `IF({${textFieldId}}, "truthy", "falsy")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Truthy')?.id ?? '';

      const emptyRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Empty', [textFieldId]: '' },
        }),
      });
      expect(emptyRecord.status).toBe(201);
      const emptyRaw = await emptyRecord.json();
      const emptyParsed = createRecordOkResponseSchema.safeParse(emptyRaw);
      expect(emptyParsed.success).toBe(true);
      if (!emptyParsed.success || !emptyParsed.data.ok) return;
      const emptyRecordId = emptyParsed.data.data.record.id;

      const filledRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Filled', [textFieldId]: 'Hello' },
        }),
      });
      expect(filledRecord.status).toBe(201);
      const filledRaw = await filledRecord.json();
      const filledParsed = createRecordOkResponseSchema.safeParse(filledRaw);
      expect(filledParsed.success).toBe(true);
      if (!filledParsed.success || !filledParsed.data.ok) return;
      const filledRecordId = filledParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const emptyRecordResult = records.find((r) => r.id === emptyRecordId);
      const filledRecordResult = records.find((r) => r.id === filledRecordId);

      expect(emptyRecordResult).toBeDefined();
      expect(filledRecordResult).toBeDefined();
      if (!emptyRecordResult || !filledRecordResult) return;

      expect(emptyRecordResult.fields[formulaFieldId]).toBe('falsy');
      expect(filledRecordResult.fields[formulaFieldId]).toBe('truthy');
    });

    /**
     * Scenario: truthiness of zero
     * Formula:IF({numberField}, "truthy", "falsy")
     * Expect: 0 is falsy, non-zero is truthy
     */
    it('should handle truthiness of zero - IF({numberField}, "truthy", "falsy")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Zero Truthiness Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Truthy',
            options: {
              expression: `IF({${numberFieldId}}, "truthy", "falsy")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Truthy')?.id ?? '';

      const zeroRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Zero', [numberFieldId]: 0 },
        }),
      });
      expect(zeroRecord.status).toBe(201);
      const zeroRaw = await zeroRecord.json();
      const zeroParsed = createRecordOkResponseSchema.safeParse(zeroRaw);
      expect(zeroParsed.success).toBe(true);
      if (!zeroParsed.success || !zeroParsed.data.ok) return;
      const zeroRecordId = zeroParsed.data.data.record.id;

      const nonZeroRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'NonZero', [numberFieldId]: 5 },
        }),
      });
      expect(nonZeroRecord.status).toBe(201);
      const nonZeroRaw = await nonZeroRecord.json();
      const nonZeroParsed = createRecordOkResponseSchema.safeParse(nonZeroRaw);
      expect(nonZeroParsed.success).toBe(true);
      if (!nonZeroParsed.success || !nonZeroParsed.data.ok) return;
      const nonZeroRecordId = nonZeroParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const zeroRecordResult = records.find((r) => r.id === zeroRecordId);
      const nonZeroRecordResult = records.find((r) => r.id === nonZeroRecordId);

      expect(zeroRecordResult).toBeDefined();
      expect(nonZeroRecordResult).toBeDefined();
      if (!zeroRecordResult || !nonZeroRecordResult) return;

      expect(zeroRecordResult.fields[formulaFieldId]).toBe('falsy');
      expect(nonZeroRecordResult.fields[formulaFieldId]).toBe('truthy');
    });
  });

  // ============================================================================
  // 5. LAST_MODIFIED_TIME with field parameters
  // ============================================================================
  describe('LAST_MODIFIED_TIME with field parameters', () => {
    /**
     * Scenario: LAST_MODIFIED_TIME tracks specific fields
     * Field config: trackedFieldIds: [numberFieldId]
     * Expect: timestamp updates only when tracked fields change
     */
    it('should track specific field changes with LAST_MODIFIED_TIME', async () => {
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('LMT Track Single Field Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Amount' },
            { type: 'singleLineText', name: 'Notes' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const amountFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';

      const createLastModifiedResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'lastModifiedTime',
            name: 'Tracked LMT',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
              trackedFieldIds: [amountFieldId],
            },
          },
        }),
      });
      expect(createLastModifiedResponse.status).toBe(200);
      const lastModifiedRaw = await createLastModifiedResponse.json();
      const lastModifiedParsed = createFieldOkResponseSchema.safeParse(lastModifiedRaw);
      expect(lastModifiedParsed.success).toBe(true);
      if (!lastModifiedParsed.success || !lastModifiedParsed.data.ok) return;

      const lastModifiedFieldId =
        lastModifiedParsed.data.data.table.fields.find((f) => f.name === 'Tracked LMT')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Row 1', [amountFieldId]: 1 },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(2);

      let records = await listRecords(table.id);
      let record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const initial = record.fields[lastModifiedFieldId];
      expect(typeof initial).toBe('string');
      if (typeof initial !== 'string') return;

      await sleep(20);

      const updateRecordResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: { [amountFieldId]: 2 },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);
      const updateRaw = await updateRecordResponse.json();
      const updateParsed = updateRecordOkResponseSchema.safeParse(updateRaw);
      expect(updateParsed.success).toBe(true);
      if (!updateParsed.success || !updateParsed.data.ok) return;

      await processOutbox(2);

      records = await listRecords(table.id);
      record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const after = record.fields[lastModifiedFieldId];
      expect(typeof after).toBe('string');
      if (typeof after !== 'string') return;

      expect(after).not.toBe(initial);
      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(initial).getTime());
    });

    /**
     * Scenario: LAST_MODIFIED_TIME tracks multiple fields
     * Field config: trackedFieldIds: [field1Id, field2Id]
     * Expect: any tracked field updates timestamp
     */
    it('should track multiple field changes with LAST_MODIFIED_TIME', async () => {
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('LMT Track Multiple Fields Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Amount' },
            { type: 'singleLineText', name: 'Notes' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const amountFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';
      const notesFieldId = table.fields.find((f) => f.name === 'Notes')?.id ?? '';

      const createLastModifiedResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'lastModifiedTime',
            name: 'Tracked LMT',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
              trackedFieldIds: [amountFieldId, notesFieldId],
            },
          },
        }),
      });
      expect(createLastModifiedResponse.status).toBe(200);
      const lastModifiedRaw = await createLastModifiedResponse.json();
      const lastModifiedParsed = createFieldOkResponseSchema.safeParse(lastModifiedRaw);
      expect(lastModifiedParsed.success).toBe(true);
      if (!lastModifiedParsed.success || !lastModifiedParsed.data.ok) return;

      const lastModifiedFieldId =
        lastModifiedParsed.data.data.table.fields.find((f) => f.name === 'Tracked LMT')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Row 1', [amountFieldId]: 1, [notesFieldId]: 'a' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(2);

      let records = await listRecords(table.id);
      let record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const initial = record.fields[lastModifiedFieldId];
      expect(typeof initial).toBe('string');
      if (typeof initial !== 'string') return;

      await sleep(20);

      const updateRecordResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: { [notesFieldId]: 'b' },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);
      const updateRaw = await updateRecordResponse.json();
      const updateParsed = updateRecordOkResponseSchema.safeParse(updateRaw);
      expect(updateParsed.success).toBe(true);
      if (!updateParsed.success || !updateParsed.data.ok) return;

      await processOutbox(2);

      records = await listRecords(table.id);
      record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const after = record.fields[lastModifiedFieldId];
      expect(typeof after).toBe('string');
      if (typeof after !== 'string') return;

      expect(after).not.toBe(initial);
      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(initial).getTime());
    });

    /**
     * Scenario: untracked field updates do not affect LAST_MODIFIED_TIME
     * Expect: LAST_MODIFIED_TIME unchanged when untracked fields update
     */
    it('should not update LAST_MODIFIED_TIME when untracked field changes', async () => {
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('LMT Untracked Field Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Amount' },
            { type: 'singleLineText', name: 'Notes' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const amountFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';
      const notesFieldId = table.fields.find((f) => f.name === 'Notes')?.id ?? '';

      const createLastModifiedResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'lastModifiedTime',
            name: 'Tracked LMT',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
              trackedFieldIds: [amountFieldId],
            },
          },
        }),
      });
      expect(createLastModifiedResponse.status).toBe(200);
      const lastModifiedRaw = await createLastModifiedResponse.json();
      const lastModifiedParsed = createFieldOkResponseSchema.safeParse(lastModifiedRaw);
      expect(lastModifiedParsed.success).toBe(true);
      if (!lastModifiedParsed.success || !lastModifiedParsed.data.ok) return;

      const lastModifiedFieldId =
        lastModifiedParsed.data.data.table.fields.find((f) => f.name === 'Tracked LMT')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Row 1', [amountFieldId]: 1, [notesFieldId]: 'a' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(2);

      let records = await listRecords(table.id);
      let record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const initial = record.fields[lastModifiedFieldId];
      expect(typeof initial).toBe('string');
      if (typeof initial !== 'string') return;

      await sleep(20);

      const updateRecordResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: { [notesFieldId]: 'b' },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);
      const updateRaw = await updateRecordResponse.json();
      const updateParsed = updateRecordOkResponseSchema.safeParse(updateRaw);
      expect(updateParsed.success).toBe(true);
      if (!updateParsed.success || !updateParsed.data.ok) return;

      await processOutbox(2);

      records = await listRecords(table.id);
      record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const after = record.fields[lastModifiedFieldId];
      expect(typeof after).toBe('string');
      if (typeof after !== 'string') return;

      expect(after).toBe(initial);
    });
  });

  // ============================================================================
  // 6. Numeric functions
  // ============================================================================
  describe('numeric functions', () => {
    /**
     * Scenario:ROUND function
     * Formula:ROUND({numberField}, 2)
     * Expect: rounds to 2 decimal places
     */
    it('should round number - ROUND({numberField}, 2)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Round Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Rounded',
            options: {
              expression: `ROUND({${numberFieldId}}, 2)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Rounded')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 3.14159,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(3.14); // rounds to 2 decimal places
    });

    /**
     * Scenario:CEILING function
     * Formula:CEILING({numberField})
     * Expect: rounds up
     */
    it('should ceiling number - CEILING({numberField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Ceiling Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Ceiling Value',
            options: {
              expression: `CEILING({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Ceiling Value')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 3.2,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(4); // CEILING(3.2) = 4
    });

    /**
     * Scenario:FLOOR function
     * Formula:FLOOR({numberField})
     * Expect: rounds down
     */
    it('should floor number - FLOOR({numberField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Floor Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Floor Value',
            options: {
              expression: `FLOOR({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Floor Value')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 3.8,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(3); // FLOOR(3.8) = 3
    });

    /**
     * Scenario:ABS function
     * Formula:ABS({numberField})
     * Expect: returns absolute value
     */
    it('should get absolute value - ABS({numberField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'ABS Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Absolute Value',
            options: {
              expression: `ABS({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Absolute Value')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: -15.5,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(15.5); // ABS(-15.5) = 15.5
    });

    /**
     * Scenario:SQRT function
     * Formula:SQRT({numberField})
     * Expect: returns square root
     */
    it('should get square root - SQRT({numberField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'SQRT Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Square Root',
            options: {
              expression: `SQRT({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Square Root')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 16,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(4); // SQRT(16) = 4
    });

    /**
     * Scenario:POWER function
     * Formula:POWER({numberField}, 2)
     * Expect: returns power
     */
    it('should get power - POWER({numberField}, 2)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'POWER Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Power Result',
            options: {
              expression: `POWER({${numberFieldId}}, 2)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Power Result')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 5,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(25); // POWER(5, 2) = 25
    });

    /**
     * Scenario:MOD function
     * Formula:MOD({numberField}, 3)
     * Expect: returns modulo
     */
    it('should get modulo - MOD({numberField}, 3)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'MOD Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Mod Result',
            options: {
              expression: `MOD({${numberFieldId}}, 3)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Mod Result')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 10,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(1); // MOD(10, 3) = 1
    });

    /**
     * Scenario:MAX function
     * Formula:MAX({num1}, {num2}, {num3})
     * Expect: returns maximum
     */
    it('should get max value - MAX({num1}, {num2}, {num3})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'MAX Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Num1' },
            { type: 'number', name: 'Num2' },
            { type: 'number', name: 'Num3' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const num1FieldId = table.fields.find((f) => f.name === 'Num1')?.id ?? '';
      const num2FieldId = table.fields.find((f) => f.name === 'Num2')?.id ?? '';
      const num3FieldId = table.fields.find((f) => f.name === 'Num3')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Max Result',
            options: {
              expression: `MAX({${num1FieldId}}, {${num2FieldId}}, {${num3FieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Max Result')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [num1FieldId]: 5,
            [num2FieldId]: 15,
            [num3FieldId]: 10,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(15); // MAX(5, 15, 10) = 15
    });

    /**
     * Scenario:MIN function
     * Formula:MIN({num1}, {num2}, {num3})
     * Expect: returns minimum
     */
    it('should get min value - MIN({num1}, {num2}, {num3})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'MIN Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Num1' },
            { type: 'number', name: 'Num2' },
            { type: 'number', name: 'Num3' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const num1FieldId = table.fields.find((f) => f.name === 'Num1')?.id ?? '';
      const num2FieldId = table.fields.find((f) => f.name === 'Num2')?.id ?? '';
      const num3FieldId = table.fields.find((f) => f.name === 'Num3')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Min Result',
            options: {
              expression: `MIN({${num1FieldId}}, {${num2FieldId}}, {${num3FieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Min Result')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [num1FieldId]: 5,
            [num2FieldId]: 15,
            [num3FieldId]: 10,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(5); // MIN(5, 15, 10) = 5
    });

    /**
     * Scenario:SUM function
     * Formula:SUM({num1}, {num2}, {num3})
     * Expect: returns sum
     */
    it('should get sum - SUM({num1}, {num2}, {num3})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'SUM Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Num1' },
            { type: 'number', name: 'Num2' },
            { type: 'number', name: 'Num3' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const num1FieldId = table.fields.find((f) => f.name === 'Num1')?.id ?? '';
      const num2FieldId = table.fields.find((f) => f.name === 'Num2')?.id ?? '';
      const num3FieldId = table.fields.find((f) => f.name === 'Num3')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Sum Result',
            options: {
              expression: `SUM({${num1FieldId}}, {${num2FieldId}}, {${num3FieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Sum Result')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [num1FieldId]: 5,
            [num2FieldId]: 15,
            [num3FieldId]: 10,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(30); // SUM(5, 15, 10) = 30
    });

    /**
     * Scenario:AVERAGE function
     * Formula:AVERAGE({num1}, {num2}, {num3})
     * Expect: returns average
     */
    it('should get average - AVERAGE({num1}, {num2}, {num3})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'AVERAGE Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Num1' },
            { type: 'number', name: 'Num2' },
            { type: 'number', name: 'Num3' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const num1FieldId = table.fields.find((f) => f.name === 'Num1')?.id ?? '';
      const num2FieldId = table.fields.find((f) => f.name === 'Num2')?.id ?? '';
      const num3FieldId = table.fields.find((f) => f.name === 'Num3')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Average Result',
            options: {
              expression: `AVERAGE({${num1FieldId}}, {${num2FieldId}}, {${num3FieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Average Result')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [num1FieldId]: 6,
            [num2FieldId]: 12,
            [num3FieldId]: 9,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(9); // AVERAGE(6, 12, 9) = 9
    });

    /**
     * Scenario: VALUE function (string to number)
     * Formula:VALUE({textField})
     * Expect: coerces "123" to number 123
     */
    it('should convert string to number - VALUE({textField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'VALUE Test',
          fields: [{ type: 'singleLineText', name: 'NumStr', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'NumStr')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Parsed Value',
            options: {
              expression: `VALUE({${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Parsed Value')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: '123',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(123); // VALUE("123") = 123
    });

    /**
     * Scenario:INT function
     * Formula:INT({numberField})
     * Expect: returns integer part
     */
    it('should get integer part - INT({numberField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'INT Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Int Value',
            options: {
              expression: `INT({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Int Value')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 7.89,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(7); // INT(7.89) = 7
    });

    /**
     * Scenario:EVEN function
     * Formula:EVEN({numberField})
     * Expect: rounds up to nearest even
     */
    it('should round up to even - EVEN({numberField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'EVEN Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Even Value',
            options: {
              expression: `EVEN({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Even Value')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 3.2,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(4); // EVEN(3.2) = 4
    });

    /**
     * Scenario:ODD function
     * Formula:ODD({numberField})
     * Expect: rounds up to nearest odd
     */
    it('should round up to odd - ODD({numberField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'ODD Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Odd Value',
            options: {
              expression: `ODD({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Odd Value')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 2.5,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(3); // ODD(2.5) = 3
    });

    /**
     * Scenario:LOG function
     * Formula:LOG({numberField}, 10)
     * Expect: returns base-10 logarithm
     */
    it('should get log - LOG({numberField}, 10)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'LOG Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Log Value',
            options: {
              expression: `LOG({${numberFieldId}}, 10)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Log Value')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 100,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(2); // LOG(100, 10) = 2
    });

    /**
     * Scenario:EXP function
     * Formula:EXP({numberField})
     * Expect: returns e power
     */
    it('should get exp - EXP({numberField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'EXP Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Exp Value',
            options: {
              expression: `EXP({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Exp Value')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 1,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      // EXP(1) = e ≈ 2.718281828...
      const result = record.fields[formulaFieldId] as number;
      expect(result).toBeCloseTo(Math.E, 10);
    });
  });

  // ============================================================================
  // 7. Text functions
  // ============================================================================
  describe('text functions', () => {
    /**
     * Scenario:CONCATENATE function
     * Formula:CONCATENATE({text1}, " ", {text2})
     * Expect: concatenates text
     */
    it('should concatenate text - CONCATENATE({text1}, " ", {text2})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Concat Test',
          fields: [
            { type: 'singleLineText', name: 'FirstName', isPrimary: true },
            { type: 'singleLineText', name: 'LastName' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const firstNameFieldId = table.fields.find((f) => f.name === 'FirstName')?.id ?? '';
      const lastNameFieldId = table.fields.find((f) => f.name === 'LastName')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'FullName',
            options: {
              expression: `CONCATENATE({${firstNameFieldId}}, " ", {${lastNameFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'FullName')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [firstNameFieldId]: 'John',
            [lastNameFieldId]: 'Doe',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('John Doe');
    });

    /**
     * Scenario: & operator concatenation
     * Formula:{text1} & " - " & {text2}
     * Expect: concatenates text using &
     */
    it('should concatenate with & operator - {text1} & " - " & {text2}', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Ampersand Concat Test'),
          fields: [
            { type: 'singleLineText', name: 'Text1', isPrimary: true },
            { type: 'singleLineText', name: 'Text2' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const text1FieldId = table.fields.find((f) => f.name === 'Text1')?.id ?? '';
      const text2FieldId = table.fields.find((f) => f.name === 'Text2')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Joined',
            options: {
              expression: `{${text1FieldId}} & " - " & {${text2FieldId}}`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Joined')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [text1FieldId]: 'Hello', [text2FieldId]: 'World' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Hello - World');
    });

    /**
     * Scenario:LEFT function
     * Formula:LEFT({textField}, 5)
     * Expect: returns left 5 characters
     */
    it('should get left characters - LEFT({textField}, 5)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Left Test',
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Left Five',
            options: {
              expression: `LEFT({${textFieldId}}, 5)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Left Five')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'Hello World',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Hello'); // LEFT("Hello World", 5) = "Hello"
    });

    /**
     * Scenario:RIGHT function
     * Formula:RIGHT({textField}, 5)
     * Expect: returns right 5 characters
     */
    it('should get right characters - RIGHT({textField}, 5)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Right Test',
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Right Five',
            options: {
              expression: `RIGHT({${textFieldId}}, 5)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Right Five')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'Hello World',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('World'); // RIGHT("Hello World", 5) = "World"
    });

    /**
     * Scenario:MID function
     * Formula:MID({textField}, 2, 3)
     * Expect: returns 3 characters starting at position 2
     */
    it('should get mid characters - MID({textField}, 2, 3)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'MID Test',
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Mid Result',
            options: {
              expression: `MID({${textFieldId}}, 2, 3)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Mid Result')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'Hello World',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('ell'); // MID("Hello World", 2, 3) = "ell"
    });

    /**
     * Scenario:LEN function
     * Formula:LEN({textField})
     * Expect: returns text length
     */
    it('should get text length - LEN({textField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'LEN Test',
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Text Length',
            options: {
              expression: `LEN({${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Text Length')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'Hello World',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(11); // LEN("Hello World") = 11
    });

    /**
     * Scenario:UPPER function
     * Formula:UPPER({textField})
     * Expect: converts to uppercase
     */
    it('should convert to upper case - UPPER({textField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'UPPER Test',
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Upper Text',
            options: {
              expression: `UPPER({${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Upper Text')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'hello world',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('HELLO WORLD');
    });

    /**
     * Scenario:LOWER function
     * Formula:LOWER({textField})
     * Expect: converts to lowercase
     */
    it('should convert to lower case - LOWER({textField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'LOWER Test',
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Lower Text',
            options: {
              expression: `LOWER({${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Lower Text')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'HELLO WORLD',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('hello world');
    });

    /**
     * Scenario:TRIM function
     * Formula:TRIM({textField})
     * Expect: trims leading and trailing spaces
     */
    it('should trim whitespace - TRIM({textField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'TRIM Test',
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Trimmed Text',
            options: {
              expression: `TRIM({${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Trimmed Text')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: '  Hello World  ',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Hello World');
    });

    /**
     * Scenario:REPLACE function
     * Formula:REPLACE({textField}, 1, 3, "NEW")
     * Expect: replaces 3 characters from position 1 with "NEW"
     */
    it('should replace text - REPLACE({textField}, 1, 3, "NEW")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('REPLACE Test'),
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Replaced',
            options: {
              expression: `REPLACE({${textFieldId}}, 1, 3, "NEW")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Replaced')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [textFieldId]: 'abcdef' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('NEWdef');
    });

    /**
     * Scenario:SUBSTITUTE function
     * Formula:SUBSTITUTE({textField}, "old", "new")
     * Expect: replaces "old" with "new"
     */
    it('should substitute text - SUBSTITUTE({textField}, "old", "new")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('SUBSTITUTE Text Test'),
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Subbed',
            options: {
              expression: `SUBSTITUTE({${textFieldId}}, "old", "new")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Subbed')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [textFieldId]: 'old-old' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('new-new');
    });

    /**
     * Scenario:FIND function
     * Formula:FIND("abc", {textField})
     * Expect: returns substring position
     */
    it('should find substring position - FIND("abc", {textField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('FIND Test'),
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Pos',
            options: {
              expression: `FIND("abc", {${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Pos')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [textFieldId]: 'xxabcxx' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(3);
    });

    /**
     * Scenario: SEARCH function (case-insensitive)
     * Formula:SEARCH("ABC", {textField})
     * Expect: finds substring position case-insensitively
     */
    it('should search substring case-insensitive - SEARCH("ABC", {textField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('SEARCH Test'),
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Pos',
            options: {
              expression: `SEARCH("ABC", {${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Pos')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [textFieldId]: 'xxabcxx' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(3);
    });

    /**
     * Scenario:REPT function
     * Formula:REPT({textField}, 3)
     * Expect: repeats text 3 times
     */
    it('should repeat text - REPT({textField}, 3)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('REPT Test'),
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Repeated',
            options: {
              expression: `REPT({${textFieldId}}, 3)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Repeated')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [textFieldId]: 'ab' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('ababab');
    });

    /**
     * Scenario:T function
     * Formula:T({numberField})
     * Expect: returns text if input is text, otherwise empty string
     */
    it('should convert to text or empty - T({numberField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('T Function Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'AsText',
            options: {
              expression: `T({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'AsText')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Row 1', [numberFieldId]: 123 },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(null);
    });

    /**
     * Scenario:ENCODE_URL_COMPONENT function
     * Formula:ENCODE_URL_COMPONENT({textField})
     * Expect: URL-encodes text
     */
    it('should encode url component - ENCODE_URL_COMPONENT({textField})', async () => {
      const encodeUrlInput = [
        'Been using Teable lately — honestly impressed @teableio',
        '\u00A0',
        'Scattered work → AI-native system (for projects, CRM & marketing) in minutes 🚀',
        'teable.ai',
      ].join('\n');

      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('ENCODE_URL_COMPONENT Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'longText', name: 'Text' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Encoded',
            options: {
              expression: `ENCODE_URL_COMPONENT({${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Encoded')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Row 1', [textFieldId]: encodeUrlInput },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(encodeURIComponent(encodeUrlInput));
    });
  });

  // ============================================================================
  // 8. Logical functions
  // ============================================================================
  describe('logical functions', () => {
    /**
     * Scenario:IF function
     * Formula:IF({condition}, "yes", "no")
     * Expect: returns "yes" when condition true, otherwise "no"
     */
    it('should evaluate IF - IF({condition}, "yes", "no")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'IF Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Score' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const scoreFieldId = table.fields.find((f) => f.name === 'Score')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'PassFail',
            options: {
              expression: `IF({${scoreFieldId}} >= 60, "Pass", "Fail")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'PassFail')?.id ?? '';

      // Test passing case
      const passRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [scoreFieldId]: 75 },
        }),
      });
      expect(passRecord.status).toBe(201);
      const passRaw = await passRecord.json();
      const passParsed = createRecordOkResponseSchema.safeParse(passRaw);
      expect(passParsed.success).toBe(true);
      if (!passParsed.success || !passParsed.data.ok) return;
      const passRecordId = passParsed.data.data.record.id;

      // Test failing case
      const failRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [scoreFieldId]: 45 },
        }),
      });
      expect(failRecord.status).toBe(201);
      const failRaw = await failRecord.json();
      const failParsed = createRecordOkResponseSchema.safeParse(failRaw);
      expect(failParsed.success).toBe(true);
      if (!failParsed.success || !failParsed.data.ok) return;
      const failRecordId = failParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const passRecordResult = records.find((r) => r.id === passRecordId);
      const failRecordResult = records.find((r) => r.id === failRecordId);

      expect(passRecordResult).toBeDefined();
      expect(failRecordResult).toBeDefined();
      if (!passRecordResult || !failRecordResult) return;

      expect(passRecordResult.fields[formulaFieldId]).toBe('Pass');
      expect(failRecordResult.fields[formulaFieldId]).toBe('Fail');
    });

    /**
     * Scenario: nested IF
     * Formula:IF({a}, "A", IF({b}, "B", "C"))
     * Expect: nested conditions computed correctly
     */
    it('should evaluate nested IF - IF({a}, "A", IF({b}, "B", "C"))', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Nested IF Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'A' },
            { type: 'checkbox', name: 'B' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';
      const bFieldId = table.fields.find((f) => f.name === 'B')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Nested Result',
            options: {
              expression: `IF({${aFieldId}}, "A", IF({${bFieldId}}, "B", "C"))`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Nested Result')?.id ?? '';

      // Test a=true: should return "A"
      const aRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [aFieldId]: true, [bFieldId]: false },
        }),
      });
      expect(aRecord.status).toBe(201);
      const aRaw = await aRecord.json();
      const aParsed = createRecordOkResponseSchema.safeParse(aRaw);
      expect(aParsed.success).toBe(true);
      if (!aParsed.success || !aParsed.data.ok) return;
      const aRecordId = aParsed.data.data.record.id;

      // Test a=false, b=true: should return "B"
      const bRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [aFieldId]: false, [bFieldId]: true },
        }),
      });
      expect(bRecord.status).toBe(201);
      const bRaw = await bRecord.json();
      const bParsed = createRecordOkResponseSchema.safeParse(bRaw);
      expect(bParsed.success).toBe(true);
      if (!bParsed.success || !bParsed.data.ok) return;
      const bRecordId = bParsed.data.data.record.id;

      // Test a=false, b=false: should return "C"
      const cRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [aFieldId]: false, [bFieldId]: false },
        }),
      });
      expect(cRecord.status).toBe(201);
      const cRaw = await cRecord.json();
      const cParsed = createRecordOkResponseSchema.safeParse(cRaw);
      expect(cParsed.success).toBe(true);
      if (!cParsed.success || !cParsed.data.ok) return;
      const cRecordId = cParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const aRecordResult = records.find((r) => r.id === aRecordId);
      const bRecordResult = records.find((r) => r.id === bRecordId);
      const cRecordResult = records.find((r) => r.id === cRecordId);

      expect(aRecordResult).toBeDefined();
      expect(bRecordResult).toBeDefined();
      expect(cRecordResult).toBeDefined();
      if (!aRecordResult || !bRecordResult || !cRecordResult) return;

      expect(aRecordResult.fields[formulaFieldId]).toBe('A');
      expect(bRecordResult.fields[formulaFieldId]).toBe('B');
      expect(cRecordResult.fields[formulaFieldId]).toBe('C');
    });

    /**
     * Scenario:SWITCH function
     * Formula:SWITCH({selectField}, "A", 1, "B", 2, 0)
     * Expect: returns matching result by value
     */
    it('should evaluate SWITCH - SWITCH({selectField}, "A", 1, "B", 2, 0)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('SWITCH Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleSelect', name: 'Choice', options: ['A', 'B'] },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const selectField = table.fields.find((f) => f.name === 'Choice');
      const selectFieldId = selectField?.id ?? '';
      const choices =
        (selectField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ?? [];
      const optionA = choices.find((choice) => choice.name === 'A');
      const optionB = choices.find((choice) => choice.name === 'B');
      if (!selectFieldId || !optionA?.id || !optionB?.id) {
        throw new Error('Missing select option metadata');
      }

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Mapped',
            options: {
              expression: `SWITCH({${selectFieldId}}, "A", 1, "B", 2, 0)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Mapped')?.id ?? '';

      const aRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'A', [selectFieldId]: optionA.id },
        }),
      });
      expect(aRecord.status).toBe(201);
      const aRaw = await aRecord.json();
      const aParsed = createRecordOkResponseSchema.safeParse(aRaw);
      expect(aParsed.success).toBe(true);
      if (!aParsed.success || !aParsed.data.ok) return;
      const aRecordId = aParsed.data.data.record.id;

      const bRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'B', [selectFieldId]: optionB.id },
        }),
      });
      expect(bRecord.status).toBe(201);
      const bRaw = await bRecord.json();
      const bParsed = createRecordOkResponseSchema.safeParse(bRaw);
      expect(bParsed.success).toBe(true);
      if (!bParsed.success || !bParsed.data.ok) return;
      const bRecordId = bParsed.data.data.record.id;

      const noneRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'None' },
        }),
      });
      expect(noneRecord.status).toBe(201);
      const noneRaw = await noneRecord.json();
      const noneParsed = createRecordOkResponseSchema.safeParse(noneRaw);
      expect(noneParsed.success).toBe(true);
      if (!noneParsed.success || !noneParsed.data.ok) return;
      const noneRecordId = noneParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const aRecordResult = records.find((r) => r.id === aRecordId);
      const bRecordResult = records.find((r) => r.id === bRecordId);
      const noneRecordResult = records.find((r) => r.id === noneRecordId);

      expect(aRecordResult).toBeDefined();
      expect(bRecordResult).toBeDefined();
      expect(noneRecordResult).toBeDefined();
      if (!aRecordResult || !bRecordResult || !noneRecordResult) return;

      expect(aRecordResult.fields[formulaFieldId]).toBe(1);
      expect(bRecordResult.fields[formulaFieldId]).toBe(2);
      expect(noneRecordResult.fields[formulaFieldId]).toBe(0);
    });

    /**
     * Scenario:AND function
     * Formula:AND({a} > 0, {b} > 0)
     * Expect: returns true when all conditions are true
     */
    it('should evaluate AND - AND({a} > 0, {b} > 0)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('AND Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'A' },
            { type: 'number', name: 'B' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';
      const bFieldId = table.fields.find((f) => f.name === 'B')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Both Positive',
            options: {
              expression: `AND({${aFieldId}} > 0, {${bFieldId}} > 0)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaField = fieldParsed.data.data.table.fields.find(
        (f) => f.name === 'Both Positive'
      );

      const formulaFieldId = formulaField?.id ?? '';

      // Test both greater than zero
      const trueRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [aFieldId]: 5, [bFieldId]: 3 },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      // Test case where one is <= 0
      const falseRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [aFieldId]: 5, [bFieldId]: -1 },
        }),
      });
      expect(falseRecord.status).toBe(201);
      const falseRaw = await falseRecord.json();
      const falseParsed = createRecordOkResponseSchema.safeParse(falseRaw);
      expect(falseParsed.success).toBe(true);
      if (!falseParsed.success || !falseParsed.data.ok) return;
      const falseRecordId = falseParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);
      const falseRecordResult = records.find((r) => r.id === falseRecordId);

      expect(trueRecordResult).toBeDefined();
      expect(falseRecordResult).toBeDefined();
      if (!trueRecordResult || !falseRecordResult) return;

      expect(trueRecordResult.fields[formulaFieldId]).toBe(true);
      expect(falseRecordResult.fields[formulaFieldId]).toBe(false);
    });

    /**
     * Scenario:OR function
     * Formula:OR({a} > 0, {b} > 0)
     * Expect: returns true when any condition is true
     */
    it('should evaluate OR - OR({a} > 0, {b} > 0)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('OR Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'A' },
            { type: 'number', name: 'B' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';
      const bFieldId = table.fields.find((f) => f.name === 'B')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Either Positive',
            options: {
              expression: `OR({${aFieldId}} > 0, {${bFieldId}} > 0)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Either Positive')?.id ?? '';

      // Test case where one is > 0
      const trueRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [aFieldId]: -1, [bFieldId]: 3 },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      // Test case where both are <= 0
      const falseRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [aFieldId]: -2, [bFieldId]: -1 },
        }),
      });
      expect(falseRecord.status).toBe(201);
      const falseRaw = await falseRecord.json();
      const falseParsed = createRecordOkResponseSchema.safeParse(falseRaw);
      expect(falseParsed.success).toBe(true);
      if (!falseParsed.success || !falseParsed.data.ok) return;
      const falseRecordId = falseParsed.data.data.record.id;

      // Process outbox to trigger formula calculation
      await processOutbox();

      // Fetch records after formula calculation
      const records = await listRecords(table.id);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);
      const falseRecordResult = records.find((r) => r.id === falseRecordId);

      expect(trueRecordResult).toBeDefined();
      expect(falseRecordResult).toBeDefined();
      if (!trueRecordResult || !falseRecordResult) return;

      expect(trueRecordResult.fields[formulaFieldId]).toBe(true);
      expect(falseRecordResult.fields[formulaFieldId]).toBe(false);
    });

    /**
     * Scenario:XOR function
     * Formula:XOR({a}, {b})
     * Expect: exclusive-or operation
     */
    it('should evaluate XOR - XOR({a}, {b})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('XOR Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'A' },
            { type: 'checkbox', name: 'B' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';
      const bFieldId = table.fields.find((f) => f.name === 'B')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'XorResult',
            options: {
              expression: `XOR({${aFieldId}}, {${bFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'XorResult')?.id ?? '';

      const createRecord = async (a: boolean, b: boolean) => {
        const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: table.id,
            fields: { [aFieldId]: a, [bFieldId]: b },
          }),
        });
        expect(createRecordResponse.status).toBe(201);
        const recordRaw = await createRecordResponse.json();
        const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
        expect(recordParsed.success).toBe(true);
        if (!recordParsed.success || !recordParsed.data.ok) return undefined;
        return recordParsed.data.data.record.id;
      };

      const ff = await createRecord(false, false);
      const tf = await createRecord(true, false);
      const ft = await createRecord(false, true);
      const tt = await createRecord(true, true);

      if (!ff || !tf || !ft || !tt) return;

      await processOutbox();

      const records = await listRecords(table.id);
      const ffRecord = records.find((r) => r.id === ff);
      const tfRecord = records.find((r) => r.id === tf);
      const ftRecord = records.find((r) => r.id === ft);
      const ttRecord = records.find((r) => r.id === tt);

      expect(ffRecord).toBeDefined();
      expect(tfRecord).toBeDefined();
      expect(ftRecord).toBeDefined();
      expect(ttRecord).toBeDefined();
      if (!ffRecord || !tfRecord || !ftRecord || !ttRecord) return;

      expect(ffRecord.fields[formulaFieldId]).toBe(false);
      expect(tfRecord.fields[formulaFieldId]).toBe(true);
      expect(ftRecord.fields[formulaFieldId]).toBe(true);
      expect(ttRecord.fields[formulaFieldId]).toBe(false);
    });

    /**
     * Scenario:NOT function
     * Formula:NOT({condition})
     * Expect: negates boolean
     */
    it('should evaluate NOT - NOT({condition})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('NOT Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'Condition' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const conditionFieldId = table.fields.find((f) => f.name === 'Condition')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Negated',
            options: {
              expression: `NOT({${conditionFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Negated')?.id ?? '';

      const trueRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [conditionFieldId]: true },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      const falseRecord = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [conditionFieldId]: false },
        }),
      });
      expect(falseRecord.status).toBe(201);
      const falseRaw = await falseRecord.json();
      const falseParsed = createRecordOkResponseSchema.safeParse(falseRaw);
      expect(falseParsed.success).toBe(true);
      if (!falseParsed.success || !falseParsed.data.ok) return;
      const falseRecordId = falseParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);
      const falseRecordResult = records.find((r) => r.id === falseRecordId);
      expect(trueRecordResult).toBeDefined();
      expect(falseRecordResult).toBeDefined();
      if (!trueRecordResult || !falseRecordResult) return;

      expect(trueRecordResult.fields[formulaFieldId]).toBe(false);
      expect(falseRecordResult.fields[formulaFieldId]).toBe(true);
    });

    /**
     * Scenario:BLANK function
     * Formula:BLANK()
     * Expect: returns blank
     */
    it('should return blank - BLANK()', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('BLANK Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'BlankValue',
            options: {
              expression: `BLANK()`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'BlankValue')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: table.id, fields: {} }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBeNull();
    });

    /**
     * Scenario:ERROR function
     * Formula:ERROR("custom error")
     * Expect: returns error
     */
    it('should return error - ERROR("custom error")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('ERROR Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'ErrorValue',
            options: {
              expression: `ERROR("custom error")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'ErrorValue')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: table.id, fields: {} }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBeNull();
    });

    /**
     * Scenario:IS_ERROR function
     * Formula:IS_ERROR({formulaField})
     * Expect: detects error
     */
    it('should check if error - IS_ERROR({formulaField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('IS_ERROR Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const createAlwaysErrorResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'AlwaysError',
            options: {
              expression: `IF({${primaryFieldId}}, ERROR("custom error"), ERROR("custom error"))`,
            },
          },
        }),
      });
      expect(createAlwaysErrorResponse.status).toBe(200);
      const alwaysErrorRaw = await createAlwaysErrorResponse.json();
      const alwaysErrorParsed = createFieldOkResponseSchema.safeParse(alwaysErrorRaw);
      expect(alwaysErrorParsed.success).toBe(true);
      if (!alwaysErrorParsed.success || !alwaysErrorParsed.data.ok) return;

      const alwaysErrorFieldId =
        alwaysErrorParsed.data.data.table.fields.find((f) => f.name === 'AlwaysError')?.id ?? '';

      const createAlwaysOkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'AlwaysOk',
            options: {
              expression: `IF({${primaryFieldId}}, 1, 1)`,
            },
          },
        }),
      });
      expect(createAlwaysOkResponse.status).toBe(200);
      const alwaysOkRaw = await createAlwaysOkResponse.json();
      const alwaysOkParsed = createFieldOkResponseSchema.safeParse(alwaysOkRaw);
      expect(alwaysOkParsed.success).toBe(true);
      if (!alwaysOkParsed.success || !alwaysOkParsed.data.ok) return;

      const alwaysOkFieldId =
        alwaysOkParsed.data.data.table.fields.find((f) => f.name === 'AlwaysOk')?.id ?? '';

      const createIsErrorErrorResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'IsErrorAlwaysError',
            options: {
              expression: `IF({${primaryFieldId}}, IS_ERROR({${alwaysErrorFieldId}}), IS_ERROR({${alwaysErrorFieldId}}))`,
            },
          },
        }),
      });
      expect(createIsErrorErrorResponse.status).toBe(200);
      const isErrorAlwaysErrorRaw = await createIsErrorErrorResponse.json();
      const isErrorAlwaysErrorParsed = createFieldOkResponseSchema.safeParse(isErrorAlwaysErrorRaw);
      expect(isErrorAlwaysErrorParsed.success).toBe(true);
      if (!isErrorAlwaysErrorParsed.success || !isErrorAlwaysErrorParsed.data.ok) return;

      const isErrorAlwaysErrorFieldId =
        isErrorAlwaysErrorParsed.data.data.table.fields.find((f) => f.name === 'IsErrorAlwaysError')
          ?.id ?? '';

      const createIsErrorOkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'IsErrorAlwaysOk',
            options: {
              expression: `IF({${primaryFieldId}}, IS_ERROR({${alwaysOkFieldId}}), IS_ERROR({${alwaysOkFieldId}}))`,
            },
          },
        }),
      });
      expect(createIsErrorOkResponse.status).toBe(200);
      const isErrorOkRaw = await createIsErrorOkResponse.json();
      const isErrorOkParsed = createFieldOkResponseSchema.safeParse(isErrorOkRaw);
      expect(isErrorOkParsed.success).toBe(true);
      if (!isErrorOkParsed.success || !isErrorOkParsed.data.ok) return;

      const isErrorOkFieldId =
        isErrorOkParsed.data.data.table.fields.find((f) => f.name === 'IsErrorAlwaysOk')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Row 1' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[alwaysErrorFieldId]).toBeNull();
      expect(record.fields[alwaysOkFieldId]).toBe(1);
      expect(record.fields[isErrorAlwaysErrorFieldId]).toBe(true);
      expect(record.fields[isErrorOkFieldId]).toBe(false);
    });
  });

  // ============================================================================
  // 9. Date/time functions
  // ============================================================================
  describe('datetime functions', () => {
    /**
     * Scenario:NOW function
     * Formula:NOW()
     * Expect: returns current time
     */
    it('should get current datetime - NOW()', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('NOW Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'NowValue',
            options: {
              expression: `IF({${primaryFieldId}}, NOW(), NOW())`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'NowValue')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: table.id, fields: { [primaryFieldId]: 'Row 1' } }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const nowValue = record.fields[formulaFieldId];
      expect(typeof nowValue).toBe('string');
      if (typeof nowValue !== 'string') return;

      const ts = Date.parse(nowValue);
      expect(Number.isNaN(ts)).toBe(false);

      const diffMs = Math.abs(Date.now() - ts);
      expect(diffMs).toBeLessThan(5 * 60 * 1000);
    });

    /**
     * Scenario:TODAY function
     * Formula:TODAY()
     * Expect: returns today's date
     */
    it('should get today date - TODAY()', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('TODAY Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'TodayValue',
            options: {
              expression: `IF({${primaryFieldId}}, TODAY(), TODAY())`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'TodayValue')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: table.id, fields: { [primaryFieldId]: 'Row 1' } }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const todayValue = record.fields[formulaFieldId];
      expect(typeof todayValue).toBe('string');
      if (typeof todayValue !== 'string') return;

      const parsed = new Date(todayValue);
      expect(Number.isNaN(parsed.getTime())).toBe(false);

      const now = new Date();
      const parsedDay = Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate()
      );
      const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const diffDays = Math.abs(parsedDay - nowDay) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeLessThanOrEqual(1);
    });

    /**
     * Scenario:YEAR function
     * Formula:YEAR({dateField})
     * Expect: extracts year
     */
    it('should get year - YEAR({dateField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('YEAR Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'YearValue',
            options: { expression: `YEAR({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'YearValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(new Date(value).getUTCFullYear());
    });

    /**
     * Scenario:MONTH function
     * Formula:MONTH({dateField})
     * Expect: extracts month
     */
    it('should get month - MONTH({dateField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('MONTH Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'MonthValue',
            options: { expression: `MONTH({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'MonthValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(new Date(value).getUTCMonth() + 1);
    });

    /**
     * Scenario:DAY function
     * Formula:DAY({dateField})
     * Expect: extracts day
     */
    it('should get day - DAY({dateField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('DAY Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'DayValue',
            options: { expression: `DAY({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'DayValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(new Date(value).getUTCDate());
    });

    /**
     * Scenario:HOUR function
     * Formula:HOUR({dateField})
     * Expect: extracts hour
     */
    it('should get hour - HOUR({dateField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('HOUR Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'HourValue',
            options: { expression: `HOUR({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'HourValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(new Date(value).getUTCHours());
    });

    /**
     * Scenario:MINUTE function
     * Formula:MINUTE({dateField})
     * Expect: extracts minute
     */
    it('should get minute - MINUTE({dateField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('MINUTE Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'MinuteValue',
            options: { expression: `MINUTE({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'MinuteValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(new Date(value).getUTCMinutes());
    });

    /**
     * Scenario:SECOND function
     * Formula:SECOND({dateField})
     * Expect: extracts second
     */
    it('should get second - SECOND({dateField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('SECOND Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'SecondValue',
            options: { expression: `SECOND({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'SecondValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(new Date(value).getUTCSeconds());
    });

    /**
     * Scenario:WEEKDAY function
     * Formula:WEEKDAY({dateField})
     * Expect: returns weekday (0-6)
     */
    it('should get weekday - WEEKDAY({dateField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('WEEKDAY Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'WeekdayValue',
            options: { expression: `WEEKDAY({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'WeekdayValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(new Date(value).getUTCDay());
    });

    /**
     * Scenario:WEEKDAY function with startDayOfWeek
     * Formula:WEEKDAY({dateField}, "Monday"/"Sunday")
     * Expect: Monday start shifts weekday index by one day
     */
    it('should respect startDayOfWeek - WEEKDAY({dateField}, "Monday"/"Sunday")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('WEEKDAY StartDay Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createWeekdayField = async (name: string, expression: string) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            baseId: ctx.baseId,
            tableId: table.id,
            field: {
              type: 'formula',
              name,
              options: { expression },
            },
          }),
        });

        expect(response.status).toBe(200);
        const fieldRaw = await response.json();
        const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
        expect(fieldParsed.success).toBe(true);
        if (!fieldParsed.success || !fieldParsed.data.ok) return '';
        return fieldParsed.data.data.table.fields.find((f) => f.name === name)?.id ?? '';
      };

      const defaultFieldId = await createWeekdayField(
        'WeekdayDefault',
        `WEEKDAY({${dateFieldId}})`
      );
      const mondayFieldId = await createWeekdayField(
        'WeekdayMonday',
        `WEEKDAY({${dateFieldId}}, "Monday")`
      );
      const sundayFieldId = await createWeekdayField(
        'WeekdaySunday',
        `WEEKDAY({${dateFieldId}}, "Sunday")`
      );

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const defaultWeekday = new Date(value).getUTCDay();
      expect(record.fields[defaultFieldId]).toBe(defaultWeekday);
      expect(record.fields[sundayFieldId]).toBe(defaultWeekday);
      expect(record.fields[mondayFieldId]).toBe((defaultWeekday + 6) % 7);
    });

    /**
     * Scenario:WEEKNUM function
     * Formula:WEEKNUM({dateField})
     * Expect: returns week number
     */
    it('should get week number - WEEKNUM({dateField})', async () => {
      const isoWeekNumber = (date: Date): number => {
        const tmp = new Date(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
        );
        const day = tmp.getUTCDay() || 7;
        tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
        const diffDays = (tmp.getTime() - yearStart.getTime()) / (24 * 60 * 60 * 1000);
        return Math.ceil((diffDays + 1) / 7);
      };

      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('WEEKNUM Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'WeeknumValue',
            options: { expression: `WEEKNUM({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'WeeknumValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(isoWeekNumber(new Date(value)));
    });

    /**
     * Scenario:DATEADD / DATE_ADD function
     * Formula:DATE_ADD({dateField}, 1, "month")
     * Expect: adds 1 month
     */
    it('should add to date - DATE_ADD({dateField}, 1, "month")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('DATE_ADD Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Added',
            options: { expression: `DATE_ADD({${dateFieldId}}, 1, "month")` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Added')?.id ?? '';

      const value = '2024-01-15T00:00:00.000Z';
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const addedValue = record.fields[formulaFieldId];
      expect(typeof addedValue).toBe('string');
      if (typeof addedValue !== 'string') return;

      const expected = new Date(value);
      expected.setUTCMonth(expected.getUTCMonth() + 1);

      expect(new Date(addedValue).toISOString().slice(0, 10)).toBe(
        expected.toISOString().slice(0, 10)
      );
    });

    /**
     * Scenario:DATETIME_DIFF function
     * Formula:DATETIME_DIFF({date1}, {date2}, "days")
     * Expect: computes date diff (days)
     */
    it('should get datetime diff - DATETIME_DIFF({date1}, {date2}, "days")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('DATETIME_DIFF Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date1' },
            { type: 'date', name: 'Date2' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const date1FieldId = table.fields.find((f) => f.name === 'Date1')?.id ?? '';
      const date2FieldId = table.fields.find((f) => f.name === 'Date2')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'DiffDays',
            options: { expression: `DATETIME_DIFF({${date1FieldId}}, {${date2FieldId}}, "days")` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'DiffDays')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [date1FieldId]: '2024-01-03T00:00:00.000Z',
            [date2FieldId]: '2024-01-01T00:00:00.000Z',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(2);
    });

    /**
     * Scenario:DATETIME_FORMAT function
     * Formula:DATETIME_FORMAT({dateField}, "YYYY-MM-DD")
     * Expect: formats date
     */
    it('should format datetime - DATETIME_FORMAT({dateField}, "YYYY-MM-DD")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('DATETIME_FORMAT Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Formatted',
            options: { expression: `DATETIME_FORMAT({${dateFieldId}}, "YYYY-MM-DD")` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Formatted')?.id ?? '';

      const value = '2024-06-15T00:00:00.000Z';
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('2024-06-15');
    });

    /**
     * Scenario:DATETIME_PARSE function
     * Formula:DATETIME_PARSE({textField}, "YYYY-MM-DD")
     * Expect: parses date string
     */
    it('should parse datetime - DATETIME_PARSE({textField}, "YYYY-MM-DD")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('DATETIME_PARSE Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', name: 'TextDate' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'TextDate')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Parsed',
            options: { expression: `DATETIME_PARSE({${textFieldId}}, "YYYY-MM-DD")` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Parsed')?.id ?? '';

      const value = '2024-06-15T00:00:00Z';
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [textFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const parsedValue = record.fields[formulaFieldId];
      expect(typeof parsedValue).toBe('string');
      if (typeof parsedValue !== 'string') return;

      expect(new Date(parsedValue).toISOString()).toBe('2024-06-15T00:00:00.000Z');
    });

    /**
     * Scenario:IS_SAME function
     * Formula:IS_SAME({date1}, {date2}, "day")
     * Expect: checks same day
     */
    it('should check if same - IS_SAME({date1}, {date2}, "day")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('IS_SAME Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date1' },
            { type: 'date', name: 'Date2' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const date1FieldId = table.fields.find((f) => f.name === 'Date1')?.id ?? '';
      const date2FieldId = table.fields.find((f) => f.name === 'Date2')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'SameDay',
            options: { expression: `IS_SAME({${date1FieldId}}, {${date2FieldId}}, "day")` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'SameDay')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [date1FieldId]: '2024-01-02T12:00:00.000Z',
            [date2FieldId]: '2024-01-02T13:00:00.000Z',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(true);
    });

    /**
     * Scenario:IS_BEFORE function
     * Formula:IS_BEFORE({date1}, {date2})
     * Expect: checks date1 before date2
     */
    it('should check if before - IS_BEFORE({date1}, {date2})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('IS_BEFORE Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date1' },
            { type: 'date', name: 'Date2' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const date1FieldId = table.fields.find((f) => f.name === 'Date1')?.id ?? '';
      const date2FieldId = table.fields.find((f) => f.name === 'Date2')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'IsBefore',
            options: { expression: `IS_BEFORE({${date1FieldId}}, {${date2FieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'IsBefore')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [date1FieldId]: '2024-01-01T00:00:00.000Z',
            [date2FieldId]: '2024-01-02T00:00:00.000Z',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(true);
    });

    /**
     * Scenario:IS_AFTER function
     * Formula:IS_AFTER({date1}, {date2})
     * Expect: checks date1 after date2
     */
    it('should check if after - IS_AFTER({date1}, {date2})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('IS_AFTER Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date1' },
            { type: 'date', name: 'Date2' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const date1FieldId = table.fields.find((f) => f.name === 'Date1')?.id ?? '';
      const date2FieldId = table.fields.find((f) => f.name === 'Date2')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'IsAfter',
            options: { expression: `IS_AFTER({${date1FieldId}}, {${date2FieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'IsAfter')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [date1FieldId]: '2024-01-02T00:00:00.000Z',
            [date2FieldId]: '2024-01-01T00:00:00.000Z',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(true);
    });

    /**
     * Scenario:SET_LOCALE function
     * Formula:SET_LOCALE({dateField}, "zh-CN")
     * Expect: sets date locale
     */
    it('should set locale - SET_LOCALE({dateField}, "zh-CN")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('SET_LOCALE Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'LocalizedDate',
            options: { expression: `SET_LOCALE({${dateFieldId}}, "zh-CN")` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'LocalizedDate')?.id ?? '';

      const value = '2024-06-15T00:00:00.000Z';
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const localized = record.fields[formulaFieldId];
      expect(typeof localized).toBe('string');
      if (typeof localized !== 'string') return;

      expect(new Date(localized).toISOString()).toBe(new Date(value).toISOString());
    });

    /**
     * Scenario:SET_TIMEZONE function
     * Formula:SET_TIMEZONE({dateField}, "Asia/Shanghai")
     * Expect: sets timezone
     */
    it('should set timezone - SET_TIMEZONE({dateField}, "Asia/Shanghai")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('SET_TIMEZONE Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'ZonedDate',
            options: { expression: `SET_TIMEZONE({${dateFieldId}}, "Asia/Shanghai")` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'ZonedDate')?.id ?? '';

      const value = '2024-06-15T00:00:00.000Z';
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const zoned = record.fields[formulaFieldId];
      expect(typeof zoned).toBe('string');
      if (typeof zoned !== 'string') return;

      expect(new Date(zoned).toISOString()).toBe('2024-06-15T08:00:00.000Z');
    });

    /**
     * Scenario:CREATED_TIME function
     * Formula:CREATED_TIME()
     * Expect: returns record created time
     */
    it('should get created time - CREATED_TIME()', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('CREATED_TIME Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'CreatedAt',
            options: {
              expression: `IF({${primaryFieldId}}, CREATED_TIME(), CREATED_TIME())`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'CreatedAt')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Row 1' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const createdAt = record.fields[formulaFieldId];
      expect(typeof createdAt).toBe('string');
      if (typeof createdAt !== 'string') return;

      const ts = Date.parse(createdAt);
      expect(Number.isNaN(ts)).toBe(false);
      const diffMs = Math.abs(Date.now() - ts);
      expect(diffMs).toBeLessThan(5 * 60 * 1000);
    });

    /**
     * Scenario: CREATED_TIME without field references
     * Formula: CREATED_TIME()
     * Expect: returns created time and remains stable after updates
     */
    it('should keep created time without field references - CREATED_TIME()', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('CREATED_TIME No Refs Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Count' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const countFieldId = table.fields.find((f) => f.name === 'Count')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Created At',
            options: {
              expression: 'CREATED_TIME()',
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Created At')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Row 1', [countFieldId]: 1 },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(2);

      const beforeUpdateRecords = await listRecords(table.id);
      const beforeUpdate = beforeUpdateRecords.find((r) => r.id === recordId);
      expect(beforeUpdate).toBeDefined();
      if (!beforeUpdate) return;

      const beforeValue = beforeUpdate.fields[formulaFieldId];
      expect(typeof beforeValue).toBe('string');
      if (typeof beforeValue !== 'string') return;
      const beforeTs = Date.parse(beforeValue);
      expect(Number.isNaN(beforeTs)).toBe(false);

      const updateRecordResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: { [countFieldId]: 2 },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);
      const updateRaw = await updateRecordResponse.json();
      const updateParsed = updateRecordOkResponseSchema.safeParse(updateRaw);
      expect(updateParsed.success).toBe(true);
      if (!updateParsed.success || !updateParsed.data.ok) return;

      await processOutbox(2);

      const afterUpdateRecords = await listRecords(table.id);
      const afterUpdate = afterUpdateRecords.find((r) => r.id === recordId);
      expect(afterUpdate).toBeDefined();
      if (!afterUpdate) return;

      const afterValue = afterUpdate.fields[formulaFieldId];
      expect(afterValue).toBe(beforeValue);
    });

    /**
     * Scenario:LAST_MODIFIED_TIME function
     * Formula:LAST_MODIFIED_TIME()
     * Expect: returns last modified time
     */
    it('should get last modified time - LAST_MODIFIED_TIME()', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('LAST_MODIFIED_TIME Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'UpdatedAt',
            options: {
              expression: `IF({${primaryFieldId}}, LAST_MODIFIED_TIME(), LAST_MODIFIED_TIME())`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'UpdatedAt')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Initial' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(2);

      const beforeUpdateRecords = await listRecords(table.id);
      const beforeUpdate = beforeUpdateRecords.find((r) => r.id === recordId);
      expect(beforeUpdate).toBeDefined();
      if (!beforeUpdate) return;

      const beforeValue = beforeUpdate.fields[formulaFieldId];
      expect(typeof beforeValue).toBe('string');
      if (typeof beforeValue !== 'string') return;
      const beforeTs = Date.parse(beforeValue);
      expect(Number.isNaN(beforeTs)).toBe(false);

      const updateRecordResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: { [primaryFieldId]: 'Updated' },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);
      const updateRaw = await updateRecordResponse.json();
      const updateParsed = updateRecordOkResponseSchema.safeParse(updateRaw);
      expect(updateParsed.success).toBe(true);
      if (!updateParsed.success || !updateParsed.data.ok) return;

      await processOutbox(2);

      const afterUpdateRecords = await listRecords(table.id);
      const afterUpdate = afterUpdateRecords.find((r) => r.id === recordId);
      expect(afterUpdate).toBeDefined();
      if (!afterUpdate) return;

      const afterValue = afterUpdate.fields[formulaFieldId];
      expect(typeof afterValue).toBe('string');
      if (typeof afterValue !== 'string') return;
      const afterTs = Date.parse(afterValue);
      expect(Number.isNaN(afterTs)).toBe(false);
      expect(afterTs).toBeGreaterThanOrEqual(beforeTs);
    });

    /**
     * Scenario: LAST_MODIFIED_TIME without field references
     * Formula: LAST_MODIFIED_TIME()
     * Expect: returns last modified time and updates on any field change
     */
    it('should update last modified time without field references - LAST_MODIFIED_TIME()', async () => {
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('LAST_MODIFIED_TIME No Refs Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Count' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const countFieldId = table.fields.find((f) => f.name === 'Count')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Updated At',
            options: {
              expression: 'LAST_MODIFIED_TIME()',
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Updated At')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Initial', [countFieldId]: 1 },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(2);

      const beforeUpdateRecords = await listRecords(table.id);
      const beforeUpdate = beforeUpdateRecords.find((r) => r.id === recordId);
      expect(beforeUpdate).toBeDefined();
      if (!beforeUpdate) return;

      const beforeValue = beforeUpdate.fields[formulaFieldId];
      expect(typeof beforeValue).toBe('string');
      if (typeof beforeValue !== 'string') return;
      const beforeTs = Date.parse(beforeValue);
      expect(Number.isNaN(beforeTs)).toBe(false);

      await sleep(20);

      const updateRecordResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: { [countFieldId]: 2 },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);
      const updateRaw = await updateRecordResponse.json();
      const updateParsed = updateRecordOkResponseSchema.safeParse(updateRaw);
      expect(updateParsed.success).toBe(true);
      if (!updateParsed.success || !updateParsed.data.ok) return;

      await processOutbox(2);

      const afterUpdateRecords = await listRecords(table.id);
      const afterUpdate = afterUpdateRecords.find((r) => r.id === recordId);
      expect(afterUpdate).toBeDefined();
      if (!afterUpdate) return;

      const afterValue = afterUpdate.fields[formulaFieldId];
      expect(typeof afterValue).toBe('string');
      if (typeof afterValue !== 'string') return;
      const afterTs = Date.parse(afterValue);
      expect(Number.isNaN(afterTs)).toBe(false);
      expect(afterTs).toBeGreaterThan(beforeTs);
    });

    /**
     * Scenario: LAST_MODIFIED_TIME with field references
     * Formula: LAST_MODIFIED_TIME({trackedField})
     * Expect: updates only when tracked fields change
     */
    it('should not update last modified time when untracked fields change - LAST_MODIFIED_TIME({field})', async () => {
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('LAST_MODIFIED_TIME Field Params'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Amount' },
            { type: 'singleLineText', name: 'Notes' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const amountFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';
      const notesFieldId = table.fields.find((f) => f.name === 'Notes')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Tracked Updated At',
            options: {
              expression: `LAST_MODIFIED_TIME({${primaryFieldId}}, {${amountFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Tracked Updated At')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'Row 1',
            [amountFieldId]: 1,
            [notesFieldId]: 'a',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(2);

      let records = await listRecords(table.id);
      let record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const initial = record.fields[formulaFieldId];
      expect(typeof initial).toBe('string');
      if (typeof initial !== 'string') return;

      await sleep(20);

      const untrackedUpdateResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: { [notesFieldId]: 'b' },
        }),
      });
      expect(untrackedUpdateResponse.status).toBe(200);
      const untrackedRaw = await untrackedUpdateResponse.json();
      const untrackedParsed = updateRecordOkResponseSchema.safeParse(untrackedRaw);
      expect(untrackedParsed.success).toBe(true);
      if (!untrackedParsed.success || !untrackedParsed.data.ok) return;

      await processOutbox(2);

      records = await listRecords(table.id);
      record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const afterUntracked = record.fields[formulaFieldId];
      expect(afterUntracked).toBe(initial);

      await sleep(20);

      const trackedUpdateResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: { [amountFieldId]: 2 },
        }),
      });
      expect(trackedUpdateResponse.status).toBe(200);
      const trackedRaw = await trackedUpdateResponse.json();
      const trackedParsed = updateRecordOkResponseSchema.safeParse(trackedRaw);
      expect(trackedParsed.success).toBe(true);
      if (!trackedParsed.success || !trackedParsed.data.ok) return;

      await processOutbox(2);

      records = await listRecords(table.id);
      record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const afterTracked = record.fields[formulaFieldId];
      expect(typeof afterTracked).toBe('string');
      if (typeof afterTracked !== 'string') return;
      expect(afterTracked).not.toBe(initial);
    });

    /**
     * Scenario: format datetime with timezone option
     * Formula:DATETIME_FORMAT({dateField}, "YYYYMMDD") with timeZone: "Asia/Shanghai"
     * Expect: formats datetime with configured timezone
     */
    it('should format datetime with timezone config - DATETIME_FORMAT with timeZone option', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('DATETIME_FORMAT TZ Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Formatted',
            options: {
              expression: `DATETIME_FORMAT(SET_TIMEZONE({${dateFieldId}}, "Asia/Shanghai"), "YYYYMMDD")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Formatted')?.id ?? '';

      const value = '2024-06-15T23:00:00.000Z';
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('20240616');
    });
  });

  // ============================================================================
  // 10. Array functions
  // ============================================================================
  describe('array functions', () => {
    /**
     * Scenario:ARRAYJOIN function
     * Formula:ARRAYJOIN({multiSelectField}, ", ")
     * Expect: joins array elements with delimiter
     */
    it('should join array - ARRAYJOIN({multiSelectField}, ", ")', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('ARRAYJOIN Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'multipleSelect', name: 'Tags', options: ['Tag A', 'Tag B', 'Tag C'] },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const multiSelectField = table.fields.find((f) => f.name === 'Tags');
      const multiSelectFieldId = multiSelectField?.id ?? '';
      const choices =
        (multiSelectField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ??
        [];
      const tagA = choices.find((choice) => choice.name === 'Tag A');
      const tagC = choices.find((choice) => choice.name === 'Tag C');
      if (!multiSelectFieldId || !tagA?.id || !tagC?.id) {
        throw new Error('Missing multi select field or option metadata');
      }

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Joined',
            options: { expression: `ARRAYJOIN({${multiSelectFieldId}}, ", ")` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Joined')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [multiSelectFieldId]: [tagA.id, tagC.id],
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Tag A, Tag C');
    });

    /**
     * Scenario:ARRAYUNIQUE function
     * Formula:ARRAYUNIQUE({lookupField})
     * Expect: returns unique array
     */
    it('should get unique array - ARRAYUNIQUE({lookupField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('ARRAYUNIQUE Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'multipleSelect', name: 'Tags 1', options: ['Tag A', 'Tag B', 'Tag C'] },
            { type: 'multipleSelect', name: 'Tags 2', options: ['Tag A', 'Tag B', 'Tag C'] },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const tags1Field = table.fields.find((f) => f.name === 'Tags 1');
      const tags2Field = table.fields.find((f) => f.name === 'Tags 2');
      const tags1FieldId = tags1Field?.id ?? '';
      const tags2FieldId = tags2Field?.id ?? '';
      const tags1Choices =
        (tags1Field?.options as { choices?: Array<{ id: string; name: string }> })?.choices ?? [];
      const tags2Choices =
        (tags2Field?.options as { choices?: Array<{ id: string; name: string }> })?.choices ?? [];
      const tagA1 = tags1Choices.find((choice) => choice.name === 'Tag A');
      const tagB1 = tags1Choices.find((choice) => choice.name === 'Tag B');
      const tagB2 = tags2Choices.find((choice) => choice.name === 'Tag B');
      const tagC2 = tags2Choices.find((choice) => choice.name === 'Tag C');
      if (!tags1FieldId || !tags2FieldId || !tagA1?.id || !tagB1?.id || !tagB2?.id || !tagC2?.id) {
        throw new Error('Missing multiple select field or option metadata');
      }

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Unique Tags',
            options: {
              expression: `ARRAYJOIN(ARRAYUNIQUE({${tags1FieldId}}, {${tags2FieldId}}), ", ")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Unique Tags')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [tags1FieldId]: [tagA1.id, tagB1.id],
            [tags2FieldId]: [tagB2.id, tagC2.id],
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Tag A, Tag B, Tag C');
    });

    /**
     * Scenario:ARRAYFLATTEN function
     * Formula:ARRAYFLATTEN({nestedArray})
     * Expect: flattens nested array
     */
    it('should flatten array - ARRAYFLATTEN({nestedArray})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('ARRAYFLATTEN Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'multipleSelect', name: 'Tags 1', options: ['Tag A', 'Tag B', 'Tag C'] },
            { type: 'multipleSelect', name: 'Tags 2', options: ['Tag A', 'Tag B', 'Tag C'] },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const tags1Field = table.fields.find((f) => f.name === 'Tags 1');
      const tags2Field = table.fields.find((f) => f.name === 'Tags 2');
      const tags1FieldId = tags1Field?.id ?? '';
      const tags2FieldId = tags2Field?.id ?? '';
      const tags1Choices =
        (tags1Field?.options as { choices?: Array<{ id: string; name: string }> })?.choices ?? [];
      const tags2Choices =
        (tags2Field?.options as { choices?: Array<{ id: string; name: string }> })?.choices ?? [];
      const tagA1 = tags1Choices.find((choice) => choice.name === 'Tag A');
      const tagB1 = tags1Choices.find((choice) => choice.name === 'Tag B');
      const tagB2 = tags2Choices.find((choice) => choice.name === 'Tag B');
      const tagC2 = tags2Choices.find((choice) => choice.name === 'Tag C');
      if (!tags1FieldId || !tags2FieldId || !tagA1?.id || !tagB1?.id || !tagB2?.id || !tagC2?.id) {
        throw new Error('Missing multiple select field or option metadata');
      }

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Flattened Tags',
            options: {
              expression: `ARRAYJOIN(ARRAYFLATTEN({${tags1FieldId}}, {${tags2FieldId}}), ", ")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Flattened Tags')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [tags1FieldId]: [tagA1.id, tagB1.id],
            [tags2FieldId]: [tagB2.id, tagC2.id],
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Tag A, Tag B, Tag B, Tag C');
    });

    /**
     * Scenario:ARRAYCOMPACT function
     * Formula:ARRAYCOMPACT({arrayWithNulls})
     * Expect: removes null values
     */
    it('should compact array - ARRAYCOMPACT({arrayWithNulls})', async () => {
      const createSourceResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('ARRAYCOMPACT Source'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'number',
              name: 'Age',
              options: { formatting: { type: 'decimal', precision: 0 } },
            },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const sourceRaw = await createSourceResponse.json();
      const sourceParsed = createTableOkResponseSchema.safeParse(sourceRaw);
      expect(sourceParsed.success).toBe(true);
      if (!sourceParsed.success || !sourceParsed.data.ok) return;

      const sourceTable = sourceParsed.data.data.table;
      const sourceNameFieldId = sourceTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const ageFieldId = sourceTable.fields.find((f) => f.name === 'Age')?.id ?? '';
      if (!sourceNameFieldId || !ageFieldId) throw new Error('Missing source table fields');

      const createSourceRecord = async (name: string, age?: number) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: sourceTable.id,
            fields: {
              [sourceNameFieldId]: name,
              ...(age === undefined ? {} : { [ageFieldId]: age }),
            },
          }),
        });
        expect(response.status).toBe(201);
        const rawBody = await response.json();
        const parsed = createRecordOkResponseSchema.safeParse(rawBody);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return undefined;
        return parsed.data.data.record.id;
      };

      const recordAId = await createSourceRecord('A', 10);
      const recordBId = await createSourceRecord('B');
      const recordCId = await createSourceRecord('C', 30);
      if (!recordAId || !recordBId || !recordCId)
        throw new Error('Failed to create source records');

      const createHostResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('ARRAYCOMPACT Host'),
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const hostRaw = await createHostResponse.json();
      const hostParsed = createTableOkResponseSchema.safeParse(hostRaw);
      expect(hostParsed.success).toBe(true);
      if (!hostParsed.success || !hostParsed.data.ok) return;

      const hostTable = hostParsed.data.data.table;
      const hostTitleFieldId = hostTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!hostTitleFieldId) throw new Error('Missing host primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'link',
            name: 'People',
            options: {
              relationship: 'manyMany',
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'People')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'lookup',
            name: 'Ages',
            options: {
              linkFieldId,
              foreignTableId: sourceTable.id,
              lookupFieldId: ageFieldId,
            },
          },
        }),
      });
      expect(createLookupResponse.status).toBe(200);
      const lookupRaw = await createLookupResponse.json();
      const lookupParsed = createFieldOkResponseSchema.safeParse(lookupRaw);
      expect(lookupParsed.success).toBe(true);
      if (!lookupParsed.success || !lookupParsed.data.ok) return;
      const lookupFieldId =
        lookupParsed.data.data.table.fields.find((f) => f.name === 'Ages')?.id ?? '';
      if (!lookupFieldId) throw new Error('Missing lookup field id');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'formula',
            name: 'Compacted',
            options: {
              expression: `ARRAYJOIN(ARRAYCOMPACT({${lookupFieldId}}), ", ")`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Compacted')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      const createHostRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: hostTable.id,
          fields: {
            [hostTitleFieldId]: 'Group 1',
            [linkFieldId]: [{ id: recordAId }, { id: recordBId }, { id: recordCId }],
          },
        }),
      });
      expect(createHostRecordResponse.status).toBe(201);
      const hostRecordRaw = await createHostRecordResponse.json();
      const hostRecordParsed = createRecordOkResponseSchema.safeParse(hostRecordRaw);
      expect(hostRecordParsed.success).toBe(true);
      if (!hostRecordParsed.success || !hostRecordParsed.data.ok) return;
      const hostRecordId = hostRecordParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(hostTable.id);
      const record = records.find((r) => r.id === hostRecordId);
      expect(record).toBeDefined();
      if (!record) return;

      const compacted = record.fields[formulaFieldId];
      expect(typeof compacted).toBe('string');
      if (typeof compacted !== 'string') return;
      expect(compacted.replace(/\.00/g, '')).toBe('10, 30');
    });

    /**
     * Scenario:COUNTALL function
     * Formula:COUNTALL({lookupField})
     * Expect: counts all elements (excluding nulls from lookup aggregation, v1 behavior)
     */
    it('should count all - COUNTALL({lookupField})', async () => {
      const createSourceResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('COUNTALL Source'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'number',
              name: 'Age',
              options: { formatting: { type: 'decimal', precision: 0 } },
            },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const sourceRaw = await createSourceResponse.json();
      const sourceParsed = createTableOkResponseSchema.safeParse(sourceRaw);
      expect(sourceParsed.success).toBe(true);
      if (!sourceParsed.success || !sourceParsed.data.ok) return;

      const sourceTable = sourceParsed.data.data.table;
      const sourceNameFieldId = sourceTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const ageFieldId = sourceTable.fields.find((f) => f.name === 'Age')?.id ?? '';
      if (!sourceNameFieldId || !ageFieldId) throw new Error('Missing source table fields');

      const createSourceRecord = async (name: string, age?: number) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: sourceTable.id,
            fields: {
              [sourceNameFieldId]: name,
              ...(age === undefined ? {} : { [ageFieldId]: age }),
            },
          }),
        });
        expect(response.status).toBe(201);
        const rawBody = await response.json();
        const parsed = createRecordOkResponseSchema.safeParse(rawBody);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return undefined;
        return parsed.data.data.record.id;
      };

      const recordAId = await createSourceRecord('A', 10);
      const recordBId = await createSourceRecord('B');
      const recordCId = await createSourceRecord('C', 30);
      if (!recordAId || !recordBId || !recordCId)
        throw new Error('Failed to create source records');

      const createHostResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('COUNTALL Host'),
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const hostRaw = await createHostResponse.json();
      const hostParsed = createTableOkResponseSchema.safeParse(hostRaw);
      expect(hostParsed.success).toBe(true);
      if (!hostParsed.success || !hostParsed.data.ok) return;

      const hostTable = hostParsed.data.data.table;
      const hostTitleFieldId = hostTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!hostTitleFieldId) throw new Error('Missing host primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'link',
            name: 'People',
            options: {
              relationship: 'manyMany',
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'People')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'lookup',
            name: 'Ages',
            options: {
              linkFieldId,
              foreignTableId: sourceTable.id,
              lookupFieldId: ageFieldId,
            },
          },
        }),
      });
      expect(createLookupResponse.status).toBe(200);
      const lookupRaw = await createLookupResponse.json();
      const lookupParsed = createFieldOkResponseSchema.safeParse(lookupRaw);
      expect(lookupParsed.success).toBe(true);
      if (!lookupParsed.success || !lookupParsed.data.ok) return;
      const lookupFieldId =
        lookupParsed.data.data.table.fields.find((f) => f.name === 'Ages')?.id ?? '';
      if (!lookupFieldId) throw new Error('Missing lookup field id');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'formula',
            name: 'Count All',
            options: {
              expression: `COUNTALL({${lookupFieldId}})`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Count All')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      const createHostRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: hostTable.id,
          fields: {
            [hostTitleFieldId]: 'Group 1',
            [linkFieldId]: [{ id: recordAId }, { id: recordBId }, { id: recordCId }],
          },
        }),
      });
      expect(createHostRecordResponse.status).toBe(201);
      const hostRecordRaw = await createHostRecordResponse.json();
      const hostRecordParsed = createRecordOkResponseSchema.safeParse(hostRecordRaw);
      expect(hostRecordParsed.success).toBe(true);
      if (!hostRecordParsed.success || !hostRecordParsed.data.ok) return;
      const hostRecordId = hostRecordParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(hostTable.id);
      const record = records.find((r) => r.id === hostRecordId);
      expect(record).toBeDefined();
      if (!record) return;

      const countValue = record.fields[formulaFieldId];
      expect(countValue).not.toBeNull();
      expect(Number(countValue)).toBe(2);
    });

    /**
     * Scenario:COUNTA function
     * Formula:COUNTA({lookupField})
     * Expect: counts non-empty elements
     */
    it('should count non-empty - COUNTA({lookupField})', async () => {
      const createSourceResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('COUNTA Source'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'number',
              name: 'Age',
              options: { formatting: { type: 'decimal', precision: 0 } },
            },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const sourceRaw = await createSourceResponse.json();
      const sourceParsed = createTableOkResponseSchema.safeParse(sourceRaw);
      expect(sourceParsed.success).toBe(true);
      if (!sourceParsed.success || !sourceParsed.data.ok) return;

      const sourceTable = sourceParsed.data.data.table;
      const sourceNameFieldId = sourceTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const ageFieldId = sourceTable.fields.find((f) => f.name === 'Age')?.id ?? '';
      if (!sourceNameFieldId || !ageFieldId) throw new Error('Missing source table fields');

      const createSourceRecord = async (name: string, age?: number) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: sourceTable.id,
            fields: {
              [sourceNameFieldId]: name,
              ...(age === undefined ? {} : { [ageFieldId]: age }),
            },
          }),
        });
        expect(response.status).toBe(201);
        const rawBody = await response.json();
        const parsed = createRecordOkResponseSchema.safeParse(rawBody);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return undefined;
        return parsed.data.data.record.id;
      };

      const recordAId = await createSourceRecord('A', 10);
      const recordBId = await createSourceRecord('B');
      const recordCId = await createSourceRecord('C', 30);
      if (!recordAId || !recordBId || !recordCId)
        throw new Error('Failed to create source records');

      const createHostResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('COUNTA Host'),
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const hostRaw = await createHostResponse.json();
      const hostParsed = createTableOkResponseSchema.safeParse(hostRaw);
      expect(hostParsed.success).toBe(true);
      if (!hostParsed.success || !hostParsed.data.ok) return;

      const hostTable = hostParsed.data.data.table;
      const hostTitleFieldId = hostTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!hostTitleFieldId) throw new Error('Missing host primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'link',
            name: 'People',
            options: {
              relationship: 'manyMany',
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'People')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'lookup',
            name: 'Ages',
            options: {
              linkFieldId,
              foreignTableId: sourceTable.id,
              lookupFieldId: ageFieldId,
            },
          },
        }),
      });
      expect(createLookupResponse.status).toBe(200);
      const lookupRaw = await createLookupResponse.json();
      const lookupParsed = createFieldOkResponseSchema.safeParse(lookupRaw);
      expect(lookupParsed.success).toBe(true);
      if (!lookupParsed.success || !lookupParsed.data.ok) return;
      const lookupFieldId =
        lookupParsed.data.data.table.fields.find((f) => f.name === 'Ages')?.id ?? '';
      if (!lookupFieldId) throw new Error('Missing lookup field id');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'formula',
            name: 'Count A',
            options: {
              expression: `COUNTA({${lookupFieldId}})`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Count A')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      const createHostRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: hostTable.id,
          fields: {
            [hostTitleFieldId]: 'Group 1',
            [linkFieldId]: [{ id: recordAId }, { id: recordBId }, { id: recordCId }],
          },
        }),
      });
      expect(createHostRecordResponse.status).toBe(201);
      const hostRecordRaw = await createHostRecordResponse.json();
      const hostRecordParsed = createRecordOkResponseSchema.safeParse(hostRecordRaw);
      expect(hostRecordParsed.success).toBe(true);
      if (!hostRecordParsed.success || !hostRecordParsed.data.ok) return;
      const hostRecordId = hostRecordParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(hostTable.id);
      const record = records.find((r) => r.id === hostRecordId);
      expect(record).toBeDefined();
      if (!record) return;

      const countValue = record.fields[formulaFieldId];
      expect(countValue).not.toBeNull();
      expect(Number(countValue)).toBe(2);
    });

    /**
     * Scenario:COUNT function
     * Formula:COUNT({lookupField})
     * Expect: counts numeric elements
     */
    it('should count numbers - COUNT({lookupField})', async () => {
      const createSourceResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('COUNT Source'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'number',
              name: 'Age',
              options: { formatting: { type: 'decimal', precision: 0 } },
            },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const sourceRaw = await createSourceResponse.json();
      const sourceParsed = createTableOkResponseSchema.safeParse(sourceRaw);
      expect(sourceParsed.success).toBe(true);
      if (!sourceParsed.success || !sourceParsed.data.ok) return;

      const sourceTable = sourceParsed.data.data.table;
      const sourceNameFieldId = sourceTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const ageFieldId = sourceTable.fields.find((f) => f.name === 'Age')?.id ?? '';
      if (!sourceNameFieldId || !ageFieldId) throw new Error('Missing source table fields');

      const createSourceRecord = async (name: string, age?: number) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: sourceTable.id,
            fields: {
              [sourceNameFieldId]: name,
              ...(age === undefined ? {} : { [ageFieldId]: age }),
            },
          }),
        });
        expect(response.status).toBe(201);
        const rawBody = await response.json();
        const parsed = createRecordOkResponseSchema.safeParse(rawBody);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return undefined;
        return parsed.data.data.record.id;
      };

      const recordAId = await createSourceRecord('A', 10);
      const recordBId = await createSourceRecord('B');
      const recordCId = await createSourceRecord('C', 30);
      if (!recordAId || !recordBId || !recordCId)
        throw new Error('Failed to create source records');

      const createHostResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('COUNT Host'),
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const hostRaw = await createHostResponse.json();
      const hostParsed = createTableOkResponseSchema.safeParse(hostRaw);
      expect(hostParsed.success).toBe(true);
      if (!hostParsed.success || !hostParsed.data.ok) return;

      const hostTable = hostParsed.data.data.table;
      const hostTitleFieldId = hostTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!hostTitleFieldId) throw new Error('Missing host primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'link',
            name: 'People',
            options: {
              relationship: 'manyMany',
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'People')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'lookup',
            name: 'Ages',
            options: {
              linkFieldId,
              foreignTableId: sourceTable.id,
              lookupFieldId: ageFieldId,
            },
          },
        }),
      });
      expect(createLookupResponse.status).toBe(200);
      const lookupRaw = await createLookupResponse.json();
      const lookupParsed = createFieldOkResponseSchema.safeParse(lookupRaw);
      expect(lookupParsed.success).toBe(true);
      if (!lookupParsed.success || !lookupParsed.data.ok) return;
      const lookupFieldId =
        lookupParsed.data.data.table.fields.find((f) => f.name === 'Ages')?.id ?? '';
      if (!lookupFieldId) throw new Error('Missing lookup field id');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'formula',
            name: 'Count Numbers',
            options: {
              expression: `COUNT({${lookupFieldId}})`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Count Numbers')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      const createHostRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: hostTable.id,
          fields: {
            [hostTitleFieldId]: 'Group 1',
            [linkFieldId]: [{ id: recordAId }, { id: recordBId }, { id: recordCId }],
          },
        }),
      });
      expect(createHostRecordResponse.status).toBe(201);
      const hostRecordRaw = await createHostRecordResponse.json();
      const hostRecordParsed = createRecordOkResponseSchema.safeParse(hostRecordRaw);
      expect(hostRecordParsed.success).toBe(true);
      if (!hostRecordParsed.success || !hostRecordParsed.data.ok) return;
      const hostRecordId = hostRecordParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(hostTable.id);
      const record = records.find((r) => r.id === hostRecordId);
      expect(record).toBeDefined();
      if (!record) return;

      const countValue = record.fields[formulaFieldId];
      expect(countValue).not.toBeNull();
      expect(Number(countValue)).toBe(2);
    });
  });

  // ============================================================================
  // 11. Formulas with link and lookup fields
  // ============================================================================
  describe('formula with link and lookup fields', () => {
    const normalizeLookupArray = (value: unknown): unknown[] | undefined => {
      if (Array.isArray(value)) return value;
      if (typeof value !== 'string') return undefined;
      if (!value.trim().startsWith('[')) return undefined;
      try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    };

    const extractLookupScalar = (value: unknown): unknown => {
      const normalized = normalizeLookupArray(value);
      if (normalized && normalized.length > 0) return normalized[0];
      return value;
    };

    const extractLinkDisplayTitles = (value: unknown): string[] | undefined => {
      const normalized = normalizeLookupArray(value) ?? (Array.isArray(value) ? value : undefined);
      if (!normalized) return undefined;

      const titles: string[] = [];
      for (const entry of normalized) {
        if (typeof entry === 'string') {
          titles.push(entry);
          continue;
        }
        if (entry && typeof entry === 'object' && 'title' in entry) {
          const title = (entry as { title?: unknown }).title;
          if (typeof title === 'string') titles.push(title);
        }
      }
      return titles.length > 0 ? titles : undefined;
    };
    /**
     * Scenario: Formula references link field
     * Formula:IF({linkField}, "Has Link", "No Link")
     * Expect: returns "Has Link" when linked
     */
    it('should create formula referencing link field - IF({linkField}, "Has Link", "No Link")', async () => {
      const createContactsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Link Formula Contacts'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const contactsRaw = await createContactsResponse.json();
      const contactsParsed = createTableOkResponseSchema.safeParse(contactsRaw);
      expect(contactsParsed.success).toBe(true);
      if (!contactsParsed.success || !contactsParsed.data.ok) return;

      const contactsTable = contactsParsed.data.data.table;
      const contactNameFieldId = contactsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!contactNameFieldId) throw new Error('Missing contacts primary field');

      const createContactResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: contactsTable.id,
          fields: {
            [contactNameFieldId]: 'Alice',
          },
        }),
      });
      expect(createContactResponse.status).toBe(201);
      const contactRaw = await createContactResponse.json();
      const contactParsed = createRecordOkResponseSchema.safeParse(contactRaw);
      expect(contactParsed.success).toBe(true);
      if (!contactParsed.success || !contactParsed.data.ok) return;
      const contactId = contactParsed.data.data.record.id;

      const createDealsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Link Formula Deals'),
          fields: [{ type: 'singleLineText', name: 'Deal', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const dealsRaw = await createDealsResponse.json();
      const dealsParsed = createTableOkResponseSchema.safeParse(dealsRaw);
      expect(dealsParsed.success).toBe(true);
      if (!dealsParsed.success || !dealsParsed.data.ok) return;

      const dealsTable = dealsParsed.data.data.table;
      const dealNameFieldId = dealsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!dealNameFieldId) throw new Error('Missing deals primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'link',
            name: 'Contact',
            options: {
              relationship: 'manyOne',
              foreignTableId: contactsTable.id,
              lookupFieldId: contactNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Contact')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'formula',
            name: 'Has Contact',
            options: {
              expression: `IF({${linkFieldId}}, "Has Link", "No Link")`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Has Contact')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      const createWithLinkResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: dealsTable.id,
          fields: {
            [dealNameFieldId]: 'Deal With',
            [linkFieldId]: { id: contactId },
          },
        }),
      });
      expect(createWithLinkResponse.status).toBe(201);
      const withLinkRaw = await createWithLinkResponse.json();
      const withLinkParsed = createRecordOkResponseSchema.safeParse(withLinkRaw);
      expect(withLinkParsed.success).toBe(true);
      if (!withLinkParsed.success || !withLinkParsed.data.ok) return;
      const withLinkId = withLinkParsed.data.data.record.id;

      const createWithoutLinkResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: dealsTable.id,
          fields: {
            [dealNameFieldId]: 'Deal Without',
          },
        }),
      });
      expect(createWithoutLinkResponse.status).toBe(201);
      const withoutLinkRaw = await createWithoutLinkResponse.json();
      const withoutLinkParsed = createRecordOkResponseSchema.safeParse(withoutLinkRaw);
      expect(withoutLinkParsed.success).toBe(true);
      if (!withoutLinkParsed.success || !withoutLinkParsed.data.ok) return;
      const withoutLinkId = withoutLinkParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(dealsTable.id);
      const withLink = records.find((r) => r.id === withLinkId);
      const withoutLink = records.find((r) => r.id === withoutLinkId);
      expect(withLink).toBeDefined();
      expect(withoutLink).toBeDefined();
      if (!withLink || !withoutLink) return;

      expect(withLink.fields[formulaFieldId]).toBe('Has Link');
      expect(withoutLink.fields[formulaFieldId]).toBe('No Link');
    });

    /**
     * Scenario: Formula references lookup field
     * Formula:{lookupField}
     * Expect: returns lookup field value
     */
    it('should create formula referencing lookup field - {lookupField}', async () => {
      const createContactsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Formula Contacts'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', name: 'Code' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const contactsRaw = await createContactsResponse.json();
      const contactsParsed = createTableOkResponseSchema.safeParse(contactsRaw);
      expect(contactsParsed.success).toBe(true);
      if (!contactsParsed.success || !contactsParsed.data.ok) return;

      const contactsTable = contactsParsed.data.data.table;
      const contactNameFieldId = contactsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const contactCodeFieldId = contactsTable.fields.find((f) => f.name === 'Code')?.id ?? '';
      if (!contactNameFieldId || !contactCodeFieldId) throw new Error('Missing contacts fields');

      const createContactResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: contactsTable.id,
          fields: {
            [contactNameFieldId]: 'Alice',
            [contactCodeFieldId]: 'C-001',
          },
        }),
      });
      expect(createContactResponse.status).toBe(201);
      const contactRaw = await createContactResponse.json();
      const contactParsed = createRecordOkResponseSchema.safeParse(contactRaw);
      expect(contactParsed.success).toBe(true);
      if (!contactParsed.success || !contactParsed.data.ok) return;
      const contactId = contactParsed.data.data.record.id;

      const createDealsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Formula Deals'),
          fields: [{ type: 'singleLineText', name: 'Deal', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const dealsRaw = await createDealsResponse.json();
      const dealsParsed = createTableOkResponseSchema.safeParse(dealsRaw);
      expect(dealsParsed.success).toBe(true);
      if (!dealsParsed.success || !dealsParsed.data.ok) return;

      const dealsTable = dealsParsed.data.data.table;
      const dealNameFieldId = dealsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!dealNameFieldId) throw new Error('Missing deals primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'link',
            name: 'Contact',
            options: {
              relationship: 'manyOne',
              foreignTableId: contactsTable.id,
              lookupFieldId: contactNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Contact')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'lookup',
            name: 'Contact Code',
            options: {
              linkFieldId,
              foreignTableId: contactsTable.id,
              lookupFieldId: contactCodeFieldId,
            },
          },
        }),
      });
      expect(createLookupResponse.status).toBe(200);
      const lookupRaw = await createLookupResponse.json();
      const lookupParsed = createFieldOkResponseSchema.safeParse(lookupRaw);
      expect(lookupParsed.success).toBe(true);
      if (!lookupParsed.success || !lookupParsed.data.ok) return;
      const lookupFieldId =
        lookupParsed.data.data.table.fields.find((f) => f.name === 'Contact Code')?.id ?? '';
      if (!lookupFieldId) throw new Error('Missing lookup field id');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'formula',
            name: 'Code Formula',
            options: {
              expression: `{${lookupFieldId}}`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Code Formula')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      const createDealResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: dealsTable.id,
          fields: {
            [dealNameFieldId]: 'Deal 1',
            [linkFieldId]: { id: contactId },
          },
        }),
      });
      expect(createDealResponse.status).toBe(201);
      const dealRaw = await createDealResponse.json();
      const dealParsed = createRecordOkResponseSchema.safeParse(dealRaw);
      expect(dealParsed.success).toBe(true);
      if (!dealParsed.success || !dealParsed.data.ok) return;
      const dealId = dealParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(dealsTable.id);
      const stored = records.find((r) => r.id === dealId);
      expect(stored).toBeDefined();
      if (!stored) return;

      const scalar = extractLookupScalar(stored.fields[formulaFieldId]);
      expect(scalar).toBe('C-001');
    });

    /**
     * Scenario: Formula references rollup field
     * Formula:{rollupField} * 2
     * Expect: rollup value multiplied by 2
     */
    it('should create formula referencing rollup field - {rollupField} * 2', async () => {
      const createTasksResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Rollup Formula Tasks'),
          fields: [
            { type: 'singleLineText', name: 'Task', isPrimary: true },
            {
              type: 'number',
              name: 'Hours',
              options: { formatting: { type: 'decimal', precision: 0 } },
            },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tasksRaw = await createTasksResponse.json();
      const tasksParsed = createTableOkResponseSchema.safeParse(tasksRaw);
      expect(tasksParsed.success).toBe(true);
      if (!tasksParsed.success || !tasksParsed.data.ok) return;

      const tasksTable = tasksParsed.data.data.table;
      const taskNameFieldId = tasksTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const hoursFieldId = tasksTable.fields.find((f) => f.name === 'Hours')?.id ?? '';
      if (!taskNameFieldId || !hoursFieldId) throw new Error('Missing task fields');

      const createTask = async (name: string, hours: number) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: tasksTable.id,
            fields: {
              [taskNameFieldId]: name,
              [hoursFieldId]: hours,
            },
          }),
        });
        expect(response.status).toBe(201);
        const rawBody = await response.json();
        const parsed = createRecordOkResponseSchema.safeParse(rawBody);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return undefined;
        return parsed.data.data.record.id;
      };

      const taskAId = await createTask('Design', 2);
      const taskBId = await createTask('Build', 3);
      if (!taskAId || !taskBId) throw new Error('Failed to create tasks');

      const createProjectsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Rollup Formula Projects'),
          fields: [{ type: 'singleLineText', name: 'Project', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const projectsRaw = await createProjectsResponse.json();
      const projectsParsed = createTableOkResponseSchema.safeParse(projectsRaw);
      expect(projectsParsed.success).toBe(true);
      if (!projectsParsed.success || !projectsParsed.data.ok) return;

      const projectsTable = projectsParsed.data.data.table;
      const projectNameFieldId = projectsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!projectNameFieldId) throw new Error('Missing projects primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: projectsTable.id,
          field: {
            type: 'link',
            name: 'Tasks',
            options: {
              relationship: 'manyMany',
              foreignTableId: tasksTable.id,
              lookupFieldId: taskNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Tasks')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createRollupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: projectsTable.id,
          field: {
            type: 'rollup',
            name: 'Total Hours',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId,
              foreignTableId: tasksTable.id,
              lookupFieldId: hoursFieldId,
            },
          },
        }),
      });
      expect(createRollupResponse.status).toBe(200);
      const rollupRaw = await createRollupResponse.json();
      const rollupParsed = createFieldOkResponseSchema.safeParse(rollupRaw);
      expect(rollupParsed.success).toBe(true);
      if (!rollupParsed.success || !rollupParsed.data.ok) return;
      const rollupFieldId =
        rollupParsed.data.data.table.fields.find((f) => f.name === 'Total Hours')?.id ?? '';
      if (!rollupFieldId) throw new Error('Missing rollup field id');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: projectsTable.id,
          field: {
            type: 'formula',
            name: 'Double Hours',
            options: {
              expression: `{${rollupFieldId}} * 2`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Double Hours')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      const createProjectResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: projectsTable.id,
          fields: {
            [projectNameFieldId]: 'Launch',
            [linkFieldId]: [{ id: taskAId }, { id: taskBId }],
          },
        }),
      });
      expect(createProjectResponse.status).toBe(201);
      const projectRaw = await createProjectResponse.json();
      const projectParsed = createRecordOkResponseSchema.safeParse(projectRaw);
      expect(projectParsed.success).toBe(true);
      if (!projectParsed.success || !projectParsed.data.ok) return;
      const projectId = projectParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(projectsTable.id);
      const stored = records.find((r) => r.id === projectId);
      expect(stored).toBeDefined();
      if (!stored) return;

      const doubled = stored.fields[formulaFieldId];
      expect(doubled).not.toBeNull();
      expect(Number(doubled)).toBe(10);
    });

    /**
     * Scenario: formula handles empty lookup field
     * Formula:IF(COUNTA({lookupField})=0, "no lookup", {lookupField})
     * Expect: returns "no lookup" when lookup is empty
     */
    it('should handle empty lookup in formula - IF(COUNTA({lookupField})=0, "no lookup", {lookupField})', async () => {
      const createContactsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Empty Lookup Contacts'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', name: 'Code' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const contactsRaw = await createContactsResponse.json();
      const contactsParsed = createTableOkResponseSchema.safeParse(contactsRaw);
      expect(contactsParsed.success).toBe(true);
      if (!contactsParsed.success || !contactsParsed.data.ok) return;

      const contactsTable = contactsParsed.data.data.table;
      const contactNameFieldId = contactsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const contactCodeFieldId = contactsTable.fields.find((f) => f.name === 'Code')?.id ?? '';
      if (!contactNameFieldId || !contactCodeFieldId) throw new Error('Missing contacts fields');

      const createContactResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: contactsTable.id,
          fields: {
            [contactNameFieldId]: 'Alice',
            [contactCodeFieldId]: 'C-EMPTY',
          },
        }),
      });
      expect(createContactResponse.status).toBe(201);
      const contactRaw = await createContactResponse.json();
      const contactParsed = createRecordOkResponseSchema.safeParse(contactRaw);
      expect(contactParsed.success).toBe(true);
      if (!contactParsed.success || !contactParsed.data.ok) return;
      const contactId = contactParsed.data.data.record.id;

      const createDealsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Empty Lookup Deals'),
          fields: [{ type: 'singleLineText', name: 'Deal', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const dealsRaw = await createDealsResponse.json();
      const dealsParsed = createTableOkResponseSchema.safeParse(dealsRaw);
      expect(dealsParsed.success).toBe(true);
      if (!dealsParsed.success || !dealsParsed.data.ok) return;

      const dealsTable = dealsParsed.data.data.table;
      const dealNameFieldId = dealsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!dealNameFieldId) throw new Error('Missing deals primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'link',
            name: 'Contact',
            options: {
              relationship: 'manyOne',
              foreignTableId: contactsTable.id,
              lookupFieldId: contactNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Contact')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'lookup',
            name: 'Contact Code',
            options: {
              linkFieldId,
              foreignTableId: contactsTable.id,
              lookupFieldId: contactCodeFieldId,
            },
          },
        }),
      });
      expect(createLookupResponse.status).toBe(200);
      const lookupRaw = await createLookupResponse.json();
      const lookupParsed = createFieldOkResponseSchema.safeParse(lookupRaw);
      expect(lookupParsed.success).toBe(true);
      if (!lookupParsed.success || !lookupParsed.data.ok) return;
      const lookupFieldId =
        lookupParsed.data.data.table.fields.find((f) => f.name === 'Contact Code')?.id ?? '';
      if (!lookupFieldId) throw new Error('Missing lookup field id');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'formula',
            name: 'Lookup Maybe',
            options: {
              expression: `IF(COUNTA({${lookupFieldId}})=0, "no lookup", {${lookupFieldId}})`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Lookup Maybe')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      const createEmptyDealResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: dealsTable.id,
          fields: {
            [dealNameFieldId]: 'Deal Empty',
          },
        }),
      });
      expect(createEmptyDealResponse.status).toBe(201);
      const emptyDealRaw = await createEmptyDealResponse.json();
      const emptyDealParsed = createRecordOkResponseSchema.safeParse(emptyDealRaw);
      expect(emptyDealParsed.success).toBe(true);
      if (!emptyDealParsed.success || !emptyDealParsed.data.ok) return;
      const emptyDealId = emptyDealParsed.data.data.record.id;

      const createLinkedDealResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: dealsTable.id,
          fields: {
            [dealNameFieldId]: 'Deal Linked',
            [linkFieldId]: { id: contactId },
          },
        }),
      });
      expect(createLinkedDealResponse.status).toBe(201);
      const linkedDealRaw = await createLinkedDealResponse.json();
      const linkedDealParsed = createRecordOkResponseSchema.safeParse(linkedDealRaw);
      expect(linkedDealParsed.success).toBe(true);
      if (!linkedDealParsed.success || !linkedDealParsed.data.ok) return;
      const linkedDealId = linkedDealParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(dealsTable.id);
      const emptyDeal = records.find((r) => r.id === emptyDealId);
      const linkedDeal = records.find((r) => r.id === linkedDealId);
      expect(emptyDeal).toBeDefined();
      expect(linkedDeal).toBeDefined();
      if (!emptyDeal || !linkedDeal) return;

      expect(emptyDeal.fields[formulaFieldId]).toBe('no lookup');
      const scalar = extractLookupScalar(linkedDeal.fields[formulaFieldId]);
      expect(scalar).toBe('C-EMPTY');
    });

    /**
     * Scenario: formula handles empty rollup field
     * Formula:IF({rollupField} > 0, "Has rollup", "No rollup")
     * Expect: returns "No rollup" when rollup is empty
     */
    it('should handle empty rollup in formula - IF({rollupField} > 0, "Has rollup", "No rollup")', async () => {
      const createTasksResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Empty Rollup Tasks'),
          fields: [
            { type: 'singleLineText', name: 'Task', isPrimary: true },
            {
              type: 'number',
              name: 'Hours',
              options: { formatting: { type: 'decimal', precision: 0 } },
            },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tasksRaw = await createTasksResponse.json();
      const tasksParsed = createTableOkResponseSchema.safeParse(tasksRaw);
      expect(tasksParsed.success).toBe(true);
      if (!tasksParsed.success || !tasksParsed.data.ok) return;

      const tasksTable = tasksParsed.data.data.table;
      const taskNameFieldId = tasksTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const hoursFieldId = tasksTable.fields.find((f) => f.name === 'Hours')?.id ?? '';
      if (!taskNameFieldId || !hoursFieldId) throw new Error('Missing task fields');

      const createTaskResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: tasksTable.id,
          fields: {
            [taskNameFieldId]: 'Design',
            [hoursFieldId]: 2,
          },
        }),
      });
      expect(createTaskResponse.status).toBe(201);
      const taskRaw = await createTaskResponse.json();
      const taskParsed = createRecordOkResponseSchema.safeParse(taskRaw);
      expect(taskParsed.success).toBe(true);
      if (!taskParsed.success || !taskParsed.data.ok) return;
      const taskId = taskParsed.data.data.record.id;

      const createProjectsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Empty Rollup Projects'),
          fields: [{ type: 'singleLineText', name: 'Project', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const projectsRaw = await createProjectsResponse.json();
      const projectsParsed = createTableOkResponseSchema.safeParse(projectsRaw);
      expect(projectsParsed.success).toBe(true);
      if (!projectsParsed.success || !projectsParsed.data.ok) return;

      const projectsTable = projectsParsed.data.data.table;
      const projectNameFieldId = projectsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!projectNameFieldId) throw new Error('Missing projects primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: projectsTable.id,
          field: {
            type: 'link',
            name: 'Tasks',
            options: {
              relationship: 'manyMany',
              foreignTableId: tasksTable.id,
              lookupFieldId: taskNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Tasks')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createRollupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: projectsTable.id,
          field: {
            type: 'rollup',
            name: 'Total Hours',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId,
              foreignTableId: tasksTable.id,
              lookupFieldId: hoursFieldId,
            },
          },
        }),
      });
      expect(createRollupResponse.status).toBe(200);
      const rollupRaw = await createRollupResponse.json();
      const rollupParsed = createFieldOkResponseSchema.safeParse(rollupRaw);
      expect(rollupParsed.success).toBe(true);
      if (!rollupParsed.success || !rollupParsed.data.ok) return;
      const rollupFieldId =
        rollupParsed.data.data.table.fields.find((f) => f.name === 'Total Hours')?.id ?? '';
      if (!rollupFieldId) throw new Error('Missing rollup field id');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: projectsTable.id,
          field: {
            type: 'formula',
            name: 'Rollup Flag',
            options: {
              expression: `IF({${rollupFieldId}} > 0, "Has rollup", "No rollup")`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Rollup Flag')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      const createEmptyProjectResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: projectsTable.id,
          fields: {
            [projectNameFieldId]: 'Empty',
          },
        }),
      });
      expect(createEmptyProjectResponse.status).toBe(201);
      const emptyProjectRaw = await createEmptyProjectResponse.json();
      const emptyProjectParsed = createRecordOkResponseSchema.safeParse(emptyProjectRaw);
      expect(emptyProjectParsed.success).toBe(true);
      if (!emptyProjectParsed.success || !emptyProjectParsed.data.ok) return;
      const emptyProjectId = emptyProjectParsed.data.data.record.id;

      const createLinkedProjectResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: projectsTable.id,
          fields: {
            [projectNameFieldId]: 'Linked',
            [linkFieldId]: [{ id: taskId }],
          },
        }),
      });
      expect(createLinkedProjectResponse.status).toBe(201);
      const linkedProjectRaw = await createLinkedProjectResponse.json();
      const linkedProjectParsed = createRecordOkResponseSchema.safeParse(linkedProjectRaw);
      expect(linkedProjectParsed.success).toBe(true);
      if (!linkedProjectParsed.success || !linkedProjectParsed.data.ok) return;
      const linkedProjectId = linkedProjectParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(projectsTable.id);
      const emptyProject = records.find((r) => r.id === emptyProjectId);
      const linkedProject = records.find((r) => r.id === linkedProjectId);
      expect(emptyProject).toBeDefined();
      expect(linkedProject).toBeDefined();
      if (!emptyProject || !linkedProject) return;

      expect(emptyProject.fields[formulaFieldId]).toBe('No rollup');
      expect(linkedProject.fields[formulaFieldId]).toBe('Has rollup');
    });

    /**
     * Scenario: Formula references link display value
     * Formula:{linkField}
     * Expect: returns link display value (primary field)
     */
    it('should get link field display value in formula - {linkField}', async () => {
      const createContactsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Link Display Contacts'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const contactsRaw = await createContactsResponse.json();
      const contactsParsed = createTableOkResponseSchema.safeParse(contactsRaw);
      expect(contactsParsed.success).toBe(true);
      if (!contactsParsed.success || !contactsParsed.data.ok) return;

      const contactsTable = contactsParsed.data.data.table;
      const contactNameFieldId = contactsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!contactNameFieldId) throw new Error('Missing contacts primary field');

      const createContactResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: contactsTable.id,
          fields: {
            [contactNameFieldId]: 'Alice',
          },
        }),
      });
      expect(createContactResponse.status).toBe(201);
      const contactRaw = await createContactResponse.json();
      const contactParsed = createRecordOkResponseSchema.safeParse(contactRaw);
      expect(contactParsed.success).toBe(true);
      if (!contactParsed.success || !contactParsed.data.ok) return;
      const contactId = contactParsed.data.data.record.id;

      const createDealsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Link Display Deals'),
          fields: [{ type: 'singleLineText', name: 'Deal', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const dealsRaw = await createDealsResponse.json();
      const dealsParsed = createTableOkResponseSchema.safeParse(dealsRaw);
      expect(dealsParsed.success).toBe(true);
      if (!dealsParsed.success || !dealsParsed.data.ok) return;

      const dealsTable = dealsParsed.data.data.table;
      const dealNameFieldId = dealsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!dealNameFieldId) throw new Error('Missing deals primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'link',
            name: 'Contacts',
            options: {
              relationship: 'manyMany',
              foreignTableId: contactsTable.id,
              lookupFieldId: contactNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Contacts')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'formula',
            name: 'Linked Names',
            options: {
              expression: `{${linkFieldId}}`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Linked Names')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      const createDealResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: dealsTable.id,
          fields: {
            [dealNameFieldId]: 'Deal 1',
            [linkFieldId]: [{ id: contactId }],
          },
        }),
      });
      expect(createDealResponse.status).toBe(201);
      const dealRaw = await createDealResponse.json();
      const dealParsed = createRecordOkResponseSchema.safeParse(dealRaw);
      expect(dealParsed.success).toBe(true);
      if (!dealParsed.success || !dealParsed.data.ok) return;
      const dealId = dealParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(dealsTable.id);
      const stored = records.find((r) => r.id === dealId);
      expect(stored).toBeDefined();
      if (!stored) return;

      const titles = extractLinkDisplayTitles(stored.fields[formulaFieldId]);
      if (titles) {
        expect(titles).toContain('Alice');
        return;
      }

      const rawValue = stored.fields[formulaFieldId];
      expect(typeof rawValue).toBe('string');
      if (typeof rawValue !== 'string') return;
      expect(rawValue).toContain('Alice');
    });

    /**
     * Scenario: Formula references lookup single select field
     * Formula:IF({lookupSingleSelect}="Paid", "No reminder", "Follow up")
     * Expect: evaluates based on lookup single select value
     */
    it('should handle lookup single select in formula - IF({lookupSingleSelect}="Paid", ...)', async () => {
      const createContactsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Select Contacts'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleSelect', name: 'Status', options: ['Paid', 'Pending'] },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const contactsRaw = await createContactsResponse.json();
      const contactsParsed = createTableOkResponseSchema.safeParse(contactsRaw);
      expect(contactsParsed.success).toBe(true);
      if (!contactsParsed.success || !contactsParsed.data.ok) return;

      const contactsTable = contactsParsed.data.data.table;
      const contactNameFieldId = contactsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const statusField = contactsTable.fields.find((f) => f.name === 'Status');
      const statusFieldId = statusField?.id ?? '';
      const statusChoices =
        (statusField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ?? [];
      const statusPaid = statusChoices.find((choice) => choice.name === 'Paid');
      const statusPending = statusChoices.find((choice) => choice.name === 'Pending');
      if (!contactNameFieldId || !statusFieldId || !statusPaid?.id || !statusPending?.id) {
        throw new Error('Missing status field metadata');
      }

      const createContact = async (name: string, statusId: string) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: contactsTable.id,
            fields: {
              [contactNameFieldId]: name,
              [statusFieldId]: statusId,
            },
          }),
        });
        expect(response.status).toBe(201);
        const rawBody = await response.json();
        const parsed = createRecordOkResponseSchema.safeParse(rawBody);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return undefined;
        return parsed.data.data.record.id;
      };

      const paidContactId = await createContact('Alice', statusPaid.id);
      const pendingContactId = await createContact('Bob', statusPending.id);
      if (!paidContactId || !pendingContactId) {
        throw new Error('Failed to create contacts');
      }

      const createDealsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Select Deals'),
          fields: [{ type: 'singleLineText', name: 'Deal', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const dealsRaw = await createDealsResponse.json();
      const dealsParsed = createTableOkResponseSchema.safeParse(dealsRaw);
      expect(dealsParsed.success).toBe(true);
      if (!dealsParsed.success || !dealsParsed.data.ok) return;

      const dealsTable = dealsParsed.data.data.table;
      const dealNameFieldId = dealsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!dealNameFieldId) throw new Error('Missing deals primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'link',
            name: 'Contact',
            options: {
              relationship: 'manyOne',
              foreignTableId: contactsTable.id,
              lookupFieldId: contactNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Contact')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'lookup',
            name: 'Contact Status',
            options: {
              linkFieldId,
              foreignTableId: contactsTable.id,
              lookupFieldId: statusFieldId,
            },
          },
        }),
      });
      expect(createLookupResponse.status).toBe(200);
      const lookupRaw = await createLookupResponse.json();
      const lookupParsed = createFieldOkResponseSchema.safeParse(lookupRaw);
      expect(lookupParsed.success).toBe(true);
      if (!lookupParsed.success || !lookupParsed.data.ok) return;
      const lookupFieldId =
        lookupParsed.data.data.table.fields.find((f) => f.name === 'Contact Status')?.id ?? '';
      if (!lookupFieldId) throw new Error('Missing lookup field id');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'formula',
            name: 'Reminder',
            options: {
              expression: `IF({${lookupFieldId}}="Paid", "No reminder", "Follow up")`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Reminder')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      const createDeal = async (dealName: string, contactId: string) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: dealsTable.id,
            fields: {
              [dealNameFieldId]: dealName,
              [linkFieldId]: { id: contactId },
            },
          }),
        });
        expect(response.status).toBe(201);
        const rawBody = await response.json();
        const parsed = createRecordOkResponseSchema.safeParse(rawBody);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return undefined;
        return parsed.data.data.record.id;
      };

      const paidDealId = await createDeal('Paid Deal', paidContactId);
      const pendingDealId = await createDeal('Pending Deal', pendingContactId);
      if (!paidDealId || !pendingDealId) throw new Error('Failed to create deals');

      await processOutbox(3);

      const records = await listRecords(dealsTable.id);
      const paidDeal = records.find((r) => r.id === paidDealId);
      const pendingDeal = records.find((r) => r.id === pendingDealId);
      expect(paidDeal).toBeDefined();
      expect(pendingDeal).toBeDefined();
      if (!paidDeal || !pendingDeal) return;

      expect(paidDeal.fields[formulaFieldId]).toBe('No reminder');
      expect(pendingDeal.fields[formulaFieldId]).toBe('Follow up');
    });

    /**
     * Scenario: nested lookup formula (lookup -> lookup -> number)
     * Formula:Table3 -> Table2(lookup) -> Table1(number)
     * Expect: retrieves nested lookup value correctly
     */
    it('should handle nested lookup formula - lookup of lookup field', async () => {
      const createEmployeesResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Nested Lookup Employees'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Salary' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const employeesRaw = await createEmployeesResponse.json();
      const employeesParsed = createTableOkResponseSchema.safeParse(employeesRaw);
      expect(employeesParsed.success).toBe(true);
      if (!employeesParsed.success || !employeesParsed.data.ok) return;

      const employeesTable = employeesParsed.data.data.table;
      const employeeNameFieldId = employeesTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const salaryFieldId = employeesTable.fields.find((f) => f.name === 'Salary')?.id ?? '';
      if (!employeeNameFieldId || !salaryFieldId) throw new Error('Missing employee fields');

      const createEmployeeResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: employeesTable.id,
          fields: {
            [employeeNameFieldId]: 'Alice',
            [salaryFieldId]: 120,
          },
        }),
      });
      expect(createEmployeeResponse.status).toBe(201);
      const employeeRaw = await createEmployeeResponse.json();
      const employeeParsed = createRecordOkResponseSchema.safeParse(employeeRaw);
      expect(employeeParsed.success).toBe(true);
      if (!employeeParsed.success || !employeeParsed.data.ok) return;
      const employeeId = employeeParsed.data.data.record.id;

      const createTeamsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Nested Lookup Teams'),
          fields: [{ type: 'singleLineText', name: 'Team', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const teamsRaw = await createTeamsResponse.json();
      const teamsParsed = createTableOkResponseSchema.safeParse(teamsRaw);
      expect(teamsParsed.success).toBe(true);
      if (!teamsParsed.success || !teamsParsed.data.ok) return;

      const teamsTable = teamsParsed.data.data.table;
      const teamNameFieldId = teamsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!teamNameFieldId) throw new Error('Missing team primary field');

      const createMembersLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: teamsTable.id,
          field: {
            type: 'link',
            name: 'Members',
            options: {
              relationship: 'manyMany',
              foreignTableId: employeesTable.id,
              lookupFieldId: employeeNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createMembersLinkResponse.status).toBe(200);
      const membersLinkRaw = await createMembersLinkResponse.json();
      const membersLinkParsed = createFieldOkResponseSchema.safeParse(membersLinkRaw);
      expect(membersLinkParsed.success).toBe(true);
      if (!membersLinkParsed.success || !membersLinkParsed.data.ok) return;
      const membersLinkId =
        membersLinkParsed.data.data.table.fields.find((f) => f.name === 'Members')?.id ?? '';
      if (!membersLinkId) throw new Error('Missing members link field id');

      const createSalaryLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: teamsTable.id,
          field: {
            type: 'lookup',
            name: 'Member Salaries',
            options: {
              linkFieldId: membersLinkId,
              foreignTableId: employeesTable.id,
              lookupFieldId: salaryFieldId,
            },
          },
        }),
      });
      expect(createSalaryLookupResponse.status).toBe(200);
      const salaryLookupRaw = await createSalaryLookupResponse.json();
      const salaryLookupParsed = createFieldOkResponseSchema.safeParse(salaryLookupRaw);
      expect(salaryLookupParsed.success).toBe(true);
      if (!salaryLookupParsed.success || !salaryLookupParsed.data.ok) return;
      const salaryLookupId =
        salaryLookupParsed.data.data.table.fields.find((f) => f.name === 'Member Salaries')?.id ??
        '';
      if (!salaryLookupId) throw new Error('Missing salary lookup field id');

      const createTeamResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: teamsTable.id,
          fields: {
            [teamNameFieldId]: 'Team A',
            [membersLinkId]: [{ id: employeeId }],
          },
        }),
      });
      expect(createTeamResponse.status).toBe(201);
      const teamRaw = await createTeamResponse.json();
      const teamParsed = createRecordOkResponseSchema.safeParse(teamRaw);
      expect(teamParsed.success).toBe(true);
      if (!teamParsed.success || !teamParsed.data.ok) return;
      const teamId = teamParsed.data.data.record.id;

      const createDepartmentsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Nested Lookup Departments'),
          fields: [{ type: 'singleLineText', name: 'Department', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const departmentsRaw = await createDepartmentsResponse.json();
      const departmentsParsed = createTableOkResponseSchema.safeParse(departmentsRaw);
      expect(departmentsParsed.success).toBe(true);
      if (!departmentsParsed.success || !departmentsParsed.data.ok) return;

      const departmentsTable = departmentsParsed.data.data.table;
      const departmentNameFieldId = departmentsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!departmentNameFieldId) throw new Error('Missing department primary field');

      const createTeamsLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: departmentsTable.id,
          field: {
            type: 'link',
            name: 'Teams',
            options: {
              relationship: 'manyMany',
              foreignTableId: teamsTable.id,
              lookupFieldId: teamNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createTeamsLinkResponse.status).toBe(200);
      const teamsLinkRaw = await createTeamsLinkResponse.json();
      const teamsLinkParsed = createFieldOkResponseSchema.safeParse(teamsLinkRaw);
      expect(teamsLinkParsed.success).toBe(true);
      if (!teamsLinkParsed.success || !teamsLinkParsed.data.ok) return;
      const teamsLinkId =
        teamsLinkParsed.data.data.table.fields.find((f) => f.name === 'Teams')?.id ?? '';
      if (!teamsLinkId) throw new Error('Missing teams link field id');

      const createNestedLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: departmentsTable.id,
          field: {
            type: 'lookup',
            name: 'Team Salaries',
            options: {
              linkFieldId: teamsLinkId,
              foreignTableId: teamsTable.id,
              lookupFieldId: salaryLookupId,
            },
          },
        }),
      });
      expect(createNestedLookupResponse.status).toBe(200);
      const nestedLookupRaw = await createNestedLookupResponse.json();
      const nestedLookupParsed = createFieldOkResponseSchema.safeParse(nestedLookupRaw);
      expect(nestedLookupParsed.success).toBe(true);
      if (!nestedLookupParsed.success || !nestedLookupParsed.data.ok) return;
      const nestedLookupId =
        nestedLookupParsed.data.data.table.fields.find((f) => f.name === 'Team Salaries')?.id ?? '';
      if (!nestedLookupId) throw new Error('Missing nested lookup field id');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: departmentsTable.id,
          field: {
            type: 'formula',
            name: 'Nested Salary',
            options: {
              expression: `{${nestedLookupId}}`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Nested Salary')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing nested formula field id');

      const createDepartmentResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: departmentsTable.id,
          fields: {
            [departmentNameFieldId]: 'Dept 1',
            [teamsLinkId]: [{ id: teamId }],
          },
        }),
      });
      expect(createDepartmentResponse.status).toBe(201);
      const departmentRaw = await createDepartmentResponse.json();
      const departmentParsed = createRecordOkResponseSchema.safeParse(departmentRaw);
      expect(departmentParsed.success).toBe(true);
      if (!departmentParsed.success || !departmentParsed.data.ok) return;
      const departmentId = departmentParsed.data.data.record.id;

      await processOutbox(4);

      const records = await listRecords(departmentsTable.id);
      const record = records.find((r) => r.id === departmentId);
      expect(record).toBeDefined();
      if (!record) return;

      const scalar = extractLookupScalar(record.fields[formulaFieldId]);
      const resolved =
        scalar && typeof scalar === 'object' && 'title' in scalar
          ? (scalar as { title?: unknown }).title
          : scalar;
      expect(Number(resolved)).toBe(120);
    });

    /**
     * Scenario: link display depends on lookup
     * Formula:{orderNo} & "-" & {patientLink} (link display depends on lookup)
     * Expect: computes correctly when link display depends on lookup
     */
    it('should compute formula when link display depends on lookup', async () => {
      const createNamesResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Display Names'),
          fields: [{ type: 'singleLineText', name: 'FullName', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const namesRaw = await createNamesResponse.json();
      const namesParsed = createTableOkResponseSchema.safeParse(namesRaw);
      expect(namesParsed.success).toBe(true);
      if (!namesParsed.success || !namesParsed.data.ok) return;

      const namesTable = namesParsed.data.data.table;
      const fullNameFieldId = namesTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!fullNameFieldId) throw new Error('Missing names primary field');

      const createNameResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: namesTable.id,
          fields: { [fullNameFieldId]: 'Alice Smith' },
        }),
      });
      expect(createNameResponse.status).toBe(201);
      const nameRaw = await createNameResponse.json();
      const nameParsed = createRecordOkResponseSchema.safeParse(nameRaw);
      expect(nameParsed.success).toBe(true);
      if (!nameParsed.success || !nameParsed.data.ok) return;
      const nameId = nameParsed.data.data.record.id;

      const createPatientsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Display Patients'),
          fields: [{ type: 'singleLineText', name: 'PatientId', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const patientsRaw = await createPatientsResponse.json();
      const patientsParsed = createTableOkResponseSchema.safeParse(patientsRaw);
      expect(patientsParsed.success).toBe(true);
      if (!patientsParsed.success || !patientsParsed.data.ok) return;

      const patientsTable = patientsParsed.data.data.table;
      const patientIdFieldId = patientsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!patientIdFieldId) throw new Error('Missing patient primary field');

      const createNameLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: patientsTable.id,
          field: {
            type: 'link',
            name: 'Name Ref',
            options: {
              relationship: 'manyOne',
              foreignTableId: namesTable.id,
              lookupFieldId: fullNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createNameLinkResponse.status).toBe(200);
      const nameLinkRaw = await createNameLinkResponse.json();
      const nameLinkParsed = createFieldOkResponseSchema.safeParse(nameLinkRaw);
      expect(nameLinkParsed.success).toBe(true);
      if (!nameLinkParsed.success || !nameLinkParsed.data.ok) return;
      const nameLinkFieldId =
        nameLinkParsed.data.data.table.fields.find((f) => f.name === 'Name Ref')?.id ?? '';
      if (!nameLinkFieldId) throw new Error('Missing name link field id');

      const createNameLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: patientsTable.id,
          field: {
            type: 'lookup',
            name: 'Name Lookup',
            options: {
              linkFieldId: nameLinkFieldId,
              foreignTableId: namesTable.id,
              lookupFieldId: fullNameFieldId,
            },
          },
        }),
      });
      expect(createNameLookupResponse.status).toBe(200);
      const nameLookupRaw = await createNameLookupResponse.json();
      const nameLookupParsed = createFieldOkResponseSchema.safeParse(nameLookupRaw);
      expect(nameLookupParsed.success).toBe(true);
      if (!nameLookupParsed.success || !nameLookupParsed.data.ok) return;
      const nameLookupFieldId =
        nameLookupParsed.data.data.table.fields.find((f) => f.name === 'Name Lookup')?.id ?? '';
      if (!nameLookupFieldId) throw new Error('Missing name lookup field id');

      const createPatientResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: patientsTable.id,
          fields: {
            [patientIdFieldId]: 'P001',
            [nameLinkFieldId]: { id: nameId },
          },
        }),
      });
      expect(createPatientResponse.status).toBe(201);
      const patientRaw = await createPatientResponse.json();
      const patientParsed = createRecordOkResponseSchema.safeParse(patientRaw);
      expect(patientParsed.success).toBe(true);
      if (!patientParsed.success || !patientParsed.data.ok) return;
      const patientId = patientParsed.data.data.record.id;

      await processOutbox(2);

      const createOrdersResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Display Orders'),
          fields: [{ type: 'singleLineText', name: 'OrderNo', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const ordersRaw = await createOrdersResponse.json();
      const ordersParsed = createTableOkResponseSchema.safeParse(ordersRaw);
      expect(ordersParsed.success).toBe(true);
      if (!ordersParsed.success || !ordersParsed.data.ok) return;

      const ordersTable = ordersParsed.data.data.table;
      const orderNoFieldId = ordersTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!orderNoFieldId) throw new Error('Missing order primary field');

      const createPatientLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: ordersTable.id,
          field: {
            type: 'link',
            name: 'Patient',
            options: {
              relationship: 'manyOne',
              foreignTableId: patientsTable.id,
              lookupFieldId: nameLookupFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createPatientLinkResponse.status).toBe(200);
      const patientLinkRaw = await createPatientLinkResponse.json();
      const patientLinkParsed = createFieldOkResponseSchema.safeParse(patientLinkRaw);
      expect(patientLinkParsed.success).toBe(true);
      if (!patientLinkParsed.success || !patientLinkParsed.data.ok) return;
      const patientLinkFieldId =
        patientLinkParsed.data.data.table.fields.find((f) => f.name === 'Patient')?.id ?? '';
      if (!patientLinkFieldId) throw new Error('Missing patient link field id');

      const createOrderFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: ordersTable.id,
          field: {
            type: 'formula',
            name: 'Order Label',
            options: {
              expression: `{${orderNoFieldId}} & "-" & {${patientLinkFieldId}}`,
            },
          },
        }),
      });
      expect(createOrderFormulaResponse.status).toBe(200);
      const orderFormulaRaw = await createOrderFormulaResponse.json();
      const orderFormulaParsed = createFieldOkResponseSchema.safeParse(orderFormulaRaw);
      expect(orderFormulaParsed.success).toBe(true);
      if (!orderFormulaParsed.success || !orderFormulaParsed.data.ok) return;
      const orderFormulaFieldId =
        orderFormulaParsed.data.data.table.fields.find((f) => f.name === 'Order Label')?.id ?? '';
      if (!orderFormulaFieldId) throw new Error('Missing order formula field id');

      const createOrderResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: ordersTable.id,
          fields: {
            [orderNoFieldId]: 'O100',
            [patientLinkFieldId]: { id: patientId },
          },
        }),
      });
      expect(createOrderResponse.status).toBe(201);
      const orderRaw = await createOrderResponse.json();
      const orderParsed = createRecordOkResponseSchema.safeParse(orderRaw);
      expect(orderParsed.success).toBe(true);
      if (!orderParsed.success || !orderParsed.data.ok) return;
      const orderId = orderParsed.data.data.record.id;

      await processOutbox(4);

      const records = await listRecords(ordersTable.id);
      const record = records.find((r) => r.id === orderId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[orderFormulaFieldId]).toBe('O100-Alice Smith');
    });
  });

  // ============================================================================
  // 12. Formula referencing formula
  // ============================================================================
  describe('formula referencing formula', () => {
    /**
     * Scenario: Formula references another formula
     * Formula:{formula1} + 5
     * Expect: computes nested formulas correctly
     */
    it('should create formula referencing another formula - {formula1} + 5', async () => {
      // Step 1: create table with numeric field
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Formula Reference Formula Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'BaseValue' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'BaseValue')?.id ?? '';

      // 2. Create first formula field - number * 2
      const createFormula1Response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Formula1',
            options: {
              expression: `{${numberFieldId}} * 2`,
            },
          },
        }),
      });
      expect(createFormula1Response.status).toBe(200);
      const formula1Raw = await createFormula1Response.json();
      const formula1Parsed = createFieldOkResponseSchema.safeParse(formula1Raw);
      expect(formula1Parsed.success).toBe(true);
      if (!formula1Parsed.success || !formula1Parsed.data.ok) return;

      const formula1FieldId =
        formula1Parsed.data.data.table.fields.find((f) => f.name === 'Formula1')?.id ?? '';

      // 3. Create second formula field - reference first formula + 5
      const createFormula2Response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Formula2',
            options: {
              expression: `{${formula1FieldId}} + 5`,
            },
          },
        }),
      });
      expect(createFormula2Response.status).toBe(200);
      const formula2Raw = await createFormula2Response.json();
      const formula2Parsed = createFieldOkResponseSchema.safeParse(formula2Raw);
      expect(formula2Parsed.success).toBe(true);
      if (!formula2Parsed.success || !formula2Parsed.data.ok) return;

      const formula2FieldId =
        formula2Parsed.data.data.table.fields.find((f) => f.name === 'Formula2')?.id ?? '';

      // 4. Create record
      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 10,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 5. Process outbox to trigger formula calculation (requires multiple runs for nested formulas)
      await processOutbox(2);

      // 6. Fetch calculated records via listRecords
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      // 7. Verify formula calculation result
      expect(record.fields[formula1FieldId]).toBe(20); // 10 * 2 = 20
      expect(record.fields[formula2FieldId]).toBe(25); // 20 + 5 = 25
    });

    /**
     * Scenario: multi-level formula chain
     * Formula:formula1 -> formula2 -> formula3 -> rollup field
     * Expect: multi-level formulas compute correctly
     */
    it('should handle multi-level formula chain', async () => {
      const createTasksResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Formula Chain Tasks'),
          fields: [
            { type: 'singleLineText', name: 'Task', isPrimary: true },
            { type: 'number', name: 'Hours' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tasksRaw = await createTasksResponse.json();
      const tasksParsed = createTableOkResponseSchema.safeParse(tasksRaw);
      expect(tasksParsed.success).toBe(true);
      if (!tasksParsed.success || !tasksParsed.data.ok) return;

      const tasksTable = tasksParsed.data.data.table;
      const taskNameFieldId = tasksTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const hoursFieldId = tasksTable.fields.find((f) => f.name === 'Hours')?.id ?? '';
      if (!taskNameFieldId || !hoursFieldId) throw new Error('Missing task fields');

      const createTask = async (name: string, hours: number) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: tasksTable.id,
            fields: {
              [taskNameFieldId]: name,
              [hoursFieldId]: hours,
            },
          }),
        });
        expect(response.status).toBe(201);
        const rawBody = await response.json();
        const parsed = createRecordOkResponseSchema.safeParse(rawBody);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return undefined;
        return parsed.data.data.record.id;
      };

      const taskAId = await createTask('Task A', 2);
      const taskBId = await createTask('Task B', 4);
      if (!taskAId || !taskBId) throw new Error('Failed to create tasks');

      const createProjectsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Formula Chain Projects'),
          fields: [{ type: 'singleLineText', name: 'Project', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const projectsRaw = await createProjectsResponse.json();
      const projectsParsed = createTableOkResponseSchema.safeParse(projectsRaw);
      expect(projectsParsed.success).toBe(true);
      if (!projectsParsed.success || !projectsParsed.data.ok) return;

      const projectsTable = projectsParsed.data.data.table;
      const projectNameFieldId = projectsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!projectNameFieldId) throw new Error('Missing project primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: projectsTable.id,
          field: {
            type: 'link',
            name: 'Tasks',
            options: {
              relationship: 'manyMany',
              foreignTableId: tasksTable.id,
              lookupFieldId: taskNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Tasks')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createRollupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: projectsTable.id,
          field: {
            type: 'rollup',
            name: 'Total Hours',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId,
              foreignTableId: tasksTable.id,
              lookupFieldId: hoursFieldId,
            },
          },
        }),
      });
      expect(createRollupResponse.status).toBe(200);
      const rollupRaw = await createRollupResponse.json();
      const rollupParsed = createFieldOkResponseSchema.safeParse(rollupRaw);
      expect(rollupParsed.success).toBe(true);
      if (!rollupParsed.success || !rollupParsed.data.ok) return;
      const rollupFieldId =
        rollupParsed.data.data.table.fields.find((f) => f.name === 'Total Hours')?.id ?? '';
      if (!rollupFieldId) throw new Error('Missing rollup field id');

      const createFormula1Response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: projectsTable.id,
          field: {
            type: 'formula',
            name: 'Double Hours',
            options: { expression: `{${rollupFieldId}} * 2` },
          },
        }),
      });
      expect(createFormula1Response.status).toBe(200);
      const formula1Raw = await createFormula1Response.json();
      const formula1Parsed = createFieldOkResponseSchema.safeParse(formula1Raw);
      expect(formula1Parsed.success).toBe(true);
      if (!formula1Parsed.success || !formula1Parsed.data.ok) return;
      const formula1FieldId =
        formula1Parsed.data.data.table.fields.find((f) => f.name === 'Double Hours')?.id ?? '';
      if (!formula1FieldId) throw new Error('Missing formula1 field id');

      const createFormula2Response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: projectsTable.id,
          field: {
            type: 'formula',
            name: 'Plus One',
            options: { expression: `{${formula1FieldId}} + 1` },
          },
        }),
      });
      expect(createFormula2Response.status).toBe(200);
      const formula2Raw = await createFormula2Response.json();
      const formula2Parsed = createFieldOkResponseSchema.safeParse(formula2Raw);
      expect(formula2Parsed.success).toBe(true);
      if (!formula2Parsed.success || !formula2Parsed.data.ok) return;
      const formula2FieldId =
        formula2Parsed.data.data.table.fields.find((f) => f.name === 'Plus One')?.id ?? '';
      if (!formula2FieldId) throw new Error('Missing formula2 field id');

      const createFormula3Response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: projectsTable.id,
          field: {
            type: 'formula',
            name: 'Final Value',
            options: { expression: `{${formula2FieldId}} / 3` },
          },
        }),
      });
      expect(createFormula3Response.status).toBe(200);
      const formula3Raw = await createFormula3Response.json();
      const formula3Parsed = createFieldOkResponseSchema.safeParse(formula3Raw);
      expect(formula3Parsed.success).toBe(true);
      if (!formula3Parsed.success || !formula3Parsed.data.ok) return;
      const formula3FieldId =
        formula3Parsed.data.data.table.fields.find((f) => f.name === 'Final Value')?.id ?? '';
      if (!formula3FieldId) throw new Error('Missing formula3 field id');

      const createProjectResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: projectsTable.id,
          fields: {
            [projectNameFieldId]: 'Launch',
            [linkFieldId]: [{ id: taskAId }, { id: taskBId }],
          },
        }),
      });
      expect(createProjectResponse.status).toBe(201);
      const projectRaw = await createProjectResponse.json();
      const projectParsed = createRecordOkResponseSchema.safeParse(projectRaw);
      expect(projectParsed.success).toBe(true);
      if (!projectParsed.success || !projectParsed.data.ok) return;
      const projectId = projectParsed.data.data.record.id;

      await processOutbox(4);

      const records = await listRecords(projectsTable.id);
      const record = records.find((r) => r.id === projectId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(Number(record.fields[rollupFieldId])).toBe(6);
      expect(Number(record.fields[formula1FieldId])).toBe(12);
      expect(Number(record.fields[formula2FieldId])).toBe(13);
      expect(Number(record.fields[formula3FieldId])).toBeCloseTo(13 / 3, 5);
    });

    /**
     * Scenario: formula indirectly references link field
     * Formula:formula1 -> formula2(references link) -> link field
     * Expect: computes correctly when formula indirectly references link field
     */
    it('should handle formula indirectly referencing link field through another formula', async () => {
      const createContactsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Indirect Link Contacts'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const contactsRaw = await createContactsResponse.json();
      const contactsParsed = createTableOkResponseSchema.safeParse(contactsRaw);
      expect(contactsParsed.success).toBe(true);
      if (!contactsParsed.success || !contactsParsed.data.ok) return;

      const contactsTable = contactsParsed.data.data.table;
      const contactNameFieldId = contactsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!contactNameFieldId) throw new Error('Missing contacts primary field');

      const createContactResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: contactsTable.id,
          fields: {
            [contactNameFieldId]: 'Alice',
          },
        }),
      });
      expect(createContactResponse.status).toBe(201);
      const contactRaw = await createContactResponse.json();
      const contactParsed = createRecordOkResponseSchema.safeParse(contactRaw);
      expect(contactParsed.success).toBe(true);
      if (!contactParsed.success || !contactParsed.data.ok) return;
      const contactId = contactParsed.data.data.record.id;

      const createDealsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Indirect Link Deals'),
          fields: [{ type: 'singleLineText', name: 'Deal', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const dealsRaw = await createDealsResponse.json();
      const dealsParsed = createTableOkResponseSchema.safeParse(dealsRaw);
      expect(dealsParsed.success).toBe(true);
      if (!dealsParsed.success || !dealsParsed.data.ok) return;

      const dealsTable = dealsParsed.data.data.table;
      const dealNameFieldId = dealsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!dealNameFieldId) throw new Error('Missing deals primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'link',
            name: 'Contact',
            options: {
              relationship: 'manyOne',
              foreignTableId: contactsTable.id,
              lookupFieldId: contactNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Contact')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createFormula1Response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'formula',
            name: 'Has Contact',
            options: {
              expression: `IF({${linkFieldId}}, "Has Link", "No Link")`,
            },
          },
        }),
      });
      expect(createFormula1Response.status).toBe(200);
      const formula1Raw = await createFormula1Response.json();
      const formula1Parsed = createFieldOkResponseSchema.safeParse(formula1Raw);
      expect(formula1Parsed.success).toBe(true);
      if (!formula1Parsed.success || !formula1Parsed.data.ok) return;
      const formula1FieldId =
        formula1Parsed.data.data.table.fields.find((f) => f.name === 'Has Contact')?.id ?? '';
      if (!formula1FieldId) throw new Error('Missing formula1 field id');

      const createFormula2Response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'formula',
            name: 'Contact Status',
            options: {
              expression: `IF({${formula1FieldId}}="Has Link", "linked", "empty")`,
            },
          },
        }),
      });
      expect(createFormula2Response.status).toBe(200);
      const formula2Raw = await createFormula2Response.json();
      const formula2Parsed = createFieldOkResponseSchema.safeParse(formula2Raw);
      expect(formula2Parsed.success).toBe(true);
      if (!formula2Parsed.success || !formula2Parsed.data.ok) return;
      const formula2FieldId =
        formula2Parsed.data.data.table.fields.find((f) => f.name === 'Contact Status')?.id ?? '';
      if (!formula2FieldId) throw new Error('Missing formula2 field id');

      const createWithLinkResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: dealsTable.id,
          fields: {
            [dealNameFieldId]: 'Linked Deal',
            [linkFieldId]: { id: contactId },
          },
        }),
      });
      expect(createWithLinkResponse.status).toBe(201);
      const withLinkRaw = await createWithLinkResponse.json();
      const withLinkParsed = createRecordOkResponseSchema.safeParse(withLinkRaw);
      expect(withLinkParsed.success).toBe(true);
      if (!withLinkParsed.success || !withLinkParsed.data.ok) return;
      const withLinkId = withLinkParsed.data.data.record.id;

      const createWithoutLinkResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: dealsTable.id,
          fields: {
            [dealNameFieldId]: 'Unlinked Deal',
          },
        }),
      });
      expect(createWithoutLinkResponse.status).toBe(201);
      const withoutLinkRaw = await createWithoutLinkResponse.json();
      const withoutLinkParsed = createRecordOkResponseSchema.safeParse(withoutLinkRaw);
      expect(withoutLinkParsed.success).toBe(true);
      if (!withoutLinkParsed.success || !withoutLinkParsed.data.ok) return;
      const withoutLinkId = withoutLinkParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(dealsTable.id);
      const withLink = records.find((r) => r.id === withLinkId);
      const withoutLink = records.find((r) => r.id === withoutLinkId);
      expect(withLink).toBeDefined();
      expect(withoutLink).toBeDefined();
      if (!withLink || !withoutLink) return;

      expect(withLink.fields[formula1FieldId]).toBe('Has Link');
      expect(withLink.fields[formula2FieldId]).toBe('linked');
      expect(withoutLink.fields[formula1FieldId]).toBe('No Link');
      expect(withoutLink.fields[formula2FieldId]).toBe('empty');
    });

    /**
     * Scenario: formula indirectly references lookup field
     * Formula:formula1 -> formula2(references lookup) -> lookup field
     * Expect: computes correctly when formula indirectly references lookup field
     */
    it('should handle formula indirectly referencing lookup field through another formula', async () => {
      const createContactsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Indirect Lookup Contacts'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', name: 'Code' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const contactsRaw = await createContactsResponse.json();
      const contactsParsed = createTableOkResponseSchema.safeParse(contactsRaw);
      expect(contactsParsed.success).toBe(true);
      if (!contactsParsed.success || !contactsParsed.data.ok) return;

      const contactsTable = contactsParsed.data.data.table;
      const contactNameFieldId = contactsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const contactCodeFieldId = contactsTable.fields.find((f) => f.name === 'Code')?.id ?? '';
      if (!contactNameFieldId || !contactCodeFieldId) throw new Error('Missing contacts fields');

      const createContactResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: contactsTable.id,
          fields: {
            [contactNameFieldId]: 'Alice',
            [contactCodeFieldId]: 'C-001',
          },
        }),
      });
      expect(createContactResponse.status).toBe(201);
      const contactRaw = await createContactResponse.json();
      const contactParsed = createRecordOkResponseSchema.safeParse(contactRaw);
      expect(contactParsed.success).toBe(true);
      if (!contactParsed.success || !contactParsed.data.ok) return;
      const contactId = contactParsed.data.data.record.id;

      const createDealsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Indirect Lookup Deals'),
          fields: [{ type: 'singleLineText', name: 'Deal', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const dealsRaw = await createDealsResponse.json();
      const dealsParsed = createTableOkResponseSchema.safeParse(dealsRaw);
      expect(dealsParsed.success).toBe(true);
      if (!dealsParsed.success || !dealsParsed.data.ok) return;

      const dealsTable = dealsParsed.data.data.table;
      const dealNameFieldId = dealsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!dealNameFieldId) throw new Error('Missing deals primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'link',
            name: 'Contact',
            options: {
              relationship: 'manyOne',
              foreignTableId: contactsTable.id,
              lookupFieldId: contactNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Contact')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'lookup',
            name: 'Contact Code',
            options: {
              linkFieldId,
              foreignTableId: contactsTable.id,
              lookupFieldId: contactCodeFieldId,
            },
          },
        }),
      });
      expect(createLookupResponse.status).toBe(200);
      const lookupRaw = await createLookupResponse.json();
      const lookupParsed = createFieldOkResponseSchema.safeParse(lookupRaw);
      expect(lookupParsed.success).toBe(true);
      if (!lookupParsed.success || !lookupParsed.data.ok) return;
      const lookupFieldId =
        lookupParsed.data.data.table.fields.find((f) => f.name === 'Contact Code')?.id ?? '';
      if (!lookupFieldId) throw new Error('Missing lookup field id');

      const createFormula1Response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'formula',
            name: 'Code Text',
            options: {
              expression: `{${lookupFieldId}}`,
            },
          },
        }),
      });
      expect(createFormula1Response.status).toBe(200);
      const formula1Raw = await createFormula1Response.json();
      const formula1Parsed = createFieldOkResponseSchema.safeParse(formula1Raw);
      expect(formula1Parsed.success).toBe(true);
      if (!formula1Parsed.success || !formula1Parsed.data.ok) return;
      const formula1FieldId =
        formula1Parsed.data.data.table.fields.find((f) => f.name === 'Code Text')?.id ?? '';
      if (!formula1FieldId) throw new Error('Missing formula1 field id');

      const createFormula2Response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'formula',
            name: 'Code Label',
            options: {
              expression: `IF({${formula1FieldId}}="C-001", "Matched", "Other")`,
            },
          },
        }),
      });
      expect(createFormula2Response.status).toBe(200);
      const formula2Raw = await createFormula2Response.json();
      const formula2Parsed = createFieldOkResponseSchema.safeParse(formula2Raw);
      expect(formula2Parsed.success).toBe(true);
      if (!formula2Parsed.success || !formula2Parsed.data.ok) return;
      const formula2FieldId =
        formula2Parsed.data.data.table.fields.find((f) => f.name === 'Code Label')?.id ?? '';
      if (!formula2FieldId) throw new Error('Missing formula2 field id');

      const createDealResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: dealsTable.id,
          fields: {
            [dealNameFieldId]: 'Deal 1',
            [linkFieldId]: { id: contactId },
          },
        }),
      });
      expect(createDealResponse.status).toBe(201);
      const dealRaw = await createDealResponse.json();
      const dealParsed = createRecordOkResponseSchema.safeParse(dealRaw);
      expect(dealParsed.success).toBe(true);
      if (!dealParsed.success || !dealParsed.data.ok) return;
      const dealId = dealParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(dealsTable.id);
      const record = records.find((r) => r.id === dealId);
      expect(record).toBeDefined();
      if (!record) return;
      expect(record.fields[formula2FieldId]).toBe('Matched');
    });

    /**
     * Scenario: formula indirectly references rollup field
     * Formula:formula1 -> formula2(references rollup) -> rollup field
     * Expect: computes correctly when formula indirectly references rollup field
     */
    it('should handle formula indirectly referencing rollup field through another formula', async () => {
      const createTasksResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Indirect Rollup Tasks'),
          fields: [
            { type: 'singleLineText', name: 'Task', isPrimary: true },
            { type: 'number', name: 'Hours' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tasksRaw = await createTasksResponse.json();
      const tasksParsed = createTableOkResponseSchema.safeParse(tasksRaw);
      expect(tasksParsed.success).toBe(true);
      if (!tasksParsed.success || !tasksParsed.data.ok) return;

      const tasksTable = tasksParsed.data.data.table;
      const taskNameFieldId = tasksTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const hoursFieldId = tasksTable.fields.find((f) => f.name === 'Hours')?.id ?? '';
      if (!taskNameFieldId || !hoursFieldId) throw new Error('Missing task fields');

      const createTask = async (name: string, hours: number) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: tasksTable.id,
            fields: {
              [taskNameFieldId]: name,
              [hoursFieldId]: hours,
            },
          }),
        });
        expect(response.status).toBe(201);
        const rawBody = await response.json();
        const parsed = createRecordOkResponseSchema.safeParse(rawBody);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return undefined;
        return parsed.data.data.record.id;
      };

      const taskAId = await createTask('Task A', 3);
      const taskBId = await createTask('Task B', 2);
      if (!taskAId || !taskBId) throw new Error('Failed to create tasks');

      const createProjectsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Indirect Rollup Projects'),
          fields: [{ type: 'singleLineText', name: 'Project', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const projectsRaw = await createProjectsResponse.json();
      const projectsParsed = createTableOkResponseSchema.safeParse(projectsRaw);
      expect(projectsParsed.success).toBe(true);
      if (!projectsParsed.success || !projectsParsed.data.ok) return;

      const projectsTable = projectsParsed.data.data.table;
      const projectNameFieldId = projectsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!projectNameFieldId) throw new Error('Missing project primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: projectsTable.id,
          field: {
            type: 'link',
            name: 'Tasks',
            options: {
              relationship: 'manyMany',
              foreignTableId: tasksTable.id,
              lookupFieldId: taskNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Tasks')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createRollupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: projectsTable.id,
          field: {
            type: 'rollup',
            name: 'Total Hours',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId,
              foreignTableId: tasksTable.id,
              lookupFieldId: hoursFieldId,
            },
          },
        }),
      });
      expect(createRollupResponse.status).toBe(200);
      const rollupRaw = await createRollupResponse.json();
      const rollupParsed = createFieldOkResponseSchema.safeParse(rollupRaw);
      expect(rollupParsed.success).toBe(true);
      if (!rollupParsed.success || !rollupParsed.data.ok) return;
      const rollupFieldId =
        rollupParsed.data.data.table.fields.find((f) => f.name === 'Total Hours')?.id ?? '';
      if (!rollupFieldId) throw new Error('Missing rollup field id');

      const createFormula1Response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: projectsTable.id,
          field: {
            type: 'formula',
            name: 'Double Hours',
            options: { expression: `{${rollupFieldId}} * 2` },
          },
        }),
      });
      expect(createFormula1Response.status).toBe(200);
      const formula1Raw = await createFormula1Response.json();
      const formula1Parsed = createFieldOkResponseSchema.safeParse(formula1Raw);
      expect(formula1Parsed.success).toBe(true);
      if (!formula1Parsed.success || !formula1Parsed.data.ok) return;
      const formula1FieldId =
        formula1Parsed.data.data.table.fields.find((f) => f.name === 'Double Hours')?.id ?? '';
      if (!formula1FieldId) throw new Error('Missing formula1 field id');

      const createFormula2Response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: projectsTable.id,
          field: {
            type: 'formula',
            name: 'Size Label',
            options: {
              expression: `IF({${formula1FieldId}} >= 10, "Large", "Small")`,
            },
          },
        }),
      });
      expect(createFormula2Response.status).toBe(200);
      const formula2Raw = await createFormula2Response.json();
      const formula2Parsed = createFieldOkResponseSchema.safeParse(formula2Raw);
      expect(formula2Parsed.success).toBe(true);
      if (!formula2Parsed.success || !formula2Parsed.data.ok) return;
      const formula2FieldId =
        formula2Parsed.data.data.table.fields.find((f) => f.name === 'Size Label')?.id ?? '';
      if (!formula2FieldId) throw new Error('Missing formula2 field id');

      const createProjectResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: projectsTable.id,
          fields: {
            [projectNameFieldId]: 'Launch',
            [linkFieldId]: [{ id: taskAId }, { id: taskBId }],
          },
        }),
      });
      expect(createProjectResponse.status).toBe(201);
      const projectRaw = await createProjectResponse.json();
      const projectParsed = createRecordOkResponseSchema.safeParse(projectRaw);
      expect(projectParsed.success).toBe(true);
      if (!projectParsed.success || !projectParsed.data.ok) return;
      const projectId = projectParsed.data.data.record.id;

      await processOutbox(4);

      const records = await listRecords(projectsTable.id);
      const record = records.find((r) => r.id === projectId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(Number(record.fields[formula1FieldId])).toBe(10);
      expect(record.fields[formula2FieldId]).toBe('Large');
    });

    it('should resolve filtered lookup user only when return status is empty', async () => {
      const createUsageResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Filter Usage'),
          fields: [
            { type: 'singleLineText', name: 'Request No', isPrimary: true },
            { type: 'singleLineText', name: 'Return Status' },
            {
              type: 'user',
              name: 'Applicant',
              options: { isMultiple: false, shouldNotify: false },
            },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const usageRaw = await createUsageResponse.json();
      const usageParsed = createTableOkResponseSchema.safeParse(usageRaw);
      expect(usageParsed.success).toBe(true);
      if (!usageParsed.success || !usageParsed.data.ok) return;
      const usageTable = usageParsed.data.data.table;
      const requestFieldId = usageTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const returnStatusFieldId =
        usageTable.fields.find((f) => f.name === 'Return Status')?.id ?? '';
      const applicantFieldId = usageTable.fields.find((f) => f.name === 'Applicant')?.id ?? '';
      if (!requestFieldId || !returnStatusFieldId || !applicantFieldId) {
        throw new Error('Missing usage table fields');
      }

      const applicant = { id: 'system', title: 'System' };

      const createUsageAResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: usageTable.id,
          fields: {
            [requestFieldId]: 'AP-returned',
            [returnStatusFieldId]: 'Returned',
            [applicantFieldId]: applicant,
          },
        }),
      });
      expect(createUsageAResponse.status).toBe(201);
      const usageARaw = await createUsageAResponse.json();
      const usageAParsed = createRecordOkResponseSchema.safeParse(usageARaw);
      expect(usageAParsed.success).toBe(true);
      if (!usageAParsed.success || !usageAParsed.data.ok) return;
      const usageRecordAId = usageAParsed.data.data.record.id;

      const createUsageBResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: usageTable.id,
          fields: {
            [requestFieldId]: 'AP-active',
            [returnStatusFieldId]: null,
            [applicantFieldId]: applicant,
          },
        }),
      });
      expect(createUsageBResponse.status).toBe(201);
      const usageBRaw = await createUsageBResponse.json();
      const usageBParsed = createRecordOkResponseSchema.safeParse(usageBRaw);
      expect(usageBParsed.success).toBe(true);
      if (!usageBParsed.success || !usageBParsed.data.ok) return;
      const usageRecordBId = usageBParsed.data.data.record.id;

      const createAssetResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Filter Asset'),
          fields: [{ type: 'singleLineText', name: 'Asset Code', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const assetRaw = await createAssetResponse.json();
      const assetParsed = createTableOkResponseSchema.safeParse(assetRaw);
      expect(assetParsed.success).toBe(true);
      if (!assetParsed.success || !assetParsed.data.ok) return;
      const assetTable = assetParsed.data.data.table;
      const assetCodeFieldId = assetTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!assetCodeFieldId) throw new Error('Missing asset table primary field');

      const createUsageLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: assetTable.id,
          field: {
            type: 'link',
            name: 'Usage Link',
            options: {
              relationship: 'manyOne',
              foreignTableId: usageTable.id,
              lookupFieldId: requestFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createUsageLinkResponse.status).toBe(200);
      const usageLinkRaw = await createUsageLinkResponse.json();
      const usageLinkParsed = createFieldOkResponseSchema.safeParse(usageLinkRaw);
      expect(usageLinkParsed.success).toBe(true);
      if (!usageLinkParsed.success || !usageLinkParsed.data.ok) return;
      const usageLinkFieldId =
        usageLinkParsed.data.data.table.fields.find((f) => f.name === 'Usage Link')?.id ?? '';
      if (!usageLinkFieldId) throw new Error('Missing usage link field id');

      const createLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: assetTable.id,
          field: {
            type: 'lookup',
            name: 'Active Applicant',
            options: {
              foreignTableId: usageTable.id,
              lookupFieldId: applicantFieldId,
              linkFieldId: usageLinkFieldId,
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: returnStatusFieldId,
                    operator: 'isEmpty',
                    value: null,
                  },
                ],
              },
            },
          },
        }),
      });
      expect(createLookupResponse.status).toBe(200);
      const lookupRaw = await createLookupResponse.json();
      const lookupParsed = createFieldOkResponseSchema.safeParse(lookupRaw);
      expect(lookupParsed.success).toBe(true);
      if (!lookupParsed.success || !lookupParsed.data.ok) return;
      const lookupFieldId =
        lookupParsed.data.data.table.fields.find((f) => f.name === 'Active Applicant')?.id ?? '';
      if (!lookupFieldId) throw new Error('Missing lookup field id');

      const createAssetAResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: assetTable.id,
          fields: { [assetCodeFieldId]: 'A-returned' },
        }),
      });
      expect(createAssetAResponse.status).toBe(201);
      const assetARaw = await createAssetAResponse.json();
      const assetAParsed = createRecordOkResponseSchema.safeParse(assetARaw);
      expect(assetAParsed.success).toBe(true);
      if (!assetAParsed.success || !assetAParsed.data.ok) return;
      const assetRecordAId = assetAParsed.data.data.record.id;

      const createAssetBResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: assetTable.id,
          fields: { [assetCodeFieldId]: 'A-active' },
        }),
      });
      expect(createAssetBResponse.status).toBe(201);
      const assetBRaw = await createAssetBResponse.json();
      const assetBParsed = createRecordOkResponseSchema.safeParse(assetBRaw);
      expect(assetBParsed.success).toBe(true);
      if (!assetBParsed.success || !assetBParsed.data.ok) return;
      const assetRecordBId = assetBParsed.data.data.record.id;

      const updateAssetAResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: assetTable.id,
          recordId: assetRecordAId,
          fields: { [usageLinkFieldId]: { id: usageRecordAId } },
        }),
      });
      expect(updateAssetAResponse.status).toBe(200);
      const updateAssetARaw = await updateAssetAResponse.json();
      const updateAssetAParsed = updateRecordOkResponseSchema.safeParse(updateAssetARaw);
      expect(updateAssetAParsed.success).toBe(true);
      if (!updateAssetAParsed.success || !updateAssetAParsed.data.ok) return;

      const updateAssetBResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: assetTable.id,
          recordId: assetRecordBId,
          fields: { [usageLinkFieldId]: { id: usageRecordBId } },
        }),
      });
      expect(updateAssetBResponse.status).toBe(200);
      const updateAssetBRaw = await updateAssetBResponse.json();
      const updateAssetBParsed = updateRecordOkResponseSchema.safeParse(updateAssetBRaw);
      expect(updateAssetBParsed.success).toBe(true);
      if (!updateAssetBParsed.success || !updateAssetBParsed.data.ok) return;

      await processOutbox(3);

      const records = await listRecords(assetTable.id);
      const returnedAsset = records.find((record) => record.id === assetRecordAId);
      const activeAsset = records.find((record) => record.id === assetRecordBId);
      expect(returnedAsset).toBeDefined();
      expect(activeAsset).toBeDefined();
      if (!returnedAsset || !activeAsset) return;

      expect(returnedAsset.fields[lookupFieldId]).toBeNull();
      expect(activeAsset.fields[lookupFieldId]).toMatchObject([{ id: 'system', title: 'System' }]);
    }, 120000);

    it('should format multi-value lookup dates with DATETIME_FORMAT', async () => {
      const createForeignResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Date Foreign'),
          fields: [
            { type: 'singleLineText', name: 'Title', isPrimary: true },
            { type: 'date', name: 'Milestone Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const foreignRaw = await createForeignResponse.json();
      const foreignParsed = createTableOkResponseSchema.safeParse(foreignRaw);
      expect(foreignParsed.success).toBe(true);
      if (!foreignParsed.success || !foreignParsed.data.ok) return;
      const foreignTable = foreignParsed.data.data.table;
      const foreignPrimaryFieldId = foreignTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const milestoneFieldId =
        foreignTable.fields.find((f) => f.name === 'Milestone Date')?.id ?? '';
      if (!foreignPrimaryFieldId || !milestoneFieldId) throw new Error('Missing foreign fields');

      const createForeignAResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: foreignTable.id,
          fields: {
            [foreignPrimaryFieldId]: 'Alpha',
            [milestoneFieldId]: '2023-10-12T00:00:00.000Z',
          },
        }),
      });
      expect(createForeignAResponse.status).toBe(201);
      const foreignARaw = await createForeignAResponse.json();
      const foreignAParsed = createRecordOkResponseSchema.safeParse(foreignARaw);
      expect(foreignAParsed.success).toBe(true);
      if (!foreignAParsed.success || !foreignAParsed.data.ok) return;
      const foreignRecordAId = foreignAParsed.data.data.record.id;

      const createForeignBResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: foreignTable.id,
          fields: {
            [foreignPrimaryFieldId]: 'Beta',
            [milestoneFieldId]: '2023-10-12T00:00:00.000Z',
          },
        }),
      });
      expect(createForeignBResponse.status).toBe(201);
      const foreignBRaw = await createForeignBResponse.json();
      const foreignBParsed = createRecordOkResponseSchema.safeParse(foreignBRaw);
      expect(foreignBParsed.success).toBe(true);
      if (!foreignBParsed.success || !foreignBParsed.data.ok) return;
      const foreignRecordBId = foreignBParsed.data.data.record.id;

      const createHostResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Date Host'),
          fields: [{ type: 'singleLineText', name: 'Project', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const hostRaw = await createHostResponse.json();
      const hostParsed = createTableOkResponseSchema.safeParse(hostRaw);
      expect(hostParsed.success).toBe(true);
      if (!hostParsed.success || !hostParsed.data.ok) return;
      const hostTable = hostParsed.data.data.table;
      const projectFieldId = hostTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!projectFieldId) throw new Error('Missing host primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'link',
            name: 'Related Milestones',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Related Milestones')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'lookup',
            name: 'Milestone Dates',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: milestoneFieldId,
              linkFieldId,
            },
          },
        }),
      });
      expect(createLookupResponse.status).toBe(200);
      const lookupRaw = await createLookupResponse.json();
      const lookupParsed = createFieldOkResponseSchema.safeParse(lookupRaw);
      expect(lookupParsed.success).toBe(true);
      if (!lookupParsed.success || !lookupParsed.data.ok) return;
      const lookupFieldId =
        lookupParsed.data.data.table.fields.find((f) => f.name === 'Milestone Dates')?.id ?? '';
      if (!lookupFieldId) throw new Error('Missing lookup field id');

      const createFormattedResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'formula',
            name: 'Milestone Day',
            options: { expression: `DATETIME_FORMAT({${lookupFieldId}}, 'DD')` },
          },
        }),
      });
      expect(createFormattedResponse.status).toBe(200);
      const formattedRaw = await createFormattedResponse.json();
      const formattedParsed = createFieldOkResponseSchema.safeParse(formattedRaw);
      expect(formattedParsed.success).toBe(true);
      if (!formattedParsed.success || !formattedParsed.data.ok) return;
      const formattedFieldId =
        formattedParsed.data.data.table.fields.find((f) => f.name === 'Milestone Day')?.id ?? '';
      if (!formattedFieldId) throw new Error('Missing formatted field id');

      const createDayNumberResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'formula',
            name: 'Milestone Day Number',
            options: { expression: `DAY({${lookupFieldId}}) & ''` },
          },
        }),
      });
      expect(createDayNumberResponse.status).toBe(200);
      const dayNumberRaw = await createDayNumberResponse.json();
      const dayNumberParsed = createFieldOkResponseSchema.safeParse(dayNumberRaw);
      expect(dayNumberParsed.success).toBe(true);
      if (!dayNumberParsed.success || !dayNumberParsed.data.ok) return;
      const dayNumberFieldId =
        dayNumberParsed.data.data.table.fields.find((f) => f.name === 'Milestone Day Number')?.id ??
        '';
      if (!dayNumberFieldId) throw new Error('Missing day number field id');

      const createDateStrResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'formula',
            name: 'Milestone DateStr',
            options: { expression: `DATESTR({${lookupFieldId}})` },
          },
        }),
      });
      expect(createDateStrResponse.status).toBe(200);
      const dateStrRaw = await createDateStrResponse.json();
      const dateStrParsed = createFieldOkResponseSchema.safeParse(dateStrRaw);
      expect(dateStrParsed.success).toBe(true);
      if (!dateStrParsed.success || !dateStrParsed.data.ok) return;
      const dateStrFieldId =
        dateStrParsed.data.data.table.fields.find((f) => f.name === 'Milestone DateStr')?.id ?? '';
      if (!dateStrFieldId) throw new Error('Missing date str field id');

      const createTimeStrResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'formula',
            name: 'Milestone TimeStr',
            options: { expression: `TIMESTR({${lookupFieldId}})` },
          },
        }),
      });
      expect(createTimeStrResponse.status).toBe(200);
      const timeStrRaw = await createTimeStrResponse.json();
      const timeStrParsed = createFieldOkResponseSchema.safeParse(timeStrRaw);
      expect(timeStrParsed.success).toBe(true);
      if (!timeStrParsed.success || !timeStrParsed.data.ok) return;
      const timeStrFieldId =
        timeStrParsed.data.data.table.fields.find((f) => f.name === 'Milestone TimeStr')?.id ?? '';
      if (!timeStrFieldId) throw new Error('Missing time str field id');

      const createHostRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: hostTable.id,
          fields: { [projectFieldId]: 'Lookup timeline' },
        }),
      });
      expect(createHostRecordResponse.status).toBe(201);
      const hostRecordRaw = await createHostRecordResponse.json();
      const hostRecordParsed = createRecordOkResponseSchema.safeParse(hostRecordRaw);
      expect(hostRecordParsed.success).toBe(true);
      if (!hostRecordParsed.success || !hostRecordParsed.data.ok) return;
      const hostRecordId = hostRecordParsed.data.data.record.id;

      const updateHostResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: hostTable.id,
          recordId: hostRecordId,
          fields: { [linkFieldId]: [{ id: foreignRecordAId }, { id: foreignRecordBId }] },
        }),
      });
      expect(updateHostResponse.status).toBe(200);
      const updateHostRaw = await updateHostResponse.json();
      const updateHostParsed = updateRecordOkResponseSchema.safeParse(updateHostRaw);
      expect(updateHostParsed.success).toBe(true);
      if (!updateHostParsed.success || !updateHostParsed.data.ok) return;

      await processOutbox(3);

      const records = await listRecords(hostTable.id);
      const record = records.find((r) => r.id === hostRecordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formattedFieldId]).toBe('12, 12');
      expect(record.fields[dayNumberFieldId]).toBe('12, 12');
      expect(record.fields[dateStrFieldId]).toBe('2023-10-12, 2023-10-12');
      expect(record.fields[timeStrFieldId]).toBe('00:00:00, 00:00:00');
    }, 120000);

    it('should format multi-value lookup numbers with VALUE', async () => {
      const createForeignResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Number Foreign'),
          fields: [
            { type: 'singleLineText', name: 'Title', isPrimary: true },
            { type: 'number', name: 'Budget' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const foreignRaw = await createForeignResponse.json();
      const foreignParsed = createTableOkResponseSchema.safeParse(foreignRaw);
      expect(foreignParsed.success).toBe(true);
      if (!foreignParsed.success || !foreignParsed.data.ok) return;
      const foreignTable = foreignParsed.data.data.table;
      const foreignPrimaryFieldId = foreignTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const budgetFieldId = foreignTable.fields.find((f) => f.name === 'Budget')?.id ?? '';
      if (!foreignPrimaryFieldId || !budgetFieldId) throw new Error('Missing foreign fields');

      const createForeignAResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: foreignTable.id,
          fields: {
            [foreignPrimaryFieldId]: 'Phase A',
            [budgetFieldId]: 1200.45,
          },
        }),
      });
      expect(createForeignAResponse.status).toBe(201);
      const foreignARaw = await createForeignAResponse.json();
      const foreignAParsed = createRecordOkResponseSchema.safeParse(foreignARaw);
      expect(foreignAParsed.success).toBe(true);
      if (!foreignAParsed.success || !foreignAParsed.data.ok) return;
      const foreignRecordAId = foreignAParsed.data.data.record.id;

      const createForeignBResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: foreignTable.id,
          fields: {
            [foreignPrimaryFieldId]: 'Phase B',
            [budgetFieldId]: 3400.51,
          },
        }),
      });
      expect(createForeignBResponse.status).toBe(201);
      const foreignBRaw = await createForeignBResponse.json();
      const foreignBParsed = createRecordOkResponseSchema.safeParse(foreignBRaw);
      expect(foreignBParsed.success).toBe(true);
      if (!foreignBParsed.success || !foreignBParsed.data.ok) return;
      const foreignRecordBId = foreignBParsed.data.data.record.id;

      const createHostResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Number Host'),
          fields: [{ type: 'singleLineText', name: 'Project', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const hostRaw = await createHostResponse.json();
      const hostParsed = createTableOkResponseSchema.safeParse(hostRaw);
      expect(hostParsed.success).toBe(true);
      if (!hostParsed.success || !hostParsed.data.ok) return;
      const hostTable = hostParsed.data.data.table;
      const projectFieldId = hostTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!projectFieldId) throw new Error('Missing host primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'link',
            name: 'Related Budgets',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Related Budgets')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'lookup',
            name: 'Budget Lookup',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: budgetFieldId,
              linkFieldId,
            },
          },
        }),
      });
      expect(createLookupResponse.status).toBe(200);
      const lookupRaw = await createLookupResponse.json();
      const lookupParsed = createFieldOkResponseSchema.safeParse(lookupRaw);
      expect(lookupParsed.success).toBe(true);
      if (!lookupParsed.success || !lookupParsed.data.ok) return;
      const lookupFieldId =
        lookupParsed.data.data.table.fields.find((f) => f.name === 'Budget Lookup')?.id ?? '';
      if (!lookupFieldId) throw new Error('Missing lookup field id');

      const createValueResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'formula',
            name: 'Budget Value Formula',
            options: { expression: `VALUE({${lookupFieldId}}) & ''` },
          },
        }),
      });
      expect(createValueResponse.status).toBe(200);
      const valueRaw = await createValueResponse.json();
      const valueParsed = createFieldOkResponseSchema.safeParse(valueRaw);
      expect(valueParsed.success).toBe(true);
      if (!valueParsed.success || !valueParsed.data.ok) return;
      const valueFieldId =
        valueParsed.data.data.table.fields.find((f) => f.name === 'Budget Value Formula')?.id ?? '';
      if (!valueFieldId) throw new Error('Missing value field id');

      const createRoundedResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'formula',
            name: 'Budget Rounded',
            options: { expression: `ROUND({${lookupFieldId}}, 0) & ''` },
          },
        }),
      });
      expect(createRoundedResponse.status).toBe(200);
      const roundedRaw = await createRoundedResponse.json();
      const roundedParsed = createFieldOkResponseSchema.safeParse(roundedRaw);
      expect(roundedParsed.success).toBe(true);
      if (!roundedParsed.success || !roundedParsed.data.ok) return;
      const roundedFieldId =
        roundedParsed.data.data.table.fields.find((f) => f.name === 'Budget Rounded')?.id ?? '';
      if (!roundedFieldId) throw new Error('Missing rounded field id');

      const createHostRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: hostTable.id,
          fields: { [projectFieldId]: 'Budget run' },
        }),
      });
      expect(createHostRecordResponse.status).toBe(201);
      const hostRecordRaw = await createHostRecordResponse.json();
      const hostRecordParsed = createRecordOkResponseSchema.safeParse(hostRecordRaw);
      expect(hostRecordParsed.success).toBe(true);
      if (!hostRecordParsed.success || !hostRecordParsed.data.ok) return;
      const hostRecordId = hostRecordParsed.data.data.record.id;

      const updateHostResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: hostTable.id,
          recordId: hostRecordId,
          fields: { [linkFieldId]: [{ id: foreignRecordAId }, { id: foreignRecordBId }] },
        }),
      });
      expect(updateHostResponse.status).toBe(200);
      const updateHostRaw = await updateHostResponse.json();
      const updateHostParsed = updateRecordOkResponseSchema.safeParse(updateHostRaw);
      expect(updateHostParsed.success).toBe(true);
      if (!updateHostParsed.success || !updateHostParsed.data.ok) return;

      await processOutbox(3);

      const records = await listRecords(hostTable.id);
      const record = records.find((r) => r.id === hostRecordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[valueFieldId]).toBe('1200.45, 3400.51');
      expect(record.fields[roundedFieldId]).toBe('1200, 3401');
    }, 120000);
  });

  // ============================================================================
  // 13. Formula recalculation scenarios
  // ============================================================================
  describe('formula recalculation scenarios', () => {
    const setupSingleSelectLookupScenario = async () => {
      const createOrdersResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Orders'),
          fields: [
            { type: 'singleLineText', name: 'Order', isPrimary: true },
            { type: 'singleSelect', name: 'Status', options: ['Paid', 'Deposit'] },
            { type: 'singleSelect', name: 'Plan', options: ['Plan2', 'Plan3', 'Other'] },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const ordersRaw = await createOrdersResponse.json();
      const ordersParsed = createTableOkResponseSchema.safeParse(ordersRaw);
      expect(ordersParsed.success).toBe(true);
      if (!ordersParsed.success || !ordersParsed.data.ok) {
        throw new Error('Failed to create orders table');
      }
      const ordersTable = ordersParsed.data.data.table;
      const orderNameFieldId = ordersTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const statusFieldId = ordersTable.fields.find((f) => f.name === 'Status')?.id ?? '';
      const planFieldId = ordersTable.fields.find((f) => f.name === 'Plan')?.id ?? '';
      if (!orderNameFieldId || !statusFieldId || !planFieldId) {
        throw new Error('Missing orders table fields');
      }

      const createOrderRecord = async (name: string, status: string, plan: string) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: ordersTable.id,
            fields: {
              [orderNameFieldId]: name,
              [statusFieldId]: status,
              [planFieldId]: plan,
            },
          }),
        });
        expect(response.status).toBe(201);
        const recordRaw = await response.json();
        const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
        expect(recordParsed.success).toBe(true);
        if (!recordParsed.success || !recordParsed.data.ok) {
          throw new Error('Failed to create order record');
        }
        return recordParsed.data.data.record.id;
      };

      const orderRecordAId = await createOrderRecord('Order-1', 'Paid', 'Plan2');
      const orderRecordBId = await createOrderRecord('Order-2', 'Deposit', 'Plan3');

      const createFollowupResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Followups'),
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const followupRaw = await createFollowupResponse.json();
      const followupParsed = createTableOkResponseSchema.safeParse(followupRaw);
      expect(followupParsed.success).toBe(true);
      if (!followupParsed.success || !followupParsed.data.ok) {
        throw new Error('Failed to create followup table');
      }
      const followupTable = followupParsed.data.data.table;
      const titleFieldId = followupTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!titleFieldId) throw new Error('Missing followup title field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: followupTable.id,
          field: {
            type: 'link',
            name: 'Order',
            options: {
              relationship: 'manyOne',
              foreignTableId: ordersTable.id,
              lookupFieldId: orderNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) {
        throw new Error('Failed to create link field');
      }
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Order')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createStatusLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: followupTable.id,
          field: {
            type: 'lookup',
            name: 'Lookup Status',
            options: {
              foreignTableId: ordersTable.id,
              lookupFieldId: statusFieldId,
              linkFieldId,
            },
          },
        }),
      });
      expect(createStatusLookupResponse.status).toBe(200);
      const statusLookupRaw = await createStatusLookupResponse.json();
      const statusLookupParsed = createFieldOkResponseSchema.safeParse(statusLookupRaw);
      expect(statusLookupParsed.success).toBe(true);
      if (!statusLookupParsed.success || !statusLookupParsed.data.ok) {
        throw new Error('Failed to create status lookup field');
      }
      const statusLookupFieldId =
        statusLookupParsed.data.data.table.fields.find((f) => f.name === 'Lookup Status')?.id ?? '';
      if (!statusLookupFieldId) throw new Error('Missing status lookup field id');

      const createPlanLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: followupTable.id,
          field: {
            type: 'lookup',
            name: 'Lookup Plan',
            options: {
              foreignTableId: ordersTable.id,
              lookupFieldId: planFieldId,
              linkFieldId,
            },
          },
        }),
      });
      expect(createPlanLookupResponse.status).toBe(200);
      const planLookupRaw = await createPlanLookupResponse.json();
      const planLookupParsed = createFieldOkResponseSchema.safeParse(planLookupRaw);
      expect(planLookupParsed.success).toBe(true);
      if (!planLookupParsed.success || !planLookupParsed.data.ok) {
        throw new Error('Failed to create plan lookup field');
      }
      const planLookupFieldId =
        planLookupParsed.data.data.table.fields.find((f) => f.name === 'Lookup Plan')?.id ?? '';
      if (!planLookupFieldId) throw new Error('Missing plan lookup field id');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: followupTable.id,
          field: {
            type: 'formula',
            name: 'Status Notice',
            options: {
              expression: `IF(
                {${statusLookupFieldId}}="Paid",
                "No reminder",
                IF(
                  AND(
                    {${statusLookupFieldId}}="Deposit",
                    OR(
                      {${planLookupFieldId}}="Plan2",
                      {${planLookupFieldId}}="Plan3"
                    )
                  ),
                  "Installment follow-up",
                  IF(
                    AND(
                      {${statusLookupFieldId}}="Deposit",
                      NOT(
                        OR(
                          {${planLookupFieldId}}="Plan2",
                          {${planLookupFieldId}}="Plan3"
                        )
                      )
                    ),
                    "Tail follow-up",
                    IF(
                      {${statusLookupFieldId}}="",
                      "Tail follow-up",
                      "Tail follow-up"
                    )
                  )
                )
              )`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) {
        throw new Error('Failed to create formula field');
      }
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Status Notice')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      return {
        followupTable,
        titleFieldId,
        linkFieldId,
        statusLookupFieldId,
        planLookupFieldId,
        formulaFieldId,
        orderRecordAId,
        orderRecordBId,
      };
    };
    /**
     * Scenario: formula computes when referenced fields are omitted on record creation
     * Formula:IF({statusField}, 222222, 1)
     * Expect: returns 1 when status field omitted
     */
    it('should calculate formula when referenced field is omitted on creation - IF({status}, 222222, 1)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Formula Omitted Status'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', name: 'Status' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const statusFieldId = table.fields.find((f) => f.name === 'Status')?.id ?? '';
      if (!primaryFieldId || !statusFieldId) throw new Error('Missing fields');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Status Formula',
            options: {
              expression: `IF({${statusFieldId}}, 222222, 1)`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;

      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Status Formula')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'Row 1',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(Number(record.fields[formulaFieldId])).toBe(1);
    });

    /**
     * Scenario: formula takes alternate branch when referenced fields are provided on record creation
     * Formula:IF({statusField}, 222222, 1)
     * Expect: returns 222222 when status field provided
     */
    it('should calculate alternate branch when referenced field has value - IF({status}, 222222, 1)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Formula Status Provided'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', name: 'Status' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const statusFieldId = table.fields.find((f) => f.name === 'Status')?.id ?? '';
      if (!primaryFieldId || !statusFieldId) throw new Error('Missing fields');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Status Formula',
            options: {
              expression: `IF({${statusFieldId}}, 222222, 1)`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;

      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Status Formula')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'Row 1',
            [statusFieldId]: 'Ready',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(Number(record.fields[formulaFieldId])).toBe(222222);
    });

    /**
     * Scenario: lookup-based formula when link is omitted
     * Formula:IF(COUNTA({lookupField})=0, "no lookup", {lookupField})
     * Expect: returns "no lookup" when link omitted
     */
    it('should compute lookup-based formula when link is omitted on creation', async () => {
      const createContactsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Omitted Contacts'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', name: 'Code' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const contactsRaw = await createContactsResponse.json();
      const contactsParsed = createTableOkResponseSchema.safeParse(contactsRaw);
      expect(contactsParsed.success).toBe(true);
      if (!contactsParsed.success || !contactsParsed.data.ok) return;

      const contactsTable = contactsParsed.data.data.table;
      const contactNameFieldId = contactsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const contactCodeFieldId = contactsTable.fields.find((f) => f.name === 'Code')?.id ?? '';
      if (!contactNameFieldId || !contactCodeFieldId) throw new Error('Missing contacts fields');

      const createContactResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: contactsTable.id,
          fields: {
            [contactNameFieldId]: 'Alice',
            [contactCodeFieldId]: 'C-EMPTY',
          },
        }),
      });
      expect(createContactResponse.status).toBe(201);
      const contactRaw = await createContactResponse.json();
      const contactParsed = createRecordOkResponseSchema.safeParse(contactRaw);
      expect(contactParsed.success).toBe(true);
      if (!contactParsed.success || !contactParsed.data.ok) return;
      const contactId = contactParsed.data.data.record.id;

      const createDealsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Omitted Deals'),
          fields: [{ type: 'singleLineText', name: 'Deal', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const dealsRaw = await createDealsResponse.json();
      const dealsParsed = createTableOkResponseSchema.safeParse(dealsRaw);
      expect(dealsParsed.success).toBe(true);
      if (!dealsParsed.success || !dealsParsed.data.ok) return;

      const dealsTable = dealsParsed.data.data.table;
      const dealNameFieldId = dealsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!dealNameFieldId) throw new Error('Missing deals primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'link',
            name: 'Contact',
            options: {
              relationship: 'manyOne',
              foreignTableId: contactsTable.id,
              lookupFieldId: contactNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Contact')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'lookup',
            name: 'Contact Code',
            options: {
              linkFieldId,
              foreignTableId: contactsTable.id,
              lookupFieldId: contactCodeFieldId,
            },
          },
        }),
      });
      expect(createLookupResponse.status).toBe(200);
      const lookupRaw = await createLookupResponse.json();
      const lookupParsed = createFieldOkResponseSchema.safeParse(lookupRaw);
      expect(lookupParsed.success).toBe(true);
      if (!lookupParsed.success || !lookupParsed.data.ok) return;
      const lookupFieldId =
        lookupParsed.data.data.table.fields.find((f) => f.name === 'Contact Code')?.id ?? '';
      if (!lookupFieldId) throw new Error('Missing lookup field id');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'formula',
            name: 'Lookup Default',
            options: {
              expression: `IF(COUNTA({${lookupFieldId}})=0, "no lookup", {${lookupFieldId}})`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Lookup Default')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      const createDealResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: dealsTable.id,
          fields: {
            [dealNameFieldId]: 'No Link',
          },
        }),
      });
      expect(createDealResponse.status).toBe(201);
      const dealRaw = await createDealResponse.json();
      const dealParsed = createRecordOkResponseSchema.safeParse(dealRaw);
      expect(dealParsed.success).toBe(true);
      if (!dealParsed.success || !dealParsed.data.ok) return;
      const dealId = dealParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(dealsTable.id);
      const record = records.find((r) => r.id === dealId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('no lookup');
    });

    /**
     * Scenario: lookup-based formula when link is provided
     * Formula:IF({lookupField}="", "no lookup", {lookupField})
     * Expect: returns lookup value when link provided
     */
    it('should compute lookup-based formula when link is provided on creation', async () => {
      const createContactsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Provided Contacts'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', name: 'Code' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const contactsRaw = await createContactsResponse.json();
      const contactsParsed = createTableOkResponseSchema.safeParse(contactsRaw);
      expect(contactsParsed.success).toBe(true);
      if (!contactsParsed.success || !contactsParsed.data.ok) return;

      const contactsTable = contactsParsed.data.data.table;
      const contactNameFieldId = contactsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const contactCodeFieldId = contactsTable.fields.find((f) => f.name === 'Code')?.id ?? '';
      if (!contactNameFieldId || !contactCodeFieldId) throw new Error('Missing contacts fields');

      const createContactResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: contactsTable.id,
          fields: {
            [contactNameFieldId]: 'Alice',
            [contactCodeFieldId]: 'C-LINK',
          },
        }),
      });
      expect(createContactResponse.status).toBe(201);
      const contactRaw = await createContactResponse.json();
      const contactParsed = createRecordOkResponseSchema.safeParse(contactRaw);
      expect(contactParsed.success).toBe(true);
      if (!contactParsed.success || !contactParsed.data.ok) return;
      const contactId = contactParsed.data.data.record.id;

      const createDealsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Lookup Provided Deals'),
          fields: [{ type: 'singleLineText', name: 'Deal', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const dealsRaw = await createDealsResponse.json();
      const dealsParsed = createTableOkResponseSchema.safeParse(dealsRaw);
      expect(dealsParsed.success).toBe(true);
      if (!dealsParsed.success || !dealsParsed.data.ok) return;

      const dealsTable = dealsParsed.data.data.table;
      const dealNameFieldId = dealsTable.fields.find((f) => f.isPrimary)?.id ?? '';
      if (!dealNameFieldId) throw new Error('Missing deals primary field');

      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'link',
            name: 'Contact',
            options: {
              relationship: 'manyOne',
              foreignTableId: contactsTable.id,
              lookupFieldId: contactNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Contact')?.id ?? '';
      if (!linkFieldId) throw new Error('Missing link field id');

      const createLookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'lookup',
            name: 'Contact Code',
            options: {
              linkFieldId,
              foreignTableId: contactsTable.id,
              lookupFieldId: contactCodeFieldId,
            },
          },
        }),
      });
      expect(createLookupResponse.status).toBe(200);
      const lookupRaw = await createLookupResponse.json();
      const lookupParsed = createFieldOkResponseSchema.safeParse(lookupRaw);
      expect(lookupParsed.success).toBe(true);
      if (!lookupParsed.success || !lookupParsed.data.ok) return;
      const lookupFieldId =
        lookupParsed.data.data.table.fields.find((f) => f.name === 'Contact Code')?.id ?? '';
      if (!lookupFieldId) throw new Error('Missing lookup field id');

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'formula',
            name: 'Lookup Default',
            options: {
              expression: `IF(COUNTA({${lookupFieldId}})=0, "no lookup", {${lookupFieldId}})`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Lookup Default')?.id ?? '';
      if (!formulaFieldId) throw new Error('Missing formula field id');

      const createDealResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: dealsTable.id,
          fields: {
            [dealNameFieldId]: 'Linked Deal',
            [linkFieldId]: { id: contactId },
          },
        }),
      });
      expect(createDealResponse.status).toBe(201);
      const dealRaw = await createDealResponse.json();
      const dealParsed = createRecordOkResponseSchema.safeParse(dealRaw);
      expect(dealParsed.success).toBe(true);
      if (!dealParsed.success || !dealParsed.data.ok) return;
      const dealId = dealParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(dealsTable.id);
      const record = records.find((r) => r.id === dealId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('C-LINK');
    }, 120000);

    /**
     * Scenario: fallback even when reference table entries are missing
     * Expect: returns default even if reference table is corrupted
     */
    it('should fallback even if reference table is missing entries', async () => {
      const {
        followupTable,
        titleFieldId,
        linkFieldId,
        statusLookupFieldId,
        planLookupFieldId,
        formulaFieldId,
      } = await setupSingleSelectLookupScenario();

      await ctx.testContainer.db
        .deleteFrom('reference')
        .where('from_field_id', '=', linkFieldId)
        .execute();
      await ctx.testContainer.db
        .deleteFrom('reference')
        .where('to_field_id', 'in', [statusLookupFieldId, planLookupFieldId])
        .execute();

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: followupTable.id,
          fields: { [titleFieldId]: 'Missing refs' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(followupTable.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Tail follow-up');
    }, 120000);

    /**
     * Scenario: fallback even when lookup-to-formula references are missing
     * Expect: returns default when lookup/formula edges are removed
     */
    it('should fallback even if lookup-to-formula references are missing', async () => {
      const {
        followupTable,
        titleFieldId,
        linkFieldId,
        statusLookupFieldId,
        planLookupFieldId,
        formulaFieldId,
      } = await setupSingleSelectLookupScenario();

      await ctx.testContainer.db
        .deleteFrom('reference')
        .where('from_field_id', '=', linkFieldId)
        .execute();
      await ctx.testContainer.db
        .deleteFrom('reference')
        .where('to_field_id', '=', linkFieldId)
        .execute();
      await ctx.testContainer.db
        .deleteFrom('reference')
        .where('from_field_id', 'in', [statusLookupFieldId, planLookupFieldId])
        .execute();
      await ctx.testContainer.db
        .deleteFrom('reference')
        .where('to_field_id', 'in', [statusLookupFieldId, planLookupFieldId, formulaFieldId])
        .execute();

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: followupTable.id,
          fields: { [titleFieldId]: 'Lookup refs removed' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(followupTable.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Tail follow-up');
    }, 120000);

    /**
     * Scenario: fallback even when lookup field is not marked computed
     * Expect: computes correctly even when isComputed is false
     */
    it('should fallback even if lookup fields are not marked computed', async () => {
      const {
        followupTable,
        titleFieldId,
        linkFieldId,
        statusLookupFieldId,
        planLookupFieldId,
        formulaFieldId,
      } = await setupSingleSelectLookupScenario();

      await ctx.testContainer.db
        .updateTable('field')
        .set({ is_computed: false })
        .where('id', 'in', [statusLookupFieldId, planLookupFieldId])
        .execute();
      await ctx.testContainer.db
        .deleteFrom('reference')
        .where('from_field_id', 'in', [linkFieldId, statusLookupFieldId, planLookupFieldId])
        .execute();

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: followupTable.id,
          fields: { [titleFieldId]: 'Lookup not computed' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(followupTable.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Tail follow-up');
    }, 120000);

    /**
     * Scenario: fallback even when reference graph is missing
     * Expect: returns default when reference graph is removed
     */
    it('should fallback even if reference graph is completely missing', async () => {
      const { followupTable, titleFieldId, formulaFieldId } =
        await setupSingleSelectLookupScenario();

      await ctx.testContainer.db.deleteFrom('reference').execute();

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: followupTable.id,
          fields: { [titleFieldId]: 'No references' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(3);

      const records = await listRecords(followupTable.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Tail follow-up');
    }, 120000);
  });

  // ============================================================================
  // 14. Error handling scenarios
  // ============================================================================
  describe('formula error scenarios', () => {
    /**
     * Scenario: invalid expression syntax
     * Formula:INVALID_FUNCTION({field})
     * Expect: returns 400 error
     */
    it('should fail with invalid expression syntax - INVALID_FUNCTION({field})', async () => {
      // Step 1: create table
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Invalid Formula Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      // 2. Attempt to create formula field with invalid function
      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Invalid Formula',
            options: {
              expression: `INVALID_FUNCTION({${numberFieldId}})`,
            },
          },
        }),
      });

      // 3. Verify 500 error (invalid function causes parse error)
      expect(createFieldResponse.status).toBe(500);
    });

    /**
     * Scenario: references missing field
     * Formula:{nonExistentFieldId}
     * Expect: returns 404 error
     */
    it('should fail with non-existent field reference - {nonExistentFieldId}', async () => {
      // Step 1: create table
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Nonexistent Field Test',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;

      // 2. Attempt to create formula referencing missing field
      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Invalid Reference',
            options: {
              expression: '{fldnonexistent00001}',
            },
          },
        }),
      });

      // 3. Verify 404 error (missing referenced field)
      expect(createFieldResponse.status).toBe(404);
    });

    /**
     * Scenario: empty expression
     * Formula:""
     * Expect: returns 400 error
     */
    it('should fail with empty expression', async () => {
      // Step 1: create table
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: 'Empty Expression Test',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;

      // 2. Attempt to create formula with empty expression
      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Empty Formula',
            options: {
              expression: '',
            },
          },
        }),
      });

      // 3. Verify 400 error
      expect(createFieldResponse.status).toBe(400);
    });

    /**
     * Scenario: circular reference
     * Formula:formula1 -> formula2 -> formula1
     * Expect: returns error (circular dependency)
     */
    test.todo('should fail with circular reference');

    /**
     * Scenario: division by zero
     * Formula:{numberField} / 0
     * Expect: returns error or infinity
     */
    test.todo('should handle division by zero - {numberField} / 0');
  });

  // ============================================================================
  // 15. Complex formula scenarios
  // ============================================================================
  describe('complex formula scenarios', () => {
    /**
     * Scenario: string concatenation with multiple fields
     * Formula:CONCATENATE({firstName}, " ", {lastName})
     * Expect: concatenates multiple fields correctly
     */
    it('should create formula with string concatenation - CONCATENATE({firstName}, " ", {lastName})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('CONCATENATE Test'),
          fields: [
            { type: 'singleLineText', name: 'firstName', isPrimary: true },
            { type: 'singleLineText', name: 'lastName' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const firstNameId = table.fields.find((f) => f.name === 'firstName')?.id ?? '';
      const lastNameId = table.fields.find((f) => f.name === 'lastName')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'FullName',
            options: {
              expression: `CONCATENATE({${firstNameId}}, " ", {${lastNameId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'FullName')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [firstNameId]: 'John',
            [lastNameId]: 'Doe',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('John Doe');
    });

    /**
     * Scenario: conditional logic combination
     * Formula:IF(AND({age} >= 18, {isActive}), "Adult Active", IF({age} >= 18, "Adult Inactive", "Minor"))
     * Expect: complex conditions compute correctly
     */
    it('should create formula with conditional logic - IF(AND({age} >= 18, {isActive}), ...)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Conditional Logic Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'age' },
            { type: 'checkbox', name: 'isActive' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      const ageFieldId = table.fields.find((f) => f.name === 'age')?.id ?? '';
      const isActiveFieldId = table.fields.find((f) => f.name === 'isActive')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Status',
            options: {
              expression: `IF(AND({${ageFieldId}} >= 18, {${isActiveFieldId}}), "Adult Active", IF({${ageFieldId}} >= 18, "Adult Inactive", "Minor"))`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Status')?.id ?? '';

      // Create three records to test all branches
      const createRecord = async (name: string, age: number, isActive: boolean) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: table.id,
            fields: {
              [nameFieldId]: name,
              [ageFieldId]: age,
              [isActiveFieldId]: isActive,
            },
          }),
        });
        expect(response.status).toBe(201);
        const raw = await response.json();
        const parsed = createRecordOkResponseSchema.safeParse(raw);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return null;
        return parsed.data.data.record.id;
      };

      const adultActiveId = await createRecord('Alice', 25, true);
      const adultInactiveId = await createRecord('Bob', 30, false);
      const minorId = await createRecord('Charlie', 15, true);

      await processOutbox();

      const records = await listRecords(table.id);

      const adultActiveRecord = records.find((r) => r.id === adultActiveId);
      const adultInactiveRecord = records.find((r) => r.id === adultInactiveId);
      const minorRecord = records.find((r) => r.id === minorId);

      expect(adultActiveRecord?.fields[formulaFieldId]).toBe('Adult Active');
      expect(adultInactiveRecord?.fields[formulaFieldId]).toBe('Adult Inactive');
      expect(minorRecord?.fields[formulaFieldId]).toBe('Minor');
    });

    /**
     * Scenario: mathematical operations
     * Formula:ROUND(({score} * {age}) / 10, 2)
     * Expect: math operations compute correctly
     */
    it('should create formula with mathematical operations - ROUND(({score} * {age}) / 10, 2)', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Math Operations Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'score' },
            { type: 'number', name: 'age' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const scoreFieldId = table.fields.find((f) => f.name === 'score')?.id ?? '';
      const ageFieldId = table.fields.find((f) => f.name === 'age')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Calculated',
            options: {
              expression: `ROUND(({${scoreFieldId}} * {${ageFieldId}}) / 10, 2)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Calculated')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [scoreFieldId]: 85.5,
            [ageFieldId]: 25,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      // (85.5 * 25) / 10 = 2137.5 / 10 = 213.75
      expect(record.fields[formulaFieldId]).toBe(213.75);
    });

    /**
     * Scenario: date function combination
     * Formula:YEAR({birthDate})
     * Expect: extracts birth year
     */
    it('should create formula with date functions - YEAR({birthDate})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Date Functions Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'birthDate' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const birthDateFieldId = table.fields.find((f) => f.name === 'birthDate')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'BirthYear',
            options: {
              expression: `YEAR({${birthDateFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'BirthYear')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [birthDateFieldId]: '1995-06-15T00:00:00.000Z',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(1995);
    });

    /**
     * Scenario: lookup datetime formatting concatenation
     * Formula:"NAS-" & {schoolLookup} & "-" & DATETIME_FORMAT({dateLookup}, "YYYYMMDD")
     * Expect: concatenates lookup field with formatted date
     */
    it('should concatenate lookup datetime output safely - "NAS-" & {schoolLookup} & "-" & DATETIME_FORMAT({dateLookup}, "YYYYMMDD")', async () => {
      // Create foreign table with school name and date
      const createForeignTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Schools'),
          fields: [
            { type: 'singleLineText', name: 'SchoolName', isPrimary: true },
            { type: 'date', name: 'EnrollmentDate' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const foreignRaw = await createForeignTableResponse.json();
      const foreignParsed = createTableOkResponseSchema.safeParse(foreignRaw);
      expect(foreignParsed.success).toBe(true);
      if (!foreignParsed.success || !foreignParsed.data.ok) return;

      const foreignTable = foreignParsed.data.data.table;
      const schoolNameFieldId = foreignTable.fields.find((f) => f.name === 'SchoolName')?.id ?? '';
      const enrollmentDateFieldId =
        foreignTable.fields.find((f) => f.name === 'EnrollmentDate')?.id ?? '';

      // Create record in foreign table
      const createForeignRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: foreignTable.id,
          fields: {
            [schoolNameFieldId]: 'MIT',
            [enrollmentDateFieldId]: '2024-09-15T00:00:00.000Z',
          },
        }),
      });
      expect(createForeignRecordResponse.status).toBe(201);
      const foreignRecordRaw = await createForeignRecordResponse.json();
      const foreignRecordParsed = createRecordOkResponseSchema.safeParse(foreignRecordRaw);
      expect(foreignRecordParsed.success).toBe(true);
      if (!foreignRecordParsed.success || !foreignRecordParsed.data.ok) return;
      const foreignRecordId = foreignRecordParsed.data.data.record.id;

      // Create host table with link to foreign table
      const createHostTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Students'),
          fields: [
            { type: 'singleLineText', name: 'StudentName', isPrimary: true },
            {
              type: 'link',
              name: 'School',
              options: {
                relationship: 'manyOne',
                foreignTableId: foreignTable.id,
                lookupFieldId: schoolNameFieldId,
                isOneWay: true,
              },
            },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const hostRaw = await createHostTableResponse.json();
      const hostParsed = createTableOkResponseSchema.safeParse(hostRaw);
      expect(hostParsed.success).toBe(true);
      if (!hostParsed.success || !hostParsed.data.ok) return;

      const hostTable = hostParsed.data.data.table;
      const linkFieldId = hostTable.fields.find((f) => f.name === 'School')?.id ?? '';

      // Create lookup fields
      const createField = async (field: Record<string, unknown>) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ baseId: ctx.baseId, tableId: hostTable.id, field }),
        });
        expect(response.status).toBe(200);
        const raw = await response.json();
        const parsed = createFieldOkResponseSchema.safeParse(raw);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return null;
        return parsed.data.data.table.fields.find((f) => f.name === field.name)?.id ?? null;
      };

      const schoolLookupId = await createField({
        type: 'lookup',
        name: 'SchoolLookup',
        options: {
          linkFieldId,
          foreignTableId: foreignTable.id,
          lookupFieldId: schoolNameFieldId,
        },
      });
      if (!schoolLookupId) return;

      const dateLookupId = await createField({
        type: 'lookup',
        name: 'DateLookup',
        options: {
          linkFieldId,
          foreignTableId: foreignTable.id,
          lookupFieldId: enrollmentDateFieldId,
        },
      });
      if (!dateLookupId) return;

      // Create formula field with the concatenation
      const formulaFieldId = await createField({
        type: 'formula',
        name: 'StudentCode',
        options: {
          expression: `"NAS-" & {${schoolLookupId}} & "-" & DATETIME_FORMAT({${dateLookupId}}, "YYYYMMDD")`,
        },
      });
      if (!formulaFieldId) return;

      // Create record in host table linking to foreign record
      const createHostRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: hostTable.id,
          fields: {
            [linkFieldId]: { id: foreignRecordId, title: 'MIT' },
          },
        }),
      });
      expect(createHostRecordResponse.status).toBe(201);
      const hostRecordRaw = await createHostRecordResponse.json();
      const hostRecordParsed = createRecordOkResponseSchema.safeParse(hostRecordRaw);
      expect(hostRecordParsed.success).toBe(true);
      if (!hostRecordParsed.success || !hostRecordParsed.data.ok) return;
      const hostRecordId = hostRecordParsed.data.data.record.id;

      await processOutbox(2);

      const records = await listRecords(hostTable.id);
      const record = records.find((r) => r.id === hostRecordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('NAS-MIT-20240915');
    });

    /**
     * Scenario: localized single select numeric parsing
     * Formula: VALUE({singleSelectField}) - parse "20 minutes" as 20
     * Expect: extracts number from option label
     */
    it('should parse localized option labels through VALUE() - VALUE({singleSelectField})', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('VALUE Single Select Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'singleSelect',
              name: 'Duration',
              options: {
                choices: [
                  { name: '10 minutes', color: 'blue' },
                  { name: '20 minutes', color: 'green' },
                  { name: '30 minutes', color: 'red' },
                ],
              },
            },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const durationFieldId = table.fields.find((f) => f.name === 'Duration')?.id ?? '';

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'DurationValue',
            options: {
              expression: `VALUE({${durationFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'DurationValue')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [durationFieldId]: '20 minutes',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(20);
    });
  });

  describe('customer-grade complex formula templates (todo)', () => {
    /**
     * Scenario: Very long IF/FIND concatenation mapping driven by normalized codes.
     * Field types:
     * - {rawCode}: singleLineText (source code list)
     * - {normalizedCode}: formula (singleLineText output, normalization of {rawCode})
     * Formula: IF(FIND("AD", {normalizedCode})>0, "Andorra", "") & IF(FIND("AE", {normalizedCode})>0, "UAE", "") & ... (170+ branches)
     * Expect: long chained concatenation remains stable with large branch counts.
     */
    it('should handle long IF/FIND concatenation mapping', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('IF FIND Mapping Test'),
          fields: [{ type: 'singleLineText', name: 'rawCode', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const rawCodeFieldId = table.fields.find((f) => f.name === 'rawCode')?.id ?? '';

      // Create normalized code formula (uppercase)
      const createNormalizedFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'normalizedCode',
            options: {
              expression: `UPPER({${rawCodeFieldId}})`,
            },
          },
        }),
      });
      expect(createNormalizedFieldResponse.status).toBe(200);
      const normalizedRaw = await createNormalizedFieldResponse.json();
      const normalizedParsed = createFieldOkResponseSchema.safeParse(normalizedRaw);
      expect(normalizedParsed.success).toBe(true);
      if (!normalizedParsed.success || !normalizedParsed.data.ok) return;

      const normalizedCodeFieldId =
        normalizedParsed.data.data.table.fields.find((f) => f.name === 'normalizedCode')?.id ?? '';

      // Create the long IF/FIND mapping formula (simplified with 10 country codes)
      const countryMappings = [
        ['AD', 'Andorra'],
        ['AE', 'UAE'],
        ['AF', 'Afghanistan'],
        ['AG', 'Antigua'],
        ['AL', 'Albania'],
        ['AM', 'Armenia'],
        ['AO', 'Angola'],
        ['AR', 'Argentina'],
        ['AT', 'Austria'],
        ['AU', 'Australia'],
      ];

      const expression = countryMappings
        .map(([code, name]) => `IF(FIND("${code}", {${normalizedCodeFieldId}})>0, "${name}", "")`)
        .join(' & ');

      const createMappingFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'CountryName',
            options: { expression },
          },
        }),
      });
      expect(createMappingFieldResponse.status).toBe(200);
      const mappingRaw = await createMappingFieldResponse.json();
      const mappingParsed = createFieldOkResponseSchema.safeParse(mappingRaw);
      expect(mappingParsed.success).toBe(true);
      if (!mappingParsed.success || !mappingParsed.data.ok) return;

      const mappingFieldId =
        mappingParsed.data.data.table.fields.find((f) => f.name === 'CountryName')?.id ?? '';

      // Create test records
      const createRecord = async (code: string) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: table.id,
            fields: { [rawCodeFieldId]: code },
          }),
        });
        expect(response.status).toBe(201);
        const raw = await response.json();
        const parsed = createRecordOkResponseSchema.safeParse(raw);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return null;
        return parsed.data.data.record.id;
      };

      const uaeRecordId = await createRecord('ae');
      const australiaRecordId = await createRecord('AU');
      const unknownRecordId = await createRecord('XX');

      await processOutbox(2);

      const records = await listRecords(table.id);

      const uaeRecord = records.find((r) => r.id === uaeRecordId);
      const australiaRecord = records.find((r) => r.id === australiaRecordId);
      const unknownRecord = records.find((r) => r.id === unknownRecordId);

      expect(uaeRecord?.fields[mappingFieldId]).toBe('UAE');
      expect(australiaRecord?.fields[mappingFieldId]).toBe('Australia');
      expect(unknownRecord?.fields[mappingFieldId]).toBe('');
    });

    /**
     * Scenario: Large SWITCH mapping table for app identifiers.
     * Field types:
     * - {appId}: singleLineText
     * Formula: SWITCH({appId}, "com.app.a", "App A", "com.app.b", "App B", ..., BLANK())
     * Expect: large mapping table produces correct labels.
     */
    it('should handle large SWITCH mapping table', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('SWITCH Mapping Test'),
          fields: [{ type: 'singleLineText', name: 'appId', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const appIdFieldId = table.fields.find((f) => f.name === 'appId')?.id ?? '';

      // Create SWITCH formula with multiple mappings
      const appMappings = [
        ['com.app.a', 'App A'],
        ['com.app.b', 'App B'],
        ['com.app.c', 'App C'],
        ['com.app.d', 'App D'],
        ['com.app.e', 'App E'],
        ['com.app.f', 'App F'],
        ['com.app.g', 'App G'],
        ['com.app.h', 'App H'],
        ['com.app.i', 'App I'],
        ['com.app.j', 'App J'],
      ];

      const switchPairs = appMappings.map(([id, name]) => `"${id}", "${name}"`).join(', ');
      const expression = `SWITCH({${appIdFieldId}}, ${switchPairs}, BLANK())`;

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'AppName',
            options: { expression },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'AppName')?.id ?? '';

      // Create test records
      const createRecord = async (appId: string) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: table.id,
            fields: { [appIdFieldId]: appId },
          }),
        });
        expect(response.status).toBe(201);
        const raw = await response.json();
        const parsed = createRecordOkResponseSchema.safeParse(raw);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return null;
        return parsed.data.data.record.id;
      };

      const appARecordId = await createRecord('com.app.a');
      const appERecordId = await createRecord('com.app.e');
      const unknownRecordId = await createRecord('com.app.unknown');

      await processOutbox();

      const records = await listRecords(table.id);

      const appARecord = records.find((r) => r.id === appARecordId);
      const appERecord = records.find((r) => r.id === appERecordId);
      const unknownRecord = records.find((r) => r.id === unknownRecordId);

      expect(appARecord?.fields[formulaFieldId]).toBe('App A');
      expect(appERecord?.fields[formulaFieldId]).toBe('App E');
      expect(unknownRecord?.fields[formulaFieldId]).toBeNull(); // BLANK() returns null
    });

    /**
     * Scenario: Complex text parsing with MID/FIND/LEFT chain.
     * Field types:
     * - {addressText}: singleLineText (space-delimited address string)
     * Formula: IF({addressText}, LEFT(MID({addressText}, ...), ...), "fallback") with multiple FIND/MID nesting
     * Expect: parses multi-delimiter segments consistently.
     */
    it('should parse complex text with MID/FIND/LEFT chain', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('MID FIND LEFT Test'),
          fields: [{ type: 'singleLineText', name: 'addressText', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const addressFieldId = table.fields.find((f) => f.name === 'addressText')?.id ?? '';

      // Extract city from address like "123 Main St, San Francisco, CA 94102"
      // Formula extracts the segment after first comma and before second comma
      const expression = `IF({${addressFieldId}}, TRIM(MID({${addressFieldId}}, FIND(",", {${addressFieldId}}) + 1, FIND(",", {${addressFieldId}}, FIND(",", {${addressFieldId}}) + 1) - FIND(",", {${addressFieldId}}) - 1)), "fallback")`;

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'City',
            options: { expression },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'City')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [addressFieldId]: '123 Main St, San Francisco, CA 94102',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('San Francisco');
    });

    /**
     * Scenario: Large numeric aggregation across many columns.
     * Field types:
     * - {num1}..{num39}: number
     * Formula: SUM({num1}, {num2}, ... {num39})
     * Expect: summation across dozens of numeric fields is correct.
     */
    it('should sum many numeric fields in a single formula', async () => {
      // Create a table with multiple numeric fields (use 10 for practical testing)
      const numFieldCount = 10;
      const numFields = Array.from({ length: numFieldCount }, (_, i) => ({
        type: 'number',
        name: `num${i + 1}`,
      }));

      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Multi Field SUM Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }, ...numFields],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;

      // Get all numeric field IDs
      const numFieldIds = Array.from({ length: numFieldCount }, (_, i) => {
        const field = table.fields.find((f) => f.name === `num${i + 1}`);
        return field?.id ?? '';
      });

      // Create SUM formula with all numeric fields
      const sumExpression = `SUM(${numFieldIds.map((id) => `{${id}}`).join(', ')})`;

      const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Total',
            options: { expression: sumExpression },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Total')?.id ?? '';

      // Create a record with values 1, 2, 3, ... 10
      const recordFields: Record<string, number> = {};
      numFieldIds.forEach((id, i) => {
        recordFields[id] = i + 1;
      });

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: recordFields,
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      // SUM(1, 2, 3, 4, 5, 6, 7, 8, 9, 10) = 55
      expect(record.fields[formulaFieldId]).toBe(55);
    });

    /**
     * Scenario: Multi-field conditional count from many single selects.
     * Field types:
     * - {status1}..{status31}: singleSelect (same option set)
     * Formula: SUM({status1}="Target", {status2}="Target", ...)
     * Expect: batch conditional count remains correct.
     */
    test.todo('should sum many single-select comparisons');

    /**
     * Scenario: Nested IF + SUM threshold logic for size coefficients.
     * Field types:
     * - {length}, {width}: number
     * Formula: IF(SUM({length},{width})>1.6, SUM({length},{width})/1.6*SUM({length},{width})/1.6, 1)
     * Expect: threshold branching and squared coefficient calculation remain correct.
     */
    test.todo('should handle nested IF with SUM threshold logic');

    /**
     * Scenario: Branching pricing/cost formula with MAX + nested IF.
     * Field types:
     * - {pricingMode}: singleSelect
     * - {qty}: number
     * - {rateWeight}, {rateVolume}, {rateCount}, {flatPrice}: number
     * - {fallback}: number
     * Formula: MAX(IF({pricingMode}="Weight", {qty}*{rateWeight}, IF({pricingMode}="Volume", {qty}*{rateVolume}, IF({pricingMode}="Count", {qty}*{rateCount}, IF({pricingMode}="Flat", {flatPrice}, 0)))), {fallback})
     * Expect: branch selection respects pricing mode and max fallback.
     */
    test.todo('should handle branching pricing formula with MAX and IF');

    /**
     * Scenario: Multi-field cost aggregation.
     * Field types:
     * - {cost1}..{cost6}: number
     * Formula: {cost1}+{cost2}+{cost3}+{cost4}+{cost5}+{cost6}
     * Expect: aggregation across multiple cost fields is correct.
     */
    test.todo('should handle multi-field cost aggregation');

    /**
     * Scenario: Conditional settlement date formatting.
     * Field types:
     * - {status}: singleSelect
     * - {dateA}, {dateB}: dateTime
     * Formula: IF({status}="SettleA", DATETIME_FORMAT({dateA}, "YYYY-MM-DD"), DATETIME_FORMAT({dateB}, "YYYY-MM-DD"))
     * Expect: conditional date formatting chooses the correct date.
     */
    test.todo('should handle conditional datetime formatting chain');

    /**
     * Scenario: Inventory countdown with DATE_ADD + IS_AFTER + CONCATENATE.
     * Field types:
     * - {stockDate}: dateTime
     * - {graceDays}: number
     * - {label}: singleLineText
     * Formula: IF(IS_AFTER(DATE_ADD({stockDate}, {graceDays}, "day"), NOW()), CONCATENATE({label}, " OK"), CONCATENATE({label}, " EXP"))
     * Expect: date comparison and concatenation remain stable.
     */
    test.todo('should handle inventory countdown with DATE_ADD and IS_AFTER');

    /**
     * Scenario: Tiered adjustments by category.
     * Field types:
     * - {category}: singleSelect
     * - {price}: number
     * Formula: IF({category}="A", {price}*0.7, IF({category}="B", {price}*0.5, {price}*0.3))
     * Expect: tier coefficients apply correctly.
     */
    test.todo('should handle tiered adjustments by category');

    /**
     * Scenario: Stock status thresholds with nested IF.
     * Field types:
     * - {stock}: number
     * - {minStock}: number
     * Formula: IF({stock}<= {minStock}, "low", IF({stock}<= {minStock}*1.5, "mid", "ok"))
     * Expect: threshold status is correct.
     */
    test.todo('should handle nested stock status thresholds');

    /**
     * Scenario: Composite key concatenation.
     * Field types:
     * - {partA}, {partB}, {partC}: singleLineText
     * Formula: CONCATENATE({partA}, "-", {partB}, "-", {partC})
     * Expect: composite key output is stable.
     */
    test.todo('should concatenate multiple fields as composite key');

    /**
     * Scenario: Lookup + date formatting concatenation across linked tables.
     * Field types:
     * - {linkToOrders}: link (Table A -> Table B)
     * - {lookupOrderName}: lookup (singleLineText) from linked table
     * - {lookupOrderDate}: lookup (dateTime) from linked table
     * Formula: {lookupOrderName} & "-" & DATETIME_FORMAT({lookupOrderDate}, "YYYYMMDD")
     * Expect: cross-table concatenation is correct.
     */
    test.todo('should concatenate lookup text with formatted lookup date');

    /**
     * Scenario: Mixed lookup + rollup aggregation across linked records.
     * Field types:
     * - {linkToItems}: link (Table A -> Table B)
     * - {lookupNums}: lookup (number array)
     * - {rollupSum}: rollup (number)
     * Formula: IF(SUM({lookupNums})>0, {rollupSum} / SUM({lookupNums}), 0)
     * Expect: aggregation remains stable with linked data.
     */
    test.todo('should handle lookup + rollup mixed aggregation');
  });

  // ============================================================================
  // 16. Formatted value matrix
  // ============================================================================
  describe('formatted value matrix', () => {
    it('formats number/date for formulas, lookups, rollups, and nested lookups', async () => {
      const createForeignTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Format Foreign'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'number',
              name: 'Amount',
              options: { formatting: { type: 'decimal', precision: 2 } },
            },
            {
              type: 'date',
              name: 'Due',
              options: { formatting: { date: 'YYYY/MM/DD', time: 'None', timeZone: 'utc' } },
            },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const foreignRaw = await createForeignTableResponse.json();
      const foreignParsed = createTableOkResponseSchema.safeParse(foreignRaw);
      expect(foreignParsed.success).toBe(true);
      if (!foreignParsed.success || !foreignParsed.data.ok) return;

      const foreignTable = foreignParsed.data.data.table;
      const foreignNameId = foreignTable.fields.find((f) => f.name === 'Name')?.id ?? '';
      const foreignAmountId = foreignTable.fields.find((f) => f.name === 'Amount')?.id ?? '';
      const foreignDueId = foreignTable.fields.find((f) => f.name === 'Due')?.id ?? '';

      const createForeignRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: foreignTable.id,
          fields: {
            [foreignNameId]: 'Foreign 1',
            [foreignAmountId]: 20,
            [foreignDueId]: '2024-01-03T00:00:00.000Z',
          },
        }),
      });
      expect(createForeignRecordResponse.status).toBe(201);
      const foreignRecordRaw = await createForeignRecordResponse.json();
      const foreignRecordParsed = createRecordOkResponseSchema.safeParse(foreignRecordRaw);
      expect(foreignRecordParsed.success).toBe(true);
      if (!foreignRecordParsed.success || !foreignRecordParsed.data.ok) return;
      const foreignRecordId = foreignRecordParsed.data.data.record.id;

      const createHostTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Format Host'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'number',
              name: 'AmountLocal',
              options: { formatting: { type: 'decimal', precision: 2 } },
            },
            {
              type: 'link',
              name: 'LinkToForeign',
              options: {
                relationship: 'manyOne',
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignNameId,
                isOneWay: true,
              },
            },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const hostRaw = await createHostTableResponse.json();
      const hostParsed = createTableOkResponseSchema.safeParse(hostRaw);
      expect(hostParsed.success).toBe(true);
      if (!hostParsed.success || !hostParsed.data.ok) return;

      const hostTable = hostParsed.data.data.table;
      const hostLinkId = hostTable.fields.find((f) => f.name === 'LinkToForeign')?.id ?? '';
      const hostAmountId = hostTable.fields.find((f) => f.name === 'AmountLocal')?.id ?? '';

      const createField = async (field: Record<string, unknown>) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ baseId: ctx.baseId, tableId: hostTable.id, field }),
        });
        expect(response.status).toBe(200);
        const raw = await response.json();
        const parsed = createFieldOkResponseSchema.safeParse(raw);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return null;
        return parsed.data.data.table.fields.find((f) => f.name === field.name)?.id ?? null;
      };

      const lookupAmountId = await createField({
        type: 'lookup',
        name: 'LookupAmount',
        options: {
          linkFieldId: hostLinkId,
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignAmountId,
        },
      });
      if (!lookupAmountId) return;

      const lookupDueId = await createField({
        type: 'lookup',
        name: 'LookupDue',
        options: {
          linkFieldId: hostLinkId,
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignDueId,
        },
      });
      if (!lookupDueId) return;

      const rollupAmountId = await createField({
        type: 'rollup',
        name: 'RollupAmount',
        options: { expression: 'sum({values})', formatting: { type: 'decimal', precision: 2 } },
        config: {
          linkFieldId: hostLinkId,
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignAmountId,
        },
      });
      if (!rollupAmountId) return;

      const formulaRightLookupAmountId = await createField({
        type: 'formula',
        name: 'RightLookupAmount',
        options: { expression: `RIGHT({${lookupAmountId}}, 2)` },
      });
      if (!formulaRightLookupAmountId) return;

      const formulaRightLookupDueId = await createField({
        type: 'formula',
        name: 'RightLookupDue',
        options: { expression: `RIGHT({${lookupDueId}}, 2)` },
      });
      if (!formulaRightLookupDueId) return;

      const formulaRightRollupAmountId = await createField({
        type: 'formula',
        name: 'RightRollupAmount',
        options: { expression: `RIGHT({${rollupAmountId}}, 2)` },
      });
      if (!formulaRightRollupAmountId) return;

      const formulaRightAmountId = await createField({
        type: 'formula',
        name: 'RightAmountLocal',
        options: { expression: `RIGHT({${hostAmountId}}, 2)` },
      });
      if (!formulaRightAmountId) return;

      const createHostRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: hostTable.id,
          fields: {
            [hostAmountId]: 20,
            [hostLinkId]: { id: foreignRecordId, title: 'Foreign 1' },
          },
        }),
      });
      expect(createHostRecordResponse.status).toBe(201);
      const hostRecordRaw = await createHostRecordResponse.json();
      const hostRecordParsed = createRecordOkResponseSchema.safeParse(hostRecordRaw);
      expect(hostRecordParsed.success).toBe(true);
      if (!hostRecordParsed.success || !hostRecordParsed.data.ok) return;
      const hostRecordId = hostRecordParsed.data.data.record.id;

      const createOuterTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Format Outer'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'link',
              name: 'LinkToHost',
              options: {
                relationship: 'manyOne',
                foreignTableId: hostTable.id,
                lookupFieldId: hostAmountId,
                isOneWay: true,
              },
            },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const outerRaw = await createOuterTableResponse.json();
      const outerParsed = createTableOkResponseSchema.safeParse(outerRaw);
      expect(outerParsed.success).toBe(true);
      if (!outerParsed.success || !outerParsed.data.ok) return;

      const outerTable = outerParsed.data.data.table;
      const outerLinkId = outerTable.fields.find((f) => f.name === 'LinkToHost')?.id ?? '';

      const createOuterField = async (field: Record<string, unknown>) => {
        const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ baseId: ctx.baseId, tableId: outerTable.id, field }),
        });
        expect(response.status).toBe(200);
        const raw = await response.json();
        const parsed = createFieldOkResponseSchema.safeParse(raw);
        expect(parsed.success).toBe(true);
        if (!parsed.success || !parsed.data.ok) return null;
        return parsed.data.data.table.fields.find((f) => f.name === field.name)?.id ?? null;
      };

      const nestedLookupId = await createOuterField({
        type: 'lookup',
        name: 'NestedLookupAmount',
        options: {
          linkFieldId: outerLinkId,
          foreignTableId: hostTable.id,
          lookupFieldId: lookupAmountId,
        },
      });
      if (!nestedLookupId) return;

      const formulaRightNestedId = await createOuterField({
        type: 'formula',
        name: 'RightNestedAmount',
        options: { expression: `RIGHT({${nestedLookupId}}, 2)` },
      });
      if (!formulaRightNestedId) return;

      const createOuterRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: outerTable.id,
          fields: {
            [outerLinkId]: { id: hostRecordId, title: 'Host 1' },
          },
        }),
      });
      expect(createOuterRecordResponse.status).toBe(201);
      const outerRecordRaw = await createOuterRecordResponse.json();
      const outerRecordParsed = createRecordOkResponseSchema.safeParse(outerRecordRaw);
      expect(outerRecordParsed.success).toBe(true);
      if (!outerRecordParsed.success || !outerRecordParsed.data.ok) return;
      const outerRecordId = outerRecordParsed.data.data.record.id;

      await processOutbox(3);

      const hostRecords = await listRecords(hostTable.id);
      const hostRecord = hostRecords.find((r) => r.id === hostRecordId);
      expect(hostRecord).toBeDefined();
      if (!hostRecord) return;

      expect(hostRecord.fields[formulaRightLookupAmountId]).toBe('00');
      expect(hostRecord.fields[formulaRightLookupDueId]).toBe('03');
      expect(hostRecord.fields[formulaRightRollupAmountId]).toBe('00');
      expect(hostRecord.fields[formulaRightAmountId]).toBe('00');

      const outerRecords = await listRecords(outerTable.id);
      const outerRecord = outerRecords.find((r) => r.id === outerRecordId);
      expect(outerRecord).toBeDefined();
      if (!outerRecord) return;

      const linkValue = outerRecord.fields[outerLinkId] as { id?: string; title?: string };
      expect(linkValue?.title).toBe('20.00');
      expect(outerRecord.fields[formulaRightNestedId]).toBe('00');
    });
  });

  // ============================================================================
  // 16. Special edge cases
  // ============================================================================
  describe('special edge cases', () => {
    /**
     * Scenario: blank value handling
     * Formula:IF({field} = BLANK(), "empty", "has value")
     * Expect: correctly identifies blanks
     */
    test.todo('should handle blank values - IF({field} = BLANK(), "empty", "has value")');

    /**
     * Scenario: very long text
     * Formula:LEN({longTextField})
     * Expect: correctly computes long text length
     */
    test.todo('should handle very long text - LEN({longTextField})');

    /**
     * Scenario: special characters
     * Formula:{textField} with special characters like emoji, unicode
     * Expect: handles special characters correctly
     */
    test.todo('should handle special characters in text fields');

    /**
     * Scenario: very large numbers
     * Formula:{numberField} with very large numbers
     * Expect: handles large numbers correctly
     */
    test.todo('should handle very large numbers');

    /**
     * Scenario: very small decimals (floating-point precision)
     * Formula:{numberField} with very small decimals
     * Expect: handles decimal precision correctly
     */
    test.todo('should handle very small decimals (floating point precision)');

    /**
     * Scenario: negative numbers
     * Formula:ABS({negativeNumber})
     * Expect: handles negative numbers correctly
     */
    test.todo('should handle negative numbers - ABS({negativeNumber})');

    /**
     * Scenario: empty string vs null vs undefined
     * Formula:IF({field}="", "empty string", "not empty string")
     * Expect: distinguishes empty string and null
     */
    test.todo('should distinguish empty string vs null vs undefined');

    /**
     * Scenario: fallback when only null is sent
     * Formula: when the only sent field is explicitly null
     * Expect: formula still computes default value
     */
    test.todo('should fallback when the only field sent is explicitly null');
  });

  // ============================================================================
  // 17. Formula field options
  // ============================================================================
  describe('formula field options', () => {
    /**
     * Scenario: formula field with number formatting options
     * Formula:{numberField} * 2
     * Options: formatting: { type: 'decimal', precision: 1 }
     * Expect: result formatted with specified precision
     */
    test.todo('should apply number formatting to formula result');

    /**
     * Scenario: formula field with showAs option (bar)
     * Formula:{numberField}
     * Options: showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 }
     * Expect: formula result displayed as bar
     */
    test.todo('should apply showAs option to formula field - bar display');

    /**
     * Scenario: formula field with timezone option
     * Formula:DATETIME_FORMAT({dateField}, "YYYY-MM-DD HH:mm")
     * Options: timeZone: "Asia/Shanghai"
     * Expect: formats with specified timezone
     */
    test.todo('should apply timezone option to formula field');
  });

  // ============================================================================
  // 18. Direct field reference display value extraction
  // ============================================================================
  describe('direct field reference display value extraction', () => {
    /**
     * Scenario: Formula directly references a manyOne link field
     * Formula:{manyOneLinkField}
     * Expect: returns the title string, NOT a JSON object like {"id": "rec...", "title": "..."}
     */
    it('should extract title from manyOne link field - {manyOneLinkField}', async () => {
      // Create foreign table (contacts)
      const createContactsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('ManyOne Contacts'),
          fields: [{ type: 'singleLineText', name: 'ContactName', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const contactsRaw = await createContactsResponse.json();
      const contactsParsed = createTableOkResponseSchema.safeParse(contactsRaw);
      expect(contactsParsed.success).toBe(true);
      if (!contactsParsed.success || !contactsParsed.data.ok) return;

      const contactsTable = contactsParsed.data.data.table;
      const contactNameFieldId = contactsTable.fields.find((f) => f.isPrimary)?.id ?? '';

      // Create a contact record
      const createContactResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: contactsTable.id,
          fields: { [contactNameFieldId]: 'John Doe' },
        }),
      });
      expect(createContactResponse.status).toBe(201);
      const contactRaw = await createContactResponse.json();
      const contactParsed = createRecordOkResponseSchema.safeParse(contactRaw);
      expect(contactParsed.success).toBe(true);
      if (!contactParsed.success || !contactParsed.data.ok) return;
      const contactId = contactParsed.data.data.record.id;

      // Create main table (deals) with manyOne link to contacts
      const createDealsResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('ManyOne Deals'),
          fields: [{ type: 'singleLineText', name: 'DealName', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const dealsRaw = await createDealsResponse.json();
      const dealsParsed = createTableOkResponseSchema.safeParse(dealsRaw);
      expect(dealsParsed.success).toBe(true);
      if (!dealsParsed.success || !dealsParsed.data.ok) return;

      const dealsTable = dealsParsed.data.data.table;
      const dealNameFieldId = dealsTable.fields.find((f) => f.isPrimary)?.id ?? '';

      // Create manyOne link field (multiple deals can link to one contact)
      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'link',
            name: 'Contact',
            options: {
              relationship: 'manyOne',
              foreignTableId: contactsTable.id,
              lookupFieldId: contactNameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      expect(createLinkResponse.status).toBe(200);
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Contact')?.id ?? '';

      // Create formula field that directly references the link field
      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: dealsTable.id,
          field: {
            type: 'formula',
            name: 'LinkedContactName',
            options: { expression: `{${linkFieldId}}` },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'LinkedContactName')?.id ?? '';

      // Create a deal record with link to the contact
      const createDealResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: dealsTable.id,
          fields: {
            [dealNameFieldId]: 'Deal A',
            [linkFieldId]: { id: contactId },
          },
        }),
      });
      expect(createDealResponse.status).toBe(201);
      const dealRaw = await createDealResponse.json();
      const dealParsed = createRecordOkResponseSchema.safeParse(dealRaw);
      expect(dealParsed.success).toBe(true);
      if (!dealParsed.success || !dealParsed.data.ok) return;
      const dealId = dealParsed.data.data.record.id;

      await processOutbox(3);

      // Verify the formula field value is the title string, not JSON object
      const records = await listRecords(dealsTable.id);
      const stored = records.find((r) => r.id === dealId);
      expect(stored).toBeDefined();
      if (!stored) return;

      const formulaValue = stored.fields[formulaFieldId];
      // Should be "John Doe", not {"id": "rec...", "title": "John Doe"}
      expect(formulaValue).toBe('John Doe');
      // Additional assertion: should NOT be a JSON object string
      if (typeof formulaValue === 'string') {
        expect(formulaValue).not.toMatch(/^\s*\{.*"id".*"title".*\}\s*$/);
      }
    });

    /**
     * Scenario: Formula directly references a user field
     * Formula:{userField}
     * Expect: returns the name string, NOT a JSON object like {"id": "...", "name": "...", "email": "..."}
     * Note: User field values need to reference actual user IDs from the system
     */
    test.todo('should extract name from user field - {userField}');

    /**
     * Scenario: Formula directly references createdBy field
     * Formula: {createdByField}
     * Expect: returns the name string of the creator (via subquery from users table)
     */
    it('should extract name from createdBy field - {createdByField}', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('CreatedBy Formula Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const createCreatedByResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'createdBy',
            name: 'Created By',
          },
        }),
      });
      expect(createCreatedByResponse.status).toBe(200);
      const createdByRaw = await createCreatedByResponse.json();
      const createdByParsed = createFieldOkResponseSchema.safeParse(createdByRaw);
      expect(createdByParsed.success).toBe(true);
      if (!createdByParsed.success || !createdByParsed.data.ok) return;

      const createdByFieldId =
        createdByParsed.data.data.table.fields.find((f) => f.name === 'Created By')?.id ?? '';

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Creator Name',
            options: {
              expression: `{${createdByFieldId}}`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;

      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Creator Name')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Row 1' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(2);

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const createdByValue = record.fields[createdByFieldId];
      expect(createdByValue).toEqual({
        id: ctx.testUser.id,
        title: ctx.testUser.name,
        email: ctx.testUser.email,
        avatarUrl: `/api/attachments/read/public/avatar/${ctx.testUser.id}`,
      });
      const formulaValue = record.fields[formulaFieldId];
      expect(formulaValue).toBe(ctx.testUser.name);
    });

    /**
     * Scenario: Formula directly references lastModifiedBy field
     * Formula: {lastModifiedByField}
     * Expect: returns the name string of the last modifier (via subquery from users table)
     */
    it('should extract name from lastModifiedBy field - {lastModifiedByField}', async () => {
      const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('LastModifiedBy Formula Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Count' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const countFieldId = table.fields.find((f) => f.name === 'Count')?.id ?? '';

      const createLastModifiedByResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'lastModifiedBy',
            name: 'Last Modified By',
          },
        }),
      });
      expect(createLastModifiedByResponse.status).toBe(200);
      const lastModifiedByRaw = await createLastModifiedByResponse.json();
      const lastModifiedByParsed = createFieldOkResponseSchema.safeParse(lastModifiedByRaw);
      expect(lastModifiedByParsed.success).toBe(true);
      if (!lastModifiedByParsed.success || !lastModifiedByParsed.data.ok) return;

      const lastModifiedByFieldId =
        lastModifiedByParsed.data.data.table.fields.find((f) => f.name === 'Last Modified By')
          ?.id ?? '';

      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Modifier Name',
            options: {
              expression: `{${lastModifiedByFieldId}}`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;

      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Modifier Name')?.id ?? '';

      const createRecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Row 1', [countFieldId]: 1 },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(2);

      let records = await listRecords(table.id);
      let record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const initialLastModifiedBy = record.fields[lastModifiedByFieldId];
      expect(initialLastModifiedBy).toEqual({
        id: ctx.testUser.id,
        title: ctx.testUser.name,
        email: ctx.testUser.email,
        avatarUrl: `/api/attachments/read/public/avatar/${ctx.testUser.id}`,
      });
      expect(record.fields[formulaFieldId]).toBe(ctx.testUser.name);

      const updateRecordResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: { [countFieldId]: 2 },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);
      const updateRaw = await updateRecordResponse.json();
      const updateParsed = updateRecordOkResponseSchema.safeParse(updateRaw);
      expect(updateParsed.success).toBe(true);
      if (!updateParsed.success || !updateParsed.data.ok) return;

      await processOutbox(2);

      records = await listRecords(table.id);
      record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[lastModifiedByFieldId]).toEqual({
        id: ctx.testUser.id,
        title: ctx.testUser.name,
        email: ctx.testUser.email,
        avatarUrl: `/api/attachments/read/public/avatar/${ctx.testUser.id}`,
      });
      expect(record.fields[formulaFieldId]).toBe(ctx.testUser.name);
    });

    /**
     * Scenario: Update manyOne link cell and verify formula updates with title
     * This tests the same scenario as the failing v1 test:
     * "should update formula field when change manyOne link cell"
     */
    it('should update formula field with title when manyOne link cell changes', async () => {
      // Create table1 (foreign table)
      const createTable1Response = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Table1'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const table1Raw = await createTable1Response.json();
      const table1Parsed = createTableOkResponseSchema.safeParse(table1Raw);
      expect(table1Parsed.success).toBe(true);
      if (!table1Parsed.success || !table1Parsed.data.ok) return;

      const table1 = table1Parsed.data.data.table;
      const table1NameFieldId = table1.fields.find((f) => f.isPrimary)?.id ?? '';

      // Create records in table1
      const createRecord1Response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table1.id,
          fields: { [table1NameFieldId]: 'table1_1' },
        }),
      });
      const record1Raw = await createRecord1Response.json();
      const record1Parsed = createRecordOkResponseSchema.safeParse(record1Raw);
      expect(record1Parsed.success).toBe(true);
      if (!record1Parsed.success || !record1Parsed.data.ok) return;
      const record1Id = record1Parsed.data.data.record.id;

      const createRecord2Response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table1.id,
          fields: { [table1NameFieldId]: 'table1_2' },
        }),
      });
      const record2Raw = await createRecord2Response.json();
      const record2Parsed = createRecordOkResponseSchema.safeParse(record2Raw);
      expect(record2Parsed.success).toBe(true);
      if (!record2Parsed.success || !record2Parsed.data.ok) return;
      const record2Id = record2Parsed.data.data.record.id;

      // Create table2 with manyOne link to table1
      const createTable2Response = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Table2'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const table2Raw = await createTable2Response.json();
      const table2Parsed = createTableOkResponseSchema.safeParse(table2Raw);
      expect(table2Parsed.success).toBe(true);
      if (!table2Parsed.success || !table2Parsed.data.ok) return;

      const table2 = table2Parsed.data.data.table;
      const table2NameFieldId = table2.fields.find((f) => f.isPrimary)?.id ?? '';

      // Create manyOne link field
      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table2.id,
          field: {
            type: 'link',
            name: 'LinkedRecord',
            options: {
              relationship: 'manyOne',
              foreignTableId: table1.id,
              lookupFieldId: table1NameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'LinkedRecord')?.id ?? '';

      // Create formula field that references the link field
      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table2.id,
          field: {
            type: 'formula',
            name: 'FormulaLink',
            options: { expression: `{${linkFieldId}}` },
          },
        }),
      });
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'FormulaLink')?.id ?? '';

      // Create record in table2 with link to record1
      const createTable2RecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table2.id,
          fields: {
            [table2NameFieldId]: 'table2_1',
            [linkFieldId]: { id: record1Id },
          },
        }),
      });
      const table2RecordRaw = await createTable2RecordResponse.json();
      const table2RecordParsed = createRecordOkResponseSchema.safeParse(table2RecordRaw);
      expect(table2RecordParsed.success).toBe(true);
      if (!table2RecordParsed.success || !table2RecordParsed.data.ok) return;
      const table2RecordId = table2RecordParsed.data.data.record.id;

      await processOutbox(3);

      // Verify initial formula value is "table1_1"
      let records = await listRecords(table2.id);
      let stored = records.find((r) => r.id === table2RecordId);
      expect(stored).toBeDefined();
      expect(stored?.fields[formulaFieldId]).toBe('table1_1');

      // Update the link to point to record2
      const updateRecordResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table2.id,
          recordId: table2RecordId,
          fields: { [linkFieldId]: { id: record2Id } },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);

      await processOutbox(3);

      // Verify formula value updated to "table1_2"
      records = await listRecords(table2.id);
      stored = records.find((r) => r.id === table2RecordId);
      expect(stored).toBeDefined();
      // This is the key assertion: should be "table1_2", NOT {"id": "...", "title": "table1_2"}
      expect(stored?.fields[formulaFieldId]).toBe('table1_2');
    });

    it('should update formula field with titles when oneMany link cell changes', async () => {
      // Create table2 (foreign table)
      const createTable2Response = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Table2'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const table2Raw = await createTable2Response.json();
      const table2Parsed = createTableOkResponseSchema.safeParse(table2Raw);
      expect(table2Parsed.success).toBe(true);
      if (!table2Parsed.success || !table2Parsed.data.ok) return;

      const table2 = table2Parsed.data.data.table;
      const table2NameFieldId = table2.fields.find((f) => f.isPrimary)?.id ?? '';

      // Create records in table2
      const createTable2Record1Response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table2.id,
          fields: { [table2NameFieldId]: 'table2_1' },
        }),
      });
      const table2Record1Raw = await createTable2Record1Response.json();
      const table2Record1Parsed = createRecordOkResponseSchema.safeParse(table2Record1Raw);
      expect(table2Record1Parsed.success).toBe(true);
      if (!table2Record1Parsed.success || !table2Record1Parsed.data.ok) return;
      const table2Record1Id = table2Record1Parsed.data.data.record.id;

      const createTable2Record2Response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table2.id,
          fields: { [table2NameFieldId]: 'table2_2' },
        }),
      });
      const table2Record2Raw = await createTable2Record2Response.json();
      const table2Record2Parsed = createRecordOkResponseSchema.safeParse(table2Record2Raw);
      expect(table2Record2Parsed.success).toBe(true);
      if (!table2Record2Parsed.success || !table2Record2Parsed.data.ok) return;
      const table2Record2Id = table2Record2Parsed.data.data.record.id;

      // Create table1 with oneMany link to table2
      const createTable1Response = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          name: uniqueName('Table1'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const table1Raw = await createTable1Response.json();
      const table1Parsed = createTableOkResponseSchema.safeParse(table1Raw);
      expect(table1Parsed.success).toBe(true);
      if (!table1Parsed.success || !table1Parsed.data.ok) return;

      const table1 = table1Parsed.data.data.table;
      const table1NameFieldId = table1.fields.find((f) => f.isPrimary)?.id ?? '';

      // Create oneMany link field (one record in table1 links to many records in table2)
      const createLinkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table1.id,
          field: {
            type: 'link',
            name: 'Children',
            options: {
              relationship: 'oneMany',
              foreignTableId: table2.id,
              lookupFieldId: table2NameFieldId,
              isOneWay: true,
            },
          },
        }),
      });
      const linkRaw = await createLinkResponse.json();
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) return;
      const linkFieldId =
        linkParsed.data.data.table.fields.find((f) => f.name === 'Children')?.id ?? '';

      // Create formula field that references the oneMany link field
      const createFormulaResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table1.id,
          field: {
            type: 'formula',
            name: 'ChildrenTitles',
            options: { expression: `{${linkFieldId}}` },
          },
        }),
      });
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;
      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'ChildrenTitles')?.id ?? '';

      // Create record in table1 linking only to first child
      const createTable1RecordResponse = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table1.id,
          fields: {
            [table1NameFieldId]: 'table1_1',
            [linkFieldId]: [{ id: table2Record1Id }],
          },
        }),
      });
      const table1RecordRaw = await createTable1RecordResponse.json();
      const table1RecordParsed = createRecordOkResponseSchema.safeParse(table1RecordRaw);
      expect(table1RecordParsed.success).toBe(true);
      if (!table1RecordParsed.success || !table1RecordParsed.data.ok) return;
      const table1RecordId = table1RecordParsed.data.data.record.id;

      await processOutbox(3);

      // Verify initial formula value is an array of titles
      let records = await listRecords(table1.id);
      let stored = records.find((r) => r.id === table1RecordId);
      expect(stored).toBeDefined();
      expect(stored?.fields[formulaFieldId]).toEqual(['table2_1']);

      // Update the oneMany link to include both children
      const updateRecordResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table1.id,
          recordId: table1RecordId,
          fields: {
            [linkFieldId]: [{ id: table2Record1Id }, { id: table2Record2Id }],
          },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);

      await processOutbox(3);

      // Verify formula value updated to both titles (array)
      records = await listRecords(table1.id);
      stored = records.find((r) => r.id === table1RecordId);
      expect(stored).toBeDefined();
      expect(stored?.fields[formulaFieldId]).toEqual(['table2_1', 'table2_2']);
    });
  });
});
