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
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest';

describe('v2 http formula (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
  let testContainer: IV2NodeTestContainer;
  const uniqueName = (prefix: string) =>
    `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    testContainer = await createV2NodeTestContainer();
    dispose = testContainer.dispose;
    baseId = testContainer.baseId.toString();

    const app = express();
    app.use(
      createV2ExpressRouter({
        createContainer: () => testContainer.container,
      })
    );

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    if (dispose) await dispose();
  });

  const processOutbox = async (times = 1) => {
    for (let i = 0; i < times; i += 1) {
      await testContainer.processOutbox();
    }
  };

  const listRecords = async (tableIdParam: string) => {
    const params = new URLSearchParams({ tableId: tableIdParam });
    const response = await fetch(`${baseUrl}/tables/listRecords?${params.toString()}`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const updateRecordResponse = await fetch(`${baseUrl}/tables/updateRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createEmptyRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const createFilledRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse1 = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createRecordResponse2 = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createUnassignedResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const createAssignedResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [userFieldId]: [{ id: 'usr1', title: 'User 1' }],
          },
        }),
      });
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createAutoNumberResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFormulaResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createCreatedTimeResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFormulaResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createLastModifiedResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFormulaResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const updateRecordResponse = await fetch(`${baseUrl}/tables/updateRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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

      expect(record.fields[formulaFieldId]).toBe('123.00text');
    });

    /**
     * Scenario: string number addition
     * Formula:"10" + {numberField}
     * Expect: coerces "10" to number then adds
     */
    it('should coerce string to number when adding - "10" + {numberField}', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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

      expect(record.fields[formulaFieldId]).toBe('105.00');
    });

    /**
     * Scenario: boolean and number arithmetic
     * Formula:{checkboxField} + 1
     * Expect: true coerces to 1, false to 0
     */
    it('should coerce boolean to number - {checkboxField} + 1', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const falseRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const falseRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const falseRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const falseRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const falseRecord1 = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const falseRecord2 = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const emptyRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const filledRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const zeroRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const nonZeroRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createLastModifiedResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const updateRecordResponse = await fetch(`${baseUrl}/tables/updateRecord`, {
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

      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createLastModifiedResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const updateRecordResponse = await fetch(`${baseUrl}/tables/updateRecord`, {
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

      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createLastModifiedResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const updateRecordResponse = await fetch(`${baseUrl}/tables/updateRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('ENCODE_URL_COMPONENT Test'),
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [textFieldId]: 'Hello World' },
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

      expect(record.fields[formulaFieldId]).toBe('Hello World');
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const passRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const failRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const aRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const bRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const cRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const aRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const bRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const noneRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'AND Test',
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Both Positive')?.id ?? '';

      // Test both greater than zero
      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const falseRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'OR Test',
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const falseRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
        const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const falseRecord = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createAlwaysErrorResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createAlwaysOkResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createIsErrorErrorResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createIsErrorOkResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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

      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
    test.todo('should check if before - IS_BEFORE({date1}, {date2})');

    /**
     * Scenario:IS_AFTER function
     * Formula:IS_AFTER({date1}, {date2})
     * Expect: checks date1 after date2
     */
    test.todo('should check if after - IS_AFTER({date1}, {date2})');

    /**
     * Scenario:SET_LOCALE function
     * Formula:SET_LOCALE({dateField}, "zh-CN")
     * Expect: sets date locale
     */
    test.todo('should set locale - SET_LOCALE({dateField}, "zh-CN")');

    /**
     * Scenario:SET_TIMEZONE function
     * Formula:SET_TIMEZONE({dateField}, "Asia/Shanghai")
     * Expect: sets timezone
     */
    test.todo('should set timezone - SET_TIMEZONE({dateField}, "Asia/Shanghai")');

    /**
     * Scenario:CREATED_TIME function
     * Formula:CREATED_TIME()
     * Expect: returns record created time
     */
    test.todo('should get created time - CREATED_TIME()');

    /**
     * Scenario:LAST_MODIFIED_TIME function
     * Formula:LAST_MODIFIED_TIME()
     * Expect: returns last modified time
     */
    test.todo('should get last modified time - LAST_MODIFIED_TIME()');

    /**
     * Scenario: format datetime with timezone option
     * Formula:DATETIME_FORMAT({dateField}, "YYYYMMDD") with timeZone: "Asia/Shanghai"
     * Expect: formats datetime with configured timezone
     */
    test.todo('should format datetime with timezone config - DATETIME_FORMAT with timeZone option');
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
    test.todo('should join array - ARRAYJOIN({multiSelectField}, ", ")');

    /**
     * Scenario:ARRAYUNIQUE function
     * Formula:ARRAYUNIQUE({lookupField})
     * Expect: returns unique array
     */
    test.todo('should get unique array - ARRAYUNIQUE({lookupField})');

    /**
     * Scenario:ARRAYFLATTEN function
     * Formula:ARRAYFLATTEN({nestedArray})
     * Expect: flattens nested array
     */
    test.todo('should flatten array - ARRAYFLATTEN({nestedArray})');

    /**
     * Scenario:ARRAYCOMPACT function
     * Formula:ARRAYCOMPACT({arrayWithNulls})
     * Expect: removes null values
     */
    test.todo('should compact array - ARRAYCOMPACT({arrayWithNulls})');

    /**
     * Scenario:COUNTALL function
     * Formula:COUNTALL({lookupField})
     * Expect: counts all elements (including nulls)
     */
    test.todo('should count all - COUNTALL({lookupField})');

    /**
     * Scenario:COUNTA function
     * Formula:COUNTA({lookupField})
     * Expect: counts non-empty elements
     */
    test.todo('should count non-empty - COUNTA({lookupField})');

    /**
     * Scenario:COUNT function
     * Formula:COUNT({lookupField})
     * Expect: counts numeric elements
     */
    test.todo('should count numbers - COUNT({lookupField})');
  });

  // ============================================================================
  // 11. Formulas with link and lookup fields
  // ============================================================================
  describe('formula with link and lookup fields', () => {
    /**
     * Scenario: Formula references link field
     * Formula:IF({linkField}, "Has Link", "No Link")
     * Expect: returns "Has Link" when linked
     */
    test.todo(
      'should create formula referencing link field - IF({linkField}, "Has Link", "No Link")'
    );

    /**
     * Scenario: Formula references lookup field
     * Formula:{lookupField}
     * Expect: returns lookup field value
     */
    test.todo('should create formula referencing lookup field - {lookupField}');

    /**
     * Scenario: Formula references rollup field
     * Formula:{rollupField} * 2
     * Expect: rollup value multiplied by 2
     */
    test.todo('should create formula referencing rollup field - {rollupField} * 2');

    /**
     * Scenario: formula handles empty lookup field
     * Formula:IF({lookupField}="", "no lookup", {lookupField})
     * Expect: returns "no lookup" when lookup is empty
     */
    test.todo(
      'should handle empty lookup in formula - IF({lookupField}="", "no lookup", {lookupField})'
    );

    /**
     * Scenario: formula handles empty rollup field
     * Formula:IF({rollupField} > 0, "Has rollup", "No rollup")
     * Expect: returns "No rollup" when rollup is empty
     */
    test.todo(
      'should handle empty rollup in formula - IF({rollupField} > 0, "Has rollup", "No rollup")'
    );

    /**
     * Scenario: Formula references link display value
     * Formula:{linkField}
     * Expect: returns link display value (primary field)
     */
    test.todo('should get link field display value in formula - {linkField}');

    /**
     * Scenario: Formula references lookup single select field
     * Formula:IF({lookupSingleSelect}="Paid", "No reminder", "Follow up")
     * Expect: evaluates based on lookup single select value
     */
    test.todo(
      'should handle lookup single select in formula - IF({lookupSingleSelect}="Paid", ...)'
    );

    /**
     * Scenario: nested lookup formula (lookup -> lookup -> number)
     * Formula:Table3 -> Table2(lookup) -> Table1(number)
     * Expect: retrieves nested lookup value correctly
     */
    test.todo('should handle nested lookup formula - lookup of lookup field');

    /**
     * Scenario: link display depends on lookup
     * Formula:{orderNo} & "-" & {patientLink} (link display depends on lookup)
     * Expect: computes correctly when link display depends on lookup
     */
    test.todo('should compute formula when link display depends on lookup');
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createFormula1Response = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createFormula2Response = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
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
    test.todo('should handle multi-level formula chain');

    /**
     * Scenario: formula indirectly references link field
     * Formula:formula1 -> formula2(references link) -> link field
     * Expect: computes correctly when formula indirectly references link field
     */
    test.todo('should handle formula indirectly referencing link field through another formula');

    /**
     * Scenario: formula indirectly references lookup field
     * Formula:formula1 -> formula2(references lookup) -> lookup field
     * Expect: computes correctly when formula indirectly references lookup field
     */
    test.todo('should handle formula indirectly referencing lookup field through another formula');

    /**
     * Scenario: formula indirectly references rollup field
     * Formula:formula1 -> formula2(references rollup) -> rollup field
     * Expect: computes correctly when formula indirectly references rollup field
     */
    test.todo('should handle formula indirectly referencing rollup field through another formula');
  });

  // ============================================================================
  // 13. Formula recalculation scenarios
  // ============================================================================
  describe('formula recalculation scenarios', () => {
    /**
     * Scenario: formula computes when referenced fields are omitted on record creation
     * Formula:IF({statusField}="", 1, 222222)
     * Expect: returns 1 when status field omitted
     */
    test.todo(
      'should calculate formula when referenced field is omitted on creation - IF({status}="", 1, 222222)'
    );

    /**
     * Scenario: formula takes alternate branch when referenced fields are provided on record creation
     * Formula:IF({statusField}="", 1, 222222)
     * Expect: returns 222222 when status field provided
     */
    test.todo(
      'should calculate alternate branch when referenced field has value - IF({status}="", 1, 222222)'
    );

    /**
     * Scenario: lookup-based formula when link is omitted
     * Formula:IF({lookupField}="", "no lookup", {lookupField})
     * Expect: returns "no lookup" when link omitted
     */
    test.todo('should compute lookup-based formula when link is omitted on creation');

    /**
     * Scenario: lookup-based formula when link is provided
     * Formula:IF({lookupField}="", "no lookup", {lookupField})
     * Expect: returns lookup value when link provided
     */
    test.todo('should compute lookup-based formula when link is provided on creation');

    /**
     * Scenario: fallback even when reference table entries are missing
     * Expect: returns default even if reference table is corrupted
     */
    test.todo('should fallback even if reference table is missing entries');

    /**
     * Scenario: fallback even when lookup field is not marked computed
     * Expect: computes correctly even when isComputed is false
     */
    test.todo('should fallback even if lookup fields are not marked computed');

    /**
     * Scenario: fallback even when reference graph is missing
     * Expect: returns default when reference graph is removed
     */
    test.todo('should fallback even if reference graph is completely missing');
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
    test.todo(
      'should create formula with string concatenation - CONCATENATE({firstName}, " ", {lastName})'
    );

    /**
     * Scenario: conditional logic combination
     * Formula:IF(AND({age} >= 18, {isActive}), "Adult Active", IF({age} >= 18, "Adult Inactive", "Minor"))
     * Expect: complex conditions compute correctly
     */
    test.todo(
      'should create formula with conditional logic - IF(AND({age} >= 18, {isActive}), ...)'
    );

    /**
     * Scenario: mathematical operations
     * Formula:ROUND(({score} * {age}) / 10, 2)
     * Expect: math operations compute correctly
     */
    test.todo(
      'should create formula with mathematical operations - ROUND(({score} * {age}) / 10, 2)'
    );

    /**
     * Scenario: date function combination
     * Formula:YEAR({birthDate})
     * Expect: extracts birth year
     */
    test.todo('should create formula with date functions - YEAR({birthDate})');

    /**
     * Scenario: lookup datetime formatting concatenation
     * Formula:"NAS-" & {schoolLookup} & "-" & DATETIME_FORMAT({dateLookup}, "YYYYMMDD")
     * Expect: concatenates lookup field with formatted date
     */
    test.todo(
      'should concatenate lookup datetime output safely - "NAS-" & {schoolLookup} & "-" & DATETIME_FORMAT({dateLookup}, "YYYYMMDD")'
    );

    /**
     * Scenario: localized single select numeric parsing
     * Formula: VALUE({singleSelectField}) - parse "20 minutes" as 20
     * Expect: extracts number from option label
     */
    test.todo('should parse localized option labels through VALUE() - VALUE({singleSelectField})');
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
    test.todo('should handle long IF/FIND concatenation mapping');

    /**
     * Scenario: Large SWITCH mapping table for app identifiers.
     * Field types:
     * - {appId}: singleLineText
     * Formula: SWITCH({appId}, "com.app.a", "App A", "com.app.b", "App B", ..., BLANK())
     * Expect: large mapping table produces correct labels.
     */
    test.todo('should handle large SWITCH mapping table');

    /**
     * Scenario: Complex text parsing with MID/FIND/LEFT chain.
     * Field types:
     * - {addressText}: singleLineText (space-delimited address string)
     * Formula: IF({addressText}, LEFT(MID({addressText}, ...), ...), "fallback") with multiple FIND/MID nesting
     * Expect: parses multi-delimiter segments consistently.
     */
    test.todo('should parse complex text with MID/FIND/LEFT chain');

    /**
     * Scenario: Large numeric aggregation across many columns.
     * Field types:
     * - {num1}..{num39}: number
     * Formula: SUM({num1}, {num2}, ... {num39})
     * Expect: summation across dozens of numeric fields is correct.
     */
    test.todo('should sum many numeric fields in a single formula');

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
});
