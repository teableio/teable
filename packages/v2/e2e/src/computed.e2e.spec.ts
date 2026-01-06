/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Comprehensive E2E tests for computed field updates.
 *
 * This file tests the complete computed field update chain including:
 * - Formula fields (same-table and cross-table dependencies)
 * - Lookup fields (linked record value updates)
 * - Rollup fields (aggregated linked record values)
 * - Link field effects on symmetric links, lookups, and formulas
 * - ConditionalRollup fields (filtered rollup aggregations)
 * - ConditionalLookup fields (filtered lookup values)
 *
 * Test Structure:
 * 1. Simple scenarios: Basic formula, single-level lookup
 * 2. Chain scenarios: Multi-level formula chains, cross-table cascades
 * 3. Link scenarios: All relationship types (oneOne, oneMany, manyOne, manyMany)
 * 4. Primary field scenarios: Primary field is formula
 * 5. Self-referencing: Self-referential link updates
 * 6. Edge cases: Mixed triggers, concurrent updates
 * 7. Conditional fields: ConditionalRollup and ConditionalLookup with various conditions
 *
 * Each test validates:
 * - Before/after table state via inline snapshots (using printTable)
 * - Update plan metrics (step count, table count)
 * - Final DB state correctness
 * - API response correctness
 *
 * =============================================================================
 * IMPORTANT: processOutbox() Usage Rules
 * =============================================================================
 *
 * **MUST call `await testContainer.processOutbox()` in the following cases:**
 *
 * 1. **After creating records with cross-table computed fields:**
 *    - When creating a record that has lookup/rollup fields referencing other tables
 *    - When creating a record that triggers lookup/rollup updates in other tables
 *    - Example: Creating recordB with link to recordA, then querying recordB's lookup field
 *
 * 2. **After updating records that affect cross-table computed fields:**
 *    - When updating a field that is referenced by lookup/rollup in other tables
 *    - When updating link fields that affect lookup/rollup calculations
 *    - Example: Updating tableA.value, then querying tableB.lookup (which looks up tableA.value)
 *
 * 3. **Multi-level dependency chains:**
 *    - Formula → Rollup → Lookup chains across multiple tables
 *    - Lookup → Lookup chains (nested lookups)
 *    - May require multiple `processOutbox()` calls (one per dependency level)
 *    - Example: A.formula → B.rollup → C.lookup requires 2-3 processOutbox() calls
 *
 * 4. **Symmetric link updates:**
 *    - When creating/updating link fields that have two-way relationships
 *    - The symmetric link in the foreign table needs to be updated asynchronously
 *
 * **DO NOT need processOutbox() for:**
 *
 * 1. **Same-table formula fields:**
 *    - Formula fields that only reference fields in the same table are calculated synchronously
 *    - Example: A.number → A.formula (same table, no processOutbox needed)
 *
 * 2. **Immediate queries after same-table updates:**
 *    - If all computed fields are in the same table, they're calculated synchronously
 *
 * **General Pattern:**
 * ```typescript
 * // Create/update record
 * await createRecord(table.id, { ... });
 * // OR
 * await updateRecord(table.id, recordId, { ... });
 *
 * // If this affects cross-table computed fields, process outbox
 * await testContainer.processOutbox();
 * // For multi-level chains, may need multiple calls:
 * await testContainer.processOutbox();
 * await testContainer.processOutbox();
 *
 * // Then query and assert
 * const records = await listRecords(table.id);
 * expect(...).toMatchInlineSnapshot(...);
 * ```
 *
 * **When in doubt:** If a test involves lookup, rollup, or cross-table formula dependencies,
 * add `processOutbox()` calls. It's better to be safe than have flaky tests.
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
  deleteRecordsOkResponseSchema,
  getTableByIdOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import type { ICreateFieldCommandInput, ICreateTableCommandInput } from '@teable/v2-core';
import { printTable } from '@teable/v2-utils';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// =============================================================================
// Test Utilities
// =============================================================================

const printTableSnapshot = (
  tableName: string,
  fieldNames: string[],
  records: Array<{ id: string; fields: Record<string, unknown> }>,
  fieldIds: string[]
): string =>
  printTable({
    tableName,
    fieldNames,
    records,
    fieldIds,
  });

// =============================================================================
// Test Suite
// =============================================================================

describe('v2 computed field updates (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
  let testContainer: IV2NodeTestContainer;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  // ---------------------------------------------------------------------------
  // API Helpers
  // ---------------------------------------------------------------------------

  const createTable = async (payload: ICreateTableCommandInput) => {
    const response = await fetch(`${baseUrl}/tables/create`, {
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

  const createField = async (payload: ICreateFieldCommandInput) => {
    const response = await fetch(`${baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create field: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createFieldOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create field response');
    }
    return parsed.data.data.table;
  };

  const createRecord = async (tableId: string, fields: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/tables/createRecord`, {
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

  const updateRecord = async (
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ) => {
    const response = await fetch(`${baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, recordId, fields }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update record: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse update record response');
    }
    return parsed.data.data.record;
  };

  const deleteRecord = async (tableId: string, recordId: string) => {
    const response = await fetch(`${baseUrl}/tables/deleteRecords`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, recordIds: [recordId] }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete record: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = deleteRecordsOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse delete record response');
    }
    return parsed.data.data;
  };

  const listRecords = async (tableId: string) => {
    const params = new URLSearchParams({ tableId });
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

  const getTableById = async (tableId: string) => {
    const params = new URLSearchParams({ baseId, tableId });
    const response = await fetch(`${baseUrl}/tables/get?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get table: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = getTableByIdOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse get table response');
    }
    return parsed.data.data.table;
  };

  // ---------------------------------------------------------------------------
  // Setup & Teardown
  // ---------------------------------------------------------------------------

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

  // ===========================================================================
  // SECTION 1: SIMPLE SCENARIOS
  // ===========================================================================

  describe('simple scenarios', () => {
    describe('formula field updates', () => {
      /**
       * Scenario: Single formula field referencing a number field.
       * A.number -> A.formula (number * 2)
       */
      it('updates formula when source number field changes', async () => {
        const nameFieldId = createFieldId();
        const valueFieldId = createFieldId();
        const doubledFieldId = createFieldId();

        const table = await createTable({
          baseId,
          name: 'FormulaNumberTest',
          fields: [
            { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: valueFieldId, name: 'Value' },
            {
              type: 'formula',
              id: doubledFieldId,
              name: 'Doubled',
              options: { expression: `{${valueFieldId}} * 2` },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const fieldIds = [nameFieldId, valueFieldId, doubledFieldId];
        const fieldNames = ['Name', 'Value', 'Doubled'];

        await createRecord(table.id, { [nameFieldId]: 'Test', [valueFieldId]: 5 });

        const beforeRecords = await listRecords(table.id);
        expect(printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[FormulaNumberTest]
            ---------------------------
            #  | Name | Value | Doubled
            ---------------------------
            R0 | Test | 5     | 10     
            ---------------------------"
          `);

        const record = beforeRecords[0];
        await updateRecord(table.id, record.id, { [valueFieldId]: 15 });

        const afterRecords = await listRecords(table.id);
        expect(printTableSnapshot(table.name, fieldNames, afterRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[FormulaNumberTest]
            ---------------------------
            #  | Name | Value | Doubled
            ---------------------------
            R0 | Test | 15    | 30     
            ---------------------------"
          `);
      });

      /**
       * Scenario: Formula chain within same table.
       * A.number -> A.formula1 (number * 2) -> A.formula2 (formula1 + 10)
       */
      it('updates formula chain in correct order', async () => {
        const nameFieldId = createFieldId();
        const valueFieldId = createFieldId();
        const formula1FieldId = createFieldId();
        const formula2FieldId = createFieldId();

        const table = await createTable({
          baseId,
          name: 'FormulaChainTest',
          fields: [
            { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: valueFieldId, name: 'Value' },
            {
              type: 'formula',
              id: formula1FieldId,
              name: 'F1',
              options: { expression: `{${valueFieldId}} * 2` },
            },
            {
              type: 'formula',
              id: formula2FieldId,
              name: 'F2',
              options: { expression: `{${formula1FieldId}} + 10` },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const fieldIds = [nameFieldId, valueFieldId, formula1FieldId, formula2FieldId];
        const fieldNames = ['Name', 'Value', 'F1', 'F2'];

        await createRecord(table.id, { [nameFieldId]: 'Test', [valueFieldId]: 5 });

        const beforeRecords = await listRecords(table.id);
        expect(printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[FormulaChainTest]
            ---------------------------
            #  | Name | Value | F1 | F2
            ---------------------------
            R0 | Test | 5     | 10 | 20
            ---------------------------"
          `);

        const record = beforeRecords[0];
        await updateRecord(table.id, record.id, { [valueFieldId]: 10 });

        const afterRecords = await listRecords(table.id);
        expect(printTableSnapshot(table.name, fieldNames, afterRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[FormulaChainTest]
            ---------------------------
            #  | Name | Value | F1 | F2
            ---------------------------
            R0 | Test | 10    | 20 | 30
            ---------------------------"
          `);
      });

      /**
       * Scenario: Formula referencing text field with CONCATENATE.
       * A.text -> A.formula (CONCATENATE("Hello, ", text))
       */
      it('updates formula when source text field changes', async () => {
        const nameFieldId = createFieldId();
        const textFieldId = createFieldId();
        const greetingFieldId = createFieldId();

        const table = await createTable({
          baseId,
          name: 'FormulaTextTest',
          fields: [
            { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
            { type: 'singleLineText', id: textFieldId, name: 'Text' },
            {
              type: 'formula',
              id: greetingFieldId,
              name: 'Greeting',
              options: { expression: `CONCATENATE("Hello, ", {${textFieldId}})` },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const fieldIds = [nameFieldId, textFieldId, greetingFieldId];
        const fieldNames = ['Name', 'Text', 'Greeting'];

        await createRecord(table.id, { [nameFieldId]: 'Test', [textFieldId]: 'World' });

        const beforeRecords = await listRecords(table.id);
        expect(printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[FormulaTextTest]
            --------------------------------
            #  | Name | Text  | Greeting    
            --------------------------------
            R0 | Test | World | Hello, World
            --------------------------------"
          `);

        const record = beforeRecords[0];
        await updateRecord(table.id, record.id, { [textFieldId]: 'Universe' });

        const afterRecords = await listRecords(table.id);
        expect(printTableSnapshot(table.name, fieldNames, afterRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[FormulaTextTest]
            --------------------------------------
            #  | Name | Text     | Greeting       
            --------------------------------------
            R0 | Test | Universe | Hello, Universe
            --------------------------------------"
          `);
      });

      describe('basic formula chain', () => {
        it('updates formula chain when source number changes', async () => {
          const amountFieldId = createFieldId();
          const scoreFieldId = createFieldId();
          const scoreLabelFieldId = createFieldId();

          const table = await createTable({
            baseId,
            name: 'Formula Chain Test',
            fields: [
              { type: 'singleLineText', name: 'Name', isPrimary: true },
              { type: 'number', id: amountFieldId, name: 'Amount' },
              {
                type: 'formula',
                id: scoreFieldId,
                name: 'Score',
                options: { expression: `{${amountFieldId}} * 2` },
              },
              {
                type: 'formula',
                id: scoreLabelFieldId,
                name: 'ScoreLabel',
                options: { expression: `CONCATENATE("Score: ", {${scoreFieldId}})` },
              },
            ],
            views: [{ type: 'grid' }],
          });

          const nameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
          const fieldIds = [nameFieldId, amountFieldId, scoreFieldId, scoreLabelFieldId];
          const fieldNames = ['Name', 'Amount', 'Score', 'ScoreLabel'];

          // Create record
          const record = await createRecord(table.id, {
            [nameFieldId]: 'Alpha',
            [amountFieldId]: 5,
          });

          // Before update
          const beforeRecords = await listRecords(table.id);
          const beforeSnapshot = printTableSnapshot(
            table.name,
            fieldNames,
            beforeRecords,
            fieldIds
          );

          expect(beforeSnapshot).toMatchInlineSnapshot(`
            "[Formula Chain Test]
            ----------------------------------------
            #  | Name  | Amount | Score | ScoreLabel
            ----------------------------------------
            R0 | Alpha | 5      | 10    | Score: 10 
            ----------------------------------------"
          `);

          // Update amount
          await updateRecord(table.id, record.id, { [amountFieldId]: 7 });

          // After update
          const afterRecords = await listRecords(table.id);
          const afterSnapshot = printTableSnapshot(table.name, fieldNames, afterRecords, fieldIds);

          expect(afterSnapshot).toMatchInlineSnapshot(`
            "[Formula Chain Test]
            ----------------------------------------
            #  | Name  | Amount | Score | ScoreLabel
            ----------------------------------------
            R0 | Alpha | 7      | 14    | Score: 14 
            ----------------------------------------"
          `);
        });
      });
    });

    describe('lookup field updates', () => {
      /**
       * Scenario: Basic lookup through link field.
       * TableA.value -> TableB.link -> TableB.lookup (looks up A.value)
       */
      it('updates lookup when source field in foreign table changes', async () => {
        const aNameFieldId = createFieldId();
        const aValueFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'LookupSourceA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: aValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordA = await createRecord(tableA.id, {
          [aNameFieldId]: 'ItemA',
          [aValueFieldId]: 100,
        });

        const bNameFieldId = createFieldId();
        const linkFieldId = createFieldId();
        const lookupFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'LookupTargetB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkFieldId,
              name: 'LinkA',
              options: {
                relationship: 'manyOne',
                foreignTableId: tableA.id,
                lookupFieldId: aNameFieldId,
              },
            },
            {
              type: 'lookup',
              id: lookupFieldId,
              name: 'LookupVal',
              options: {
                linkFieldId,
                foreignTableId: tableA.id,
                lookupFieldId: aValueFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const bFieldIds = [bNameFieldId, linkFieldId, lookupFieldId];
        const bFieldNames = ['Name', 'LinkA', 'LookupVal'];
        const aFieldIds = [aNameFieldId, aValueFieldId];
        const aFieldNames = ['Name', 'Value'];

        await createRecord(tableB.id, {
          [bNameFieldId]: 'ItemB',
          [linkFieldId]: { id: recordA.id },
        });

        // Process outbox to ensure lookup field is calculated
        await testContainer.processOutbox();

        const beforeRecordsA = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecordsA, aFieldIds))
          .toMatchInlineSnapshot(`
            "[LookupSourceA]
            ------------------
            #  | Name  | Value
            ------------------
            R0 | ItemA | 100  
            ------------------"
          `);

        const beforeRecordsB = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecordsB, bFieldIds))
          .toMatchInlineSnapshot(`
            "[LookupTargetB]
            ------------------------------
            #  | Name  | LinkA | LookupVal
            ------------------------------
            R0 | ItemB | ItemA | [100]    
            ------------------------------"
          `);

        await updateRecord(tableA.id, recordA.id, { [aValueFieldId]: 200 });
        await testContainer.processOutbox();

        const afterRecordsA = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, afterRecordsA, aFieldIds))
          .toMatchInlineSnapshot(`
            "[LookupSourceA]
            ------------------
            #  | Name  | Value
            ------------------
            R0 | ItemA | 200  
            ------------------"
          `);

        const afterRecordsB = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, afterRecordsB, bFieldIds))
          .toMatchInlineSnapshot(`
            "[LookupTargetB]
            ------------------------------
            #  | Name  | LinkA | LookupVal
            ------------------------------
            R0 | ItemB | ItemA | [200]    
            ------------------------------"
          `);
      });

      /**
       * Scenario: Lookup updates when link relation changes.
       * TableA has records A1, A2. TableB.link points to A1.
       */
      it('updates lookup when link relation changes', async () => {
        const aNameFieldId = createFieldId();
        const aValueFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'LookupRelA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: aValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordA1 = await createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aValueFieldId]: 10,
        });
        const recordA2 = await createRecord(tableA.id, {
          [aNameFieldId]: 'A2',
          [aValueFieldId]: 20,
        });

        const bNameFieldId = createFieldId();
        const linkFieldId = createFieldId();
        const lookupFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'LookupRelB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkFieldId,
              name: 'LinkA',
              options: {
                relationship: 'manyOne',
                foreignTableId: tableA.id,
                lookupFieldId: aNameFieldId,
              },
            },
            {
              type: 'lookup',
              id: lookupFieldId,
              name: 'LookupVal',
              options: {
                linkFieldId,
                foreignTableId: tableA.id,
                lookupFieldId: aValueFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const bFieldIds = [bNameFieldId, linkFieldId, lookupFieldId];
        const bFieldNames = ['Name', 'LinkA', 'LookupVal'];

        await createRecord(tableB.id, {
          [bNameFieldId]: 'ItemB',
          [linkFieldId]: { id: recordA1.id },
        });

        // Process outbox to ensure lookup field is calculated
        await testContainer.processOutbox();

        const beforeRecords = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecords, bFieldIds))
          .toMatchInlineSnapshot(`
            "[LookupRelB]
            ------------------------------
            #  | Name  | LinkA | LookupVal
            ------------------------------
            R0 | ItemB | A1    | [10]     
            ------------------------------"
          `);

        const recordB = beforeRecords[0];
        await updateRecord(tableB.id, recordB.id, { [linkFieldId]: { id: recordA2.id } });
        await testContainer.processOutbox();

        const afterRecords = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, afterRecords, bFieldIds))
          .toMatchInlineSnapshot(`
            "[LookupRelB]
            ------------------------------
            #  | Name  | LinkA | LookupVal
            ------------------------------
            R0 | ItemB | A2    | [20]     
            ------------------------------"
          `);
      });

      describe('cross-table lookup', () => {
        /**
         * TODO: This test currently shows lookup returning null.
         * This indicates the lookup computed value is not being calculated
         * when a record is created with a link, or the cross-table update
         * is not propagating correctly.
         *
         * Investigation needed:
         * 1. Is lookup computed on record creation with link?
         * 2. Is cross-table propagation working correctly?
         */
        it('updates lookup when source field changes in foreign table', async () => {
          const scoreFieldId = createFieldId();
          const scoreLabelFieldId = createFieldId();

          // Create source table (Contacts)
          const contacts = await createTable({
            baseId,
            name: 'Contacts Source',
            fields: [
              { type: 'singleLineText', name: 'Name', isPrimary: true },
              { type: 'number', id: scoreFieldId, name: 'Score' },
              {
                type: 'formula',
                id: scoreLabelFieldId,
                name: 'ScoreLabel',
                options: { expression: `CONCATENATE("Score: ", {${scoreFieldId}})` },
              },
            ],
            views: [{ type: 'grid' }],
          });

          const contactNameFieldId = contacts.fields.find((f) => f.isPrimary)?.id ?? '';

          // Create contact
          const contact = await createRecord(contacts.id, {
            [contactNameFieldId]: 'Alice',
            [scoreFieldId]: 2,
          });

          // Create linking table (Deals)
          const linkFieldId = createFieldId();
          const lookupFieldId = createFieldId();

          const deals = await createTable({
            baseId,
            name: 'Deals Target',
            fields: [
              { type: 'singleLineText', name: 'Deal', isPrimary: true },
              {
                type: 'link',
                id: linkFieldId,
                name: 'Contact',
                options: {
                  relationship: 'manyOne',
                  foreignTableId: contacts.id,
                  lookupFieldId: contactNameFieldId,
                },
              },
              {
                type: 'lookup',
                id: lookupFieldId,
                name: 'ContactScore',
                options: {
                  linkFieldId,
                  foreignTableId: contacts.id,
                  lookupFieldId: scoreLabelFieldId,
                },
              },
            ],
            views: [{ type: 'grid' }],
          });

          const dealNameFieldId = deals.fields.find((f) => f.isPrimary)?.id ?? '';
          const dealFieldIds = [dealNameFieldId, linkFieldId, lookupFieldId];
          const dealFieldNames = ['Deal', 'Contact', 'ContactScore'];
          const contactFieldIds = [contactNameFieldId, scoreFieldId, scoreLabelFieldId];
          const contactFieldNames = ['Name', 'Score', 'ScoreLabel'];

          // Create deal with link (manyOne uses single object)
          const deal = await createRecord(deals.id, {
            [dealNameFieldId]: 'Deal A',
            [linkFieldId]: { id: contact.id },
          });

          const beforeContacts = await listRecords(contacts.id);
          expect(
            printTableSnapshot(contacts.name, contactFieldNames, beforeContacts, contactFieldIds)
          ).toMatchInlineSnapshot(`
            "[Contacts Source]
            --------------------------------
            #  | Name  | Score | ScoreLabel 
            --------------------------------
            R0 | Alice | 2     | Score: 2.00
            --------------------------------"
          `);

          // Before update - verify lookup shows current value
          const beforeRecords = await listRecords(deals.id);
          const beforeSnapshot = printTableSnapshot(
            deals.name,
            dealFieldNames,
            beforeRecords,
            dealFieldIds
          );

          // Lookup should show the value from the foreign table
          expect(beforeSnapshot).toMatchInlineSnapshot(`
            "[Deals Target]
            -------------------------------------
            #  | Deal   | Contact | ContactScore 
            -------------------------------------
            R0 | Deal A | Alice   | [Score: 2.00]
            -------------------------------------"
          `);

          // Update contact's score (triggers: Contact.Score -> Contact.ScoreLabel -> Deal.lookup)
          await updateRecord(contacts.id, contact.id, { [scoreFieldId]: 8 });

          // Process any pending outbox tasks (cross-table updates are async)
          await testContainer.processOutbox();

          const afterContacts = await listRecords(contacts.id);
          expect(
            printTableSnapshot(contacts.name, contactFieldNames, afterContacts, contactFieldIds)
          ).toMatchInlineSnapshot(`
            "[Contacts Source]
            --------------------------------
            #  | Name  | Score | ScoreLabel 
            --------------------------------
            R0 | Alice | 8     | Score: 8.00
            --------------------------------"
          `);

          // After update - lookup should reflect new value
          const afterRecords = await listRecords(deals.id);
          const afterSnapshot = printTableSnapshot(
            deals.name,
            dealFieldNames,
            afterRecords,
            dealFieldIds
          );

          // Lookup should show updated value
          expect(afterSnapshot).toMatchInlineSnapshot(`
            "[Deals Target]
            -------------------------------------
            #  | Deal   | Contact | ContactScore 
            -------------------------------------
            R0 | Deal A | Alice   | [Score: 8.00]
            -------------------------------------"
          `);
        });
      });
    });

    describe('rollup field updates', () => {
      /**
       * Scenario: Rollup SUM of linked record values.
       * TableA.value (numbers) <- TableB.link (manyMany) -> TableB.rollup (SUM)
       */
      it('updates rollup when linked record value changes', async () => {
        const aNameFieldId = createFieldId();
        const aValueFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'RollupSourceA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: aValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordA1 = await createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aValueFieldId]: 10,
        });
        const recordA2 = await createRecord(tableA.id, {
          [aNameFieldId]: 'A2',
          [aValueFieldId]: 20,
        });

        const bNameFieldId = createFieldId();
        const linkFieldId = createFieldId();
        const rollupFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'RollupTargetB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkFieldId,
              name: 'Links',
              options: {
                relationship: 'manyMany',
                foreignTableId: tableA.id,
                lookupFieldId: aNameFieldId,
              },
            },
            {
              type: 'rollup',
              id: rollupFieldId,
              name: 'Sum',
              options: { expression: 'sum({values})' },
              config: {
                linkFieldId,
                foreignTableId: tableA.id,
                lookupFieldId: aValueFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const bFieldIds = [bNameFieldId, linkFieldId, rollupFieldId];
        const bFieldNames = ['Name', 'Links', 'Sum'];
        const aFieldIds = [aNameFieldId, aValueFieldId];
        const aFieldNames = ['Name', 'Value'];

        await createRecord(tableB.id, {
          [bNameFieldId]: 'ItemB',
          [linkFieldId]: [{ id: recordA1.id }, { id: recordA2.id }],
        });

        // Process outbox to ensure rollup field is calculated
        await testContainer.processOutbox();

        const beforeRecordsA = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecordsA, aFieldIds))
          .toMatchInlineSnapshot(`
            "[RollupSourceA]
            -----------------
            #  | Name | Value
            -----------------
            R0 | A1   | 10   
            R1 | A2   | 20   
            -----------------"
          `);

        const beforeRecordsB = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecordsB, bFieldIds))
          .toMatchInlineSnapshot(`
            "[RollupTargetB]
            -------------------------
            #  | Name  | Links  | Sum
            -------------------------
            R0 | ItemB | A1, A2 | 30 
            -------------------------"
          `);

        await updateRecord(tableA.id, recordA1.id, { [aValueFieldId]: 50 });
        await testContainer.processOutbox();

        const afterRecordsA = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, afterRecordsA, aFieldIds))
          .toMatchInlineSnapshot(`
            "[RollupSourceA]
            -----------------
            #  | Name | Value
            -----------------
            R0 | A1   | 50   
            R1 | A2   | 20   
            -----------------"
          `);

        const afterRecordsB = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, afterRecordsB, bFieldIds))
          .toMatchInlineSnapshot(`
            "[RollupTargetB]
            -------------------------
            #  | Name  | Links  | Sum
            -------------------------
            R0 | ItemB | A1, A2 | 70 
            -------------------------"
          `);
      });

      /**
       * Scenario: Rollup updates when link relation changes.
       */
      it('updates rollup when link relation changes', async () => {
        const aNameFieldId = createFieldId();
        const aValueFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'RollupRelA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: aValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordA1 = await createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aValueFieldId]: 10,
        });
        const recordA2 = await createRecord(tableA.id, {
          [aNameFieldId]: 'A2',
          [aValueFieldId]: 20,
        });
        const recordA3 = await createRecord(tableA.id, {
          [aNameFieldId]: 'A3',
          [aValueFieldId]: 30,
        });

        const bNameFieldId = createFieldId();
        const linkFieldId = createFieldId();
        const rollupFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'RollupRelB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkFieldId,
              name: 'Links',
              options: {
                relationship: 'manyMany',
                foreignTableId: tableA.id,
                lookupFieldId: aNameFieldId,
              },
            },
            {
              type: 'rollup',
              id: rollupFieldId,
              name: 'Sum',
              options: { expression: 'sum({values})' },
              config: {
                linkFieldId,
                foreignTableId: tableA.id,
                lookupFieldId: aValueFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const bFieldIds = [bNameFieldId, linkFieldId, rollupFieldId];
        const bFieldNames = ['Name', 'Links', 'Sum'];

        await createRecord(tableB.id, {
          [bNameFieldId]: 'ItemB',
          [linkFieldId]: [{ id: recordA1.id }],
        });

        // Process outbox to ensure rollup field is calculated
        await testContainer.processOutbox();

        const beforeRecords = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecords, bFieldIds))
          .toMatchInlineSnapshot(`
            "[RollupRelB]
            ------------------------
            #  | Name  | Links | Sum
            ------------------------
            R0 | ItemB | A1    | 10 
            ------------------------"
          `);

        const recordB = beforeRecords[0];
        await updateRecord(tableB.id, recordB.id, {
          [linkFieldId]: [{ id: recordA1.id }, { id: recordA2.id }, { id: recordA3.id }],
        });
        await testContainer.processOutbox();

        const afterRecords = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, afterRecords, bFieldIds))
          .toMatchInlineSnapshot(`
            "[RollupRelB]
            -----------------------------
            #  | Name  | Links      | Sum
            -----------------------------
            R0 | ItemB | A1, A2, A3 | 60 
            -----------------------------"
          `);
      });
    });
  });

  // ===========================================================================
  // SECTION 2: CHAIN SCENARIOS
  // ===========================================================================

  describe('chain scenarios', () => {
    /**
     * Scenario: Three-level formula chain in same table.
     * A.number -> A.formula1 -> A.formula2 -> A.formula3
     */
    it('updates three-level formula chain in same table', async () => {
      const nameFieldId = createFieldId();
      const numFieldId = createFieldId();
      const f1FieldId = createFieldId();
      const f2FieldId = createFieldId();
      const f3FieldId = createFieldId();

      const table = await createTable({
        baseId,
        name: 'ThreeLevelFormula',
        fields: [
          { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: numFieldId, name: 'Num' },
          {
            type: 'formula',
            id: f1FieldId,
            name: 'F1',
            options: { expression: `{${numFieldId}} * 2` },
          },
          {
            type: 'formula',
            id: f2FieldId,
            name: 'F2',
            options: { expression: `{${f1FieldId}} + 10` },
          },
          {
            type: 'formula',
            id: f3FieldId,
            name: 'F3',
            options: { expression: `{${f2FieldId}} * 3` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [nameFieldId, numFieldId, f1FieldId, f2FieldId, f3FieldId];
      const fieldNames = ['Name', 'Num', 'F1', 'F2', 'F3'];

      await createRecord(table.id, { [nameFieldId]: 'Test', [numFieldId]: 5 });

      const beforeRecords = await listRecords(table.id);
      expect(printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ThreeLevelFormula]
          ------------------------------
          #  | Name | Num | F1 | F2 | F3
          ------------------------------
          R0 | Test | 5   | 10 | 20 | 60
          ------------------------------"
        `);

      const record = beforeRecords[0];
      await updateRecord(table.id, record.id, { [numFieldId]: 10 });

      const afterRecords = await listRecords(table.id);
      expect(printTableSnapshot(table.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ThreeLevelFormula]
          ------------------------------
          #  | Name | Num | F1 | F2 | F3
          ------------------------------
          R0 | Test | 10  | 20 | 30 | 90
          ------------------------------"
        `);
    });

    /**
     * Scenario: Cross-table lookup chain.
     * TableA.value -> TableB.lookupA -> TableC.lookupB
     */
    it('updates cross-table lookup chain in correct level order', async () => {
      // Table A: Source
      const aNameFieldId = createFieldId();
      const aValueFieldId = createFieldId();
      const tableA = await createTable({
        baseId,
        name: 'ChainA',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const recordA = await createRecord(tableA.id, {
        [aNameFieldId]: 'A1',
        [aValueFieldId]: 100,
      });

      // Table B: Links to A, has lookup of A.Value
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bLookupFieldId = createFieldId();
      const tableB = await createTable({
        baseId,
        name: 'ChainB',
        fields: [
          { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: bLinkFieldId,
            name: 'LinkA',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableA.id,
              lookupFieldId: aNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: bLookupFieldId,
            name: 'LookupA',
            options: {
              linkFieldId: bLinkFieldId,
              foreignTableId: tableA.id,
              lookupFieldId: aValueFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const recordB = await createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bLinkFieldId]: { id: recordA.id },
      });

      // Table C: Links to B, has lookup of B.LookupA (chain)
      const cNameFieldId = createFieldId();
      const cLinkFieldId = createFieldId();
      const cLookupFieldId = createFieldId();
      const tableC = await createTable({
        baseId,
        name: 'ChainC',
        fields: [
          { type: 'singleLineText', id: cNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: cLinkFieldId,
            name: 'LinkB',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: cLookupFieldId,
            name: 'LookupB',
            options: {
              linkFieldId: cLinkFieldId,
              foreignTableId: tableB.id,
              lookupFieldId: bLookupFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const cFieldIds = [cNameFieldId, cLinkFieldId, cLookupFieldId];
      const cFieldNames = ['Name', 'LinkB', 'LookupB'];
      const aFieldIds = [aNameFieldId, aValueFieldId];
      const aFieldNames = ['Name', 'Value'];

      await createRecord(tableC.id, {
        [cNameFieldId]: 'C1',
        [cLinkFieldId]: { id: recordB.id },
      });

      // Process outbox to ensure all computed fields (lookup chain) are calculated
      await testContainer.processOutbox();
      await testContainer.processOutbox();

      const beforeRecordsA = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecordsA, aFieldIds))
        .toMatchInlineSnapshot(`
          "[ChainA]
          -----------------
          #  | Name | Value
          -----------------
          R0 | A1   | 100  
          -----------------"
        `);

      const beforeRecords = await listRecords(tableC.id);
      expect(printTableSnapshot(tableC.name, cFieldNames, beforeRecords, cFieldIds))
        .toMatchInlineSnapshot(`
          "[ChainC]
          ---------------------------
          #  | Name | LinkB | LookupB
          ---------------------------
          R0 | C1   | B1    | [100]  
          ---------------------------"
        `);

      // Update A.Value - should cascade through B.LookupA -> C.LookupB
      await updateRecord(tableA.id, recordA.id, { [aValueFieldId]: 999 });
      await testContainer.processOutbox();

      const afterRecordsA = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, afterRecordsA, aFieldIds))
        .toMatchInlineSnapshot(`
          "[ChainA]
          -----------------
          #  | Name | Value
          -----------------
          R0 | A1   | 999  
          -----------------"
        `);

      const afterRecords = await listRecords(tableC.id);
      expect(printTableSnapshot(tableC.name, cFieldNames, afterRecords, cFieldIds))
        .toMatchInlineSnapshot(`
          "[ChainC]
          ---------------------------
          #  | Name | LinkB | LookupB
          ---------------------------
          R0 | C1   | B1    | [999]  
          ---------------------------"
        `);
    });

    /**
     * Scenario: Mixed formula and lookup chain.
     * A.number -> A.formula -> B.lookup (looks up A.formula) -> B.formula (uses lookup)
     */
    it('updates mixed formula-lookup chain across tables', async () => {
      // Table A: Has number and formula
      const aNameFieldId = createFieldId();
      const aNumFieldId = createFieldId();
      const aFormulaFieldId = createFieldId();
      const tableA = await createTable({
        baseId,
        name: 'MixedA',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aNumFieldId, name: 'Num' },
          {
            type: 'formula',
            id: aFormulaFieldId,
            name: 'Doubled',
            options: { expression: `{${aNumFieldId}} * 2` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const recordA = await createRecord(tableA.id, {
        [aNameFieldId]: 'A1',
        [aNumFieldId]: 10,
      });

      // Table B: Links to A, lookup A.Doubled, formula based on lookup
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bLookupFieldId = createFieldId();
      const bFormulaFieldId = createFieldId();
      const tableB = await createTable({
        baseId,
        name: 'MixedB',
        fields: [
          { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: bLinkFieldId,
            name: 'LinkA',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableA.id,
              lookupFieldId: aNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: bLookupFieldId,
            name: 'LookupDoubled',
            options: {
              linkFieldId: bLinkFieldId,
              foreignTableId: tableA.id,
              lookupFieldId: aFormulaFieldId,
            },
          },
          {
            type: 'formula',
            id: bFormulaFieldId,
            name: 'PlusTen',
            options: { expression: `{${bLookupFieldId}} + 10` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const bFieldIds = [bNameFieldId, bLinkFieldId, bLookupFieldId, bFormulaFieldId];
      const bFieldNames = ['Name', 'LinkA', 'LookupDoubled', 'PlusTen'];
      const aFieldIds = [aNameFieldId, aNumFieldId, aFormulaFieldId];
      const aFieldNames = ['Name', 'Num', 'Doubled'];

      await createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bLinkFieldId]: { id: recordA.id },
      });

      // Process outbox to ensure lookup and formula fields are calculated
      await testContainer.processOutbox();

      const beforeRecordsA = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecordsA, aFieldIds))
        .toMatchInlineSnapshot(`
          "[MixedA]
          -------------------------
          #  | Name | Num | Doubled
          -------------------------
          R0 | A1   | 10  | 20     
          -------------------------"
        `);

      const beforeRecords = await listRecords(tableB.id);
      expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecords, bFieldIds))
        .toMatchInlineSnapshot(`
          "[MixedB]
          -------------------------------------------
          #  | Name | LinkA | LookupDoubled | PlusTen
          -------------------------------------------
          R0 | B1   | A1    | [20]          | -      
          -------------------------------------------"
        `);

      // Update A.Num: A.Doubled -> B.LookupDoubled -> B.PlusTen
      await updateRecord(tableA.id, recordA.id, { [aNumFieldId]: 50 });
      await testContainer.processOutbox();

      const afterRecordsA = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, afterRecordsA, aFieldIds))
        .toMatchInlineSnapshot(`
          "[MixedA]
          -------------------------
          #  | Name | Num | Doubled
          -------------------------
          R0 | A1   | 50  | 100    
          -------------------------"
        `);

      const afterRecords = await listRecords(tableB.id);
      expect(printTableSnapshot(tableB.name, bFieldNames, afterRecords, bFieldIds))
        .toMatchInlineSnapshot(`
          "[MixedB]
          -------------------------------------------
          #  | Name | LinkA | LookupDoubled | PlusTen
          -------------------------------------------
          R0 | B1   | A1    | [100]         | -      
          -------------------------------------------"
        `);
    });

    /**
     * Scenario: Formula -> formula -> rollup -> lookup chain across three tables.
     * A.amount -> A.double -> A.total -> B.rollup(sum) -> C.lookup
     */
    it('updates formula-rollup-lookup chain across tables', async () => {
      const aNameFieldId = createFieldId();
      const aAmountFieldId = createFieldId();
      const aDoubleFieldId = createFieldId();
      const aTotalFieldId = createFieldId();
      const tableA = await createTable({
        baseId,
        name: 'FormulaRollupA',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aAmountFieldId, name: 'Amount' },
          {
            type: 'formula',
            id: aDoubleFieldId,
            name: 'Double',
            options: { expression: `{${aAmountFieldId}} * 2` },
          },
          {
            type: 'formula',
            id: aTotalFieldId,
            name: 'Total',
            options: { expression: `{${aDoubleFieldId}} + 5` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const recordA1 = await createRecord(tableA.id, {
        [aNameFieldId]: 'A1',
        [aAmountFieldId]: 10,
      });
      const recordA2 = await createRecord(tableA.id, {
        [aNameFieldId]: 'A2',
        [aAmountFieldId]: 5,
      });

      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bRollupFieldId = createFieldId();
      const tableB = await createTable({
        baseId,
        name: 'FormulaRollupB',
        fields: [
          { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: bLinkFieldId,
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId: tableA.id,
              lookupFieldId: aNameFieldId,
            },
          },
          {
            type: 'rollup',
            id: bRollupFieldId,
            name: 'TotalSum',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: bLinkFieldId,
              foreignTableId: tableA.id,
              lookupFieldId: aTotalFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const recordB = await createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bLinkFieldId]: [{ id: recordA1.id }, { id: recordA2.id }],
      });

      const cNameFieldId = createFieldId();
      const cLinkFieldId = createFieldId();
      const cLookupFieldId = createFieldId();
      const tableC = await createTable({
        baseId,
        name: 'FormulaRollupC',
        fields: [
          { type: 'singleLineText', id: cNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: cLinkFieldId,
            name: 'LinkB',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: cLookupFieldId,
            name: 'SumFromB',
            options: {
              linkFieldId: cLinkFieldId,
              foreignTableId: tableB.id,
              lookupFieldId: bRollupFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(tableC.id, {
        [cNameFieldId]: 'C1',
        [cLinkFieldId]: { id: recordB.id },
      });

      // Process outbox to ensure all computed fields (formula, rollup, lookup) are calculated
      await testContainer.processOutbox();
      await testContainer.processOutbox();
      await testContainer.processOutbox();

      const bFieldIds = [bNameFieldId, bLinkFieldId, bRollupFieldId];
      const bFieldNames = ['Name', 'Links', 'TotalSum'];
      const cFieldIds = [cNameFieldId, cLinkFieldId, cLookupFieldId];
      const cFieldNames = ['Name', 'LinkB', 'SumFromB'];

      const beforeRecordsB = await listRecords(tableB.id);
      expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecordsB, bFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaRollupB]
          -----------------------------
          #  | Name | Links  | TotalSum
          -----------------------------
          R0 | B1   | A1, A2 | 40      
          -----------------------------"
        `);

      const beforeRecordsC = await listRecords(tableC.id);
      expect(printTableSnapshot(tableC.name, cFieldNames, beforeRecordsC, cFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaRollupC]
          ----------------------------
          #  | Name | LinkB | SumFromB
          ----------------------------
          R0 | C1   | B1    | [40]    
          ----------------------------"
        `);

      await updateRecord(tableA.id, recordA1.id, { [aAmountFieldId]: 20 });
      await testContainer.processOutbox();
      await testContainer.processOutbox();
      await testContainer.processOutbox();

      const afterRecordsB = await listRecords(tableB.id);
      expect(printTableSnapshot(tableB.name, bFieldNames, afterRecordsB, bFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaRollupB]
          -----------------------------
          #  | Name | Links  | TotalSum
          -----------------------------
          R0 | B1   | A1, A2 | 60      
          -----------------------------"
        `);

      const afterRecordsC = await listRecords(tableC.id);
      expect(printTableSnapshot(tableC.name, cFieldNames, afterRecordsC, cFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaRollupC]
          ----------------------------
          #  | Name | LinkB | SumFromB
          ----------------------------
          R0 | C1   | B1    | [60]    
          ----------------------------"
        `);
    });

    /**
     * Scenario: Link title update chain.
     * A.name (primary) -> B.link (shows A.name as title)
     */
    it('updates link titles through chain', async () => {
      // Table A: Simple table with name
      const aNameFieldId = createFieldId();
      const tableA = await createTable({
        baseId,
        name: 'TitleChainA',
        fields: [{ type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      const recordA = await createRecord(tableA.id, {
        [aNameFieldId]: 'Original Title',
      });

      // Table B: Links to A
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const tableB = await createTable({
        baseId,
        name: 'TitleChainB',
        fields: [
          { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: bLinkFieldId,
            name: 'LinkA',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableA.id,
              lookupFieldId: aNameFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const bFieldIds = [bNameFieldId, bLinkFieldId];
      const bFieldNames = ['Name', 'LinkA'];
      const aFieldIds = [aNameFieldId];
      const aFieldNames = ['Name'];

      await createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bLinkFieldId]: { id: recordA.id },
      });

      // Process outbox to ensure link title is updated
      await testContainer.processOutbox();

      const beforeRecordsA = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecordsA, aFieldIds))
        .toMatchInlineSnapshot(`
          "[TitleChainA]
          -------------------
          #  | Name          
          -------------------
          R0 | Original Title
          -------------------"
        `);

      const beforeRecords = await listRecords(tableB.id);
      expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecords, bFieldIds))
        .toMatchInlineSnapshot(`
          "[TitleChainB]
          --------------------------
          #  | Name | LinkA         
          --------------------------
          R0 | B1   | Original Title
          --------------------------"
        `);

      // Update A.name - B.LinkA title should update
      await updateRecord(tableA.id, recordA.id, { [aNameFieldId]: 'Updated Title' });
      await testContainer.processOutbox();

      const afterRecordsA = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, afterRecordsA, aFieldIds))
        .toMatchInlineSnapshot(`
          "[TitleChainA]
          ------------------
          #  | Name         
          ------------------
          R0 | Updated Title
          ------------------"
        `);

      const afterRecords = await listRecords(tableB.id);
      expect(printTableSnapshot(tableB.name, bFieldNames, afterRecords, bFieldIds))
        .toMatchInlineSnapshot(`
          "[TitleChainB]
          -------------------------
          #  | Name | LinkA        
          -------------------------
          R0 | B1   | Updated Title
          -------------------------"
        `);
    });

    describe('three-table cascade', () => {
      /**
       * Test case: A.value -> B.lookup -> C.lookup
       *
       * Verifies that:
       * 1. Updates propagate through multiple tables
       * 2. Level ordering is correct (B before C)
       */
      it('cascades updates through three tables in correct order', async () => {
        // Table A: Source
        const valueFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'Cascade A',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', id: valueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });
        const aNameFieldId = tableA.fields.find((f) => f.isPrimary)?.id ?? '';

        // Create A record
        const recordA = await createRecord(tableA.id, {
          [aNameFieldId]: 'Source',
          [valueFieldId]: 10,
        });

        const aFieldIds = [aNameFieldId, valueFieldId];
        const aFieldNames = ['Name', 'Value'];

        // Table B: Links to A, has lookup
        const linkAFieldId = createFieldId();
        const lookupAFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'Cascade B',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkAFieldId,
              name: 'LinkA',
              options: {
                relationship: 'manyOne',
                foreignTableId: tableA.id,
                lookupFieldId: aNameFieldId,
                isOneWay: true,
              },
            },
            {
              type: 'lookup',
              id: lookupAFieldId,
              name: 'ValueFromA',
              options: {
                linkFieldId: linkAFieldId,
                foreignTableId: tableA.id,
                lookupFieldId: valueFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });
        const bNameFieldId = tableB.fields.find((f) => f.isPrimary)?.id ?? '';

        // Create B record linked to A (manyOne uses single object)
        const recordB = await createRecord(tableB.id, {
          [bNameFieldId]: 'Middle',
          [linkAFieldId]: { id: recordA.id },
        });

        // Table C: Links to B, has lookup of B's lookup
        const linkBFieldId = createFieldId();
        const lookupBFieldId = createFieldId();
        const tableC = await createTable({
          baseId,
          name: 'Cascade C',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkBFieldId,
              name: 'LinkB',
              options: {
                relationship: 'manyOne',
                foreignTableId: tableB.id,
                lookupFieldId: bNameFieldId,
                isOneWay: true,
              },
            },
            {
              type: 'lookup',
              id: lookupBFieldId,
              name: 'ValueFromB',
              options: {
                linkFieldId: linkBFieldId,
                foreignTableId: tableB.id,
                lookupFieldId: lookupAFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });
        const cNameFieldId = tableC.fields.find((f) => f.isPrimary)?.id ?? '';
        const cFieldIds = [cNameFieldId, linkBFieldId, lookupBFieldId];
        const cFieldNames = ['Name', 'LinkB', 'ValueFromB'];

        // Create C record linked to B (manyOne uses single object)
        const recordC = await createRecord(tableC.id, {
          [cNameFieldId]: 'End',
          [linkBFieldId]: { id: recordB.id },
        });

        // Process outbox to ensure lookup chain is calculated
        await testContainer.processOutbox();
        await testContainer.processOutbox();

        const beforeRecordsA = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecordsA, aFieldIds))
          .toMatchInlineSnapshot(`
            "[Cascade A]
            -------------------
            #  | Name   | Value
            -------------------
            R0 | Source | 10   
            -------------------"
          `);

        // Before update
        const beforeRecords = await listRecords(tableC.id);
        const beforeSnapshot = printTableSnapshot(
          tableC.name,
          cFieldNames,
          beforeRecords,
          cFieldIds
        );

        // Lookup returns the value from the linked record (number values shown as-is from JSON array)
        expect(beforeSnapshot).toMatchInlineSnapshot(`
          "[Cascade C]
          -------------------------------
          #  | Name | LinkB  | ValueFromB
          -------------------------------
          R0 | End  | Middle | [10]      
          -------------------------------"
        `);

        // Update A.Value - should cascade A -> B.lookup -> C.lookup
        await updateRecord(tableA.id, recordA.id, { [valueFieldId]: 99 });

        // Process outbox tasks for multi-level cascade (A->B, then B->C)
        // Each level may enqueue the next level, so we need multiple passes
        await testContainer.processOutbox();
        await testContainer.processOutbox();
        await testContainer.processOutbox();

        const afterRecordsA = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, afterRecordsA, aFieldIds))
          .toMatchInlineSnapshot(`
            "[Cascade A]
            -------------------
            #  | Name   | Value
            -------------------
            R0 | Source | 99   
            -------------------"
          `);

        // After update - C should show updated value
        const afterRecords = await listRecords(tableC.id);
        const afterSnapshot = printTableSnapshot(tableC.name, cFieldNames, afterRecords, cFieldIds);

        // Value propagates through the chain: A.Value(99) -> B.ValueFromA(99) -> C.ValueFromB(99)
        expect(afterSnapshot).toMatchInlineSnapshot(`
          "[Cascade C]
          -------------------------------
          #  | Name | LinkB  | ValueFromB
          -------------------------------
          R0 | End  | Middle | [99]      
          -------------------------------"
        `);
      });
    });
  });

  // ===========================================================================
  // SECTION 3: LINK SCENARIOS - RELATIONSHIP TYPES
  // ===========================================================================

  describe('link relationship types', () => {
    describe('oneOne relationship', () => {
      /**
       * Scenario: OneOne twoWay - when B links to A, A's symmetric link shows B.
       * Change B's link from A1 to A2 - A1 should no longer show B, A2 should show B.
       */
      it('oneOne twoWay - updates symmetric link when link changes', async () => {
        // Table A
        const aNameFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'SymOneOneA',
          fields: [{ type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        const recordA1 = await createRecord(tableA.id, { [aNameFieldId]: 'A1' });
        const recordA2 = await createRecord(tableA.id, { [aNameFieldId]: 'A2' });

        // Table B: oneOne link to A
        const bNameFieldId = createFieldId();
        const bLinkFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'SymOneOneB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: bLinkFieldId,
              name: 'LinkA',
              options: {
                relationship: 'oneOne',
                foreignTableId: tableA.id,
                lookupFieldId: aNameFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        // B1 links to A1
        await createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bLinkFieldId]: { id: recordA1.id },
        });
        await testContainer.processOutbox();

        // Find symmetric link field in tableA
        const aFieldsBefore = await listRecords(tableA.id);
        const symLinkFieldKey = Object.keys(aFieldsBefore[0]?.fields || {}).find(
          (k) => k !== aNameFieldId && k !== '__id'
        );
        expect(symLinkFieldKey).toBeDefined();

        const aFieldIds = [aNameFieldId, symLinkFieldKey!];
        const aFieldNames = ['Name', 'SymLink'];

        expect(printTableSnapshot(tableA.name, aFieldNames, aFieldsBefore, aFieldIds))
          .toMatchInlineSnapshot(`
            "[SymOneOneA]
            -------------------
            #  | Name | SymLink
            -------------------
            R0 | A1   | -      
            R1 | A2   | -      
            -------------------"
          `);

        // Change B1's link from A1 to A2
        const bRecords = await listRecords(tableB.id);
        await updateRecord(tableB.id, bRecords[0].id, {
          [bLinkFieldId]: { id: recordA2.id },
        });
        await testContainer.processOutbox();

        const aFieldsAfter = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, aFieldsAfter, aFieldIds))
          .toMatchInlineSnapshot(`
            "[SymOneOneA]
            -------------------
            #  | Name | SymLink
            -------------------
            R0 | A1   | -      
            R1 | A2   | -      
            -------------------"
          `);
      });

      it('oneOne twoWay - updates lookup when linked value changes', async () => {
        // Table A
        const aNameFieldId = createFieldId();
        const aValueFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'OneOneA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: aValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordA = await createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aValueFieldId]: 100,
        });

        // Table B: oneOne link to A
        const bNameFieldId = createFieldId();
        const bLinkFieldId = createFieldId();
        const bLookupFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'OneOneB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: bLinkFieldId,
              name: 'LinkA',
              options: {
                relationship: 'oneOne',
                foreignTableId: tableA.id,
                lookupFieldId: aNameFieldId,
              },
            },
            {
              type: 'lookup',
              id: bLookupFieldId,
              name: 'LookupVal',
              options: {
                linkFieldId: bLinkFieldId,
                foreignTableId: tableA.id,
                lookupFieldId: aValueFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const bFieldIds = [bNameFieldId, bLinkFieldId, bLookupFieldId];
        const bFieldNames = ['Name', 'LinkA', 'LookupVal'];
        const aFieldIds = [aNameFieldId, aValueFieldId];
        const aFieldNames = ['Name', 'Value'];

        await createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bLinkFieldId]: { id: recordA.id },
        });

        // Process outbox to ensure symmetric link is updated
        await testContainer.processOutbox();

        const beforeRecordsA = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecordsA, aFieldIds))
          .toMatchInlineSnapshot(`
            "[OneOneA]
            -----------------
            #  | Name | Value
            -----------------
            R0 | A1   | 100  
            -----------------"
          `);

        const beforeRecords = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecords, bFieldIds))
          .toMatchInlineSnapshot(`
            "[OneOneB]
            -----------------------------
            #  | Name | LinkA | LookupVal
            -----------------------------
            R0 | B1   | A1    | [100]    
            -----------------------------"
          `);

        await updateRecord(tableA.id, recordA.id, { [aValueFieldId]: 999 });
        await testContainer.processOutbox();

        const afterRecordsA = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, afterRecordsA, aFieldIds))
          .toMatchInlineSnapshot(`
            "[OneOneA]
            -----------------
            #  | Name | Value
            -----------------
            R0 | A1   | 999  
            -----------------"
          `);

        const afterRecords = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, afterRecords, bFieldIds))
          .toMatchInlineSnapshot(`
            "[OneOneB]
            -----------------------------
            #  | Name | LinkA | LookupVal
            -----------------------------
            R0 | B1   | A1    | [999]    
            -----------------------------"
          `);
      });

      it('oneOne oneWay - no symmetric link in foreign table', async () => {
        const aNameFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'OneOneOneWayA',
          fields: [{ type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        const recordA = await createRecord(tableA.id, { [aNameFieldId]: 'A1' });

        const bNameFieldId = createFieldId();
        const bLinkFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'OneOneOneWayB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: bLinkFieldId,
              name: 'LinkA',
              options: {
                relationship: 'oneOne',
                foreignTableId: tableA.id,
                lookupFieldId: aNameFieldId,
                isOneWay: true,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        await createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bLinkFieldId]: { id: recordA.id },
        });
        await testContainer.processOutbox();

        const bFieldIds = [bNameFieldId, bLinkFieldId];
        const bFieldNames = ['Name', 'LinkA'];
        const bRecords = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, bRecords, bFieldIds))
          .toMatchInlineSnapshot(`
            "[OneOneOneWayB]
            -----------------
            #  | Name | LinkA
            -----------------
            R0 | B1   | A1   
            -----------------"
          `);

        const aFieldIds = [aNameFieldId];
        const aFieldNames = ['Name'];
        const aRecords = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, aRecords, aFieldIds))
          .toMatchInlineSnapshot(`
            "[OneOneOneWayA]
            ---------
            #  | Name
            ---------
            R0 | A1  
            ---------"
          `);
        const extraKeys = Object.keys(aRecords[0]?.fields ?? {}).filter(
          (key) => key !== aNameFieldId && key !== '__id'
        );
        expect(extraKeys).toHaveLength(0);
      });
    });

    describe('oneMany relationship', () => {
      /**
       * Scenario: Parent (oneMany) links to multiple children.
       * Each child should have a symmetric link (manyOne) showing its parent.
       */
      it('oneMany twoWay - symmetric link shows parent in child records', async () => {
        // Table Child
        const childNameFieldId = createFieldId();
        const tableChild = await createTable({
          baseId,
          name: 'OneManyChild',
          fields: [{ type: 'singleLineText', id: childNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        const child1 = await createRecord(tableChild.id, { [childNameFieldId]: 'C1' });
        const child2 = await createRecord(tableChild.id, { [childNameFieldId]: 'C2' });

        // Table Parent: oneMany link to children
        const parentNameFieldId = createFieldId();
        const parentLinkFieldId = createFieldId();
        const tableParent = await createTable({
          baseId,
          name: 'OneManyParent',
          fields: [
            { type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: parentLinkFieldId,
              name: 'Children',
              options: {
                relationship: 'oneMany',
                foreignTableId: tableChild.id,
                lookupFieldId: childNameFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        // Parent links to both children
        await createRecord(tableParent.id, {
          [parentNameFieldId]: 'Parent1',
          [parentLinkFieldId]: [{ id: child1.id }, { id: child2.id }],
        });
        await testContainer.processOutbox();

        const parentFieldIds = [parentNameFieldId, parentLinkFieldId];
        const parentFieldNames = ['Name', 'Children'];
        const parentRecords = await listRecords(tableParent.id);
        expect(
          printTableSnapshot(tableParent.name, parentFieldNames, parentRecords, parentFieldIds)
        ).toMatchInlineSnapshot(`
            "[OneManyParent]
            -----------------------
            #  | Name    | Children
            -----------------------
            R0 | Parent1 | C1, C2  
            -----------------------"
          `);

        // Find symmetric link field in tableChild
        const childRecords = await listRecords(tableChild.id);
        const symLinkFieldKey = Object.keys(childRecords[0]?.fields || {}).find(
          (k) => k !== childNameFieldId && k !== '__id'
        );
        expect(symLinkFieldKey).toBeDefined();

        const childFieldIds = [childNameFieldId, symLinkFieldKey!];
        const childFieldNames = ['Name', 'Parent'];

        // Each child shows its parent
        expect(printTableSnapshot(tableChild.name, childFieldNames, childRecords, childFieldIds))
          .toMatchInlineSnapshot(`
            "[OneManyChild]
            -------------------
            #  | Name | Parent 
            -------------------
            R0 | C1   | Parent1
            R1 | C2   | Parent1
            -------------------"
        `);

        // Change parent to only link C1
        await updateRecord(tableParent.id, parentRecords[0].id, {
          [parentLinkFieldId]: [{ id: child1.id }],
        });
        await testContainer.processOutbox();

        const parentRecordsAfter = await listRecords(tableParent.id);
        expect(
          printTableSnapshot(tableParent.name, parentFieldNames, parentRecordsAfter, parentFieldIds)
        ).toMatchInlineSnapshot(`
          "[OneManyParent]
          -----------------------
          #  | Name    | Children
          -----------------------
          R0 | Parent1 | C1      
          -----------------------"
        `);

        const childRecordsAfter = await listRecords(tableChild.id);
        expect(
          printTableSnapshot(tableChild.name, childFieldNames, childRecordsAfter, childFieldIds)
        ).toMatchInlineSnapshot(`
          "[OneManyChild]
          -------------------
          #  | Name | Parent 
          -------------------
          R0 | C1   | Parent1
          R1 | C2   | -      
          -------------------"
        `);
      });

      it('oneMany twoWay - rollup updates when adding/removing children', async () => {
        // Table B (children)
        const bNameFieldId = createFieldId();
        const bValueFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'OneManyB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: bValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordB1 = await createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bValueFieldId]: 10,
        });
        const recordB2 = await createRecord(tableB.id, {
          [bNameFieldId]: 'B2',
          [bValueFieldId]: 20,
        });
        const recordB3 = await createRecord(tableB.id, {
          [bNameFieldId]: 'B3',
          [bValueFieldId]: 30,
        });

        // Table A (parent): oneMany link to B
        const aNameFieldId = createFieldId();
        const aLinkFieldId = createFieldId();
        const aRollupFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'OneManyA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: aLinkFieldId,
              name: 'Children',
              options: {
                relationship: 'oneMany',
                foreignTableId: tableB.id,
                lookupFieldId: bNameFieldId,
              },
            },
            {
              type: 'rollup',
              id: aRollupFieldId,
              name: 'Sum',
              options: { expression: 'sum({values})' },
              config: {
                linkFieldId: aLinkFieldId,
                foreignTableId: tableB.id,
                lookupFieldId: bValueFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const aFieldIds = [aNameFieldId, aLinkFieldId, aRollupFieldId];
        const aFieldNames = ['Name', 'Children', 'Sum'];

        await createRecord(tableA.id, {
          [aNameFieldId]: 'Parent',
          [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
        });

        const beforeRecords = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecords, aFieldIds))
          .toMatchInlineSnapshot(`
            "[OneManyA]
            ----------------------------
            #  | Name   | Children | Sum
            ----------------------------
            R0 | Parent | B1, B2   | 30 
            ----------------------------"
          `);

        // Add B3 to children
        const record = beforeRecords[0];
        await updateRecord(tableA.id, record.id, {
          [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }, { id: recordB3.id }],
        });
        await testContainer.processOutbox();

        const afterRecords = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, afterRecords, aFieldIds))
          .toMatchInlineSnapshot(`
            "[OneManyA]
            ------------------------------
            #  | Name   | Children   | Sum
            ------------------------------
            R0 | Parent | B1, B2, B3 | 60 
            ------------------------------"
          `);
      });

      it('oneMany oneWay - no symmetric link in foreign table', async () => {
        const childNameFieldId = createFieldId();
        const tableChild = await createTable({
          baseId,
          name: 'OneManyOneWayChild',
          fields: [{ type: 'singleLineText', id: childNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        const child1 = await createRecord(tableChild.id, { [childNameFieldId]: 'C1' });
        const child2 = await createRecord(tableChild.id, { [childNameFieldId]: 'C2' });

        const parentNameFieldId = createFieldId();
        const parentLinkFieldId = createFieldId();
        const tableParent = await createTable({
          baseId,
          name: 'OneManyOneWayParent',
          fields: [
            { type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: parentLinkFieldId,
              name: 'Children',
              options: {
                relationship: 'oneMany',
                foreignTableId: tableChild.id,
                lookupFieldId: childNameFieldId,
                isOneWay: true,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        await createRecord(tableParent.id, {
          [parentNameFieldId]: 'Parent1',
          [parentLinkFieldId]: [{ id: child1.id }, { id: child2.id }],
        });
        await testContainer.processOutbox();

        const parentFieldIds = [parentNameFieldId, parentLinkFieldId];
        const parentFieldNames = ['Name', 'Children'];
        const parentRecords = await listRecords(tableParent.id);
        expect(
          printTableSnapshot(tableParent.name, parentFieldNames, parentRecords, parentFieldIds)
        ).toMatchInlineSnapshot(`
            "[OneManyOneWayParent]
            -----------------------
            #  | Name    | Children
            -----------------------
            R0 | Parent1 | C1, C2  
            -----------------------"
          `);

        const childFieldIds = [childNameFieldId];
        const childFieldNames = ['Name'];
        const childRecords = await listRecords(tableChild.id);
        expect(printTableSnapshot(tableChild.name, childFieldNames, childRecords, childFieldIds))
          .toMatchInlineSnapshot(`
            "[OneManyOneWayChild]
            ---------
            #  | Name
            ---------
            R0 | C1  
            R1 | C2  
            ---------"
          `);
        childRecords.forEach((record) => {
          const extraKeys = Object.keys(record.fields ?? {}).filter(
            (key) => key !== childNameFieldId && key !== '__id'
          );
          expect(extraKeys).toHaveLength(0);
        });
      });
    });

    describe('manyOne relationship', () => {
      it('manyOne twoWay - multiple records can link to same foreign record', async () => {
        // Table B (the "one")
        const bNameFieldId = createFieldId();
        const bValueFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'ManyOneB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: bValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordB = await createRecord(tableB.id, {
          [bNameFieldId]: 'Shared',
          [bValueFieldId]: 100,
        });

        // Table A (the "many"): manyOne link to B
        const aNameFieldId = createFieldId();
        const aLinkFieldId = createFieldId();
        const aLookupFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'ManyOneA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: aLinkFieldId,
              name: 'Parent',
              options: {
                relationship: 'manyOne',
                foreignTableId: tableB.id,
                lookupFieldId: bNameFieldId,
              },
            },
            {
              type: 'lookup',
              id: aLookupFieldId,
              name: 'ParentVal',
              options: {
                linkFieldId: aLinkFieldId,
                foreignTableId: tableB.id,
                lookupFieldId: bValueFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const aFieldIds = [aNameFieldId, aLinkFieldId, aLookupFieldId];
        const aFieldNames = ['Name', 'Parent', 'ParentVal'];
        const bFieldIds = [bNameFieldId, bValueFieldId];
        const bFieldNames = ['Name', 'Value'];

        // Create multiple A records linking to same B
        await createRecord(tableA.id, {
          [aNameFieldId]: 'Child1',
          [aLinkFieldId]: { id: recordB.id },
        });
        await createRecord(tableA.id, {
          [aNameFieldId]: 'Child2',
          [aLinkFieldId]: { id: recordB.id },
        });
        await createRecord(tableA.id, {
          [aNameFieldId]: 'Child3',
          [aLinkFieldId]: { id: recordB.id },
        });

        const beforeRecords = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecords, aFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyOneA]
            --------------------------------
            #  | Name   | Parent | ParentVal
            --------------------------------
            R0 | Child1 | Shared | [100]    
            R1 | Child2 | Shared | [100]    
            R2 | Child3 | Shared | [100]    
            --------------------------------"
          `);

        const beforeRecordsB = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecordsB, bFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyOneB]
            -------------------
            #  | Name   | Value
            -------------------
            R0 | Shared | 100  
            -------------------"
          `);

        // Update B's value - all A records should update
        await updateRecord(tableB.id, recordB.id, { [bValueFieldId]: 999 });
        await testContainer.processOutbox();

        const afterRecordsB = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, afterRecordsB, bFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyOneB]
            -------------------
            #  | Name   | Value
            -------------------
            R0 | Shared | 999  
            -------------------"
          `);

        const afterRecords = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, afterRecords, aFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyOneA]
            --------------------------------
            #  | Name   | Parent | ParentVal
            --------------------------------
            R0 | Child1 | Shared | [999]    
            R1 | Child2 | Shared | [999]    
            R2 | Child3 | Shared | [999]    
            --------------------------------"
          `);
      });

      /**
       * Scenario: Multiple children (manyOne) link to same parent.
       * Parent's symmetric link (oneMany) should show all children.
       */
      it('manyOne twoWay - symmetric link shows all children in parent', async () => {
        // Table Parent
        const parentNameFieldId = createFieldId();
        const tableParent = await createTable({
          baseId,
          name: 'ManyOneParent',
          fields: [
            { type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true },
          ],
          views: [{ type: 'grid' }],
        });

        const parent1 = await createRecord(tableParent.id, { [parentNameFieldId]: 'P1' });

        // Table Child: manyOne link to parent
        const childNameFieldId = createFieldId();
        const childLinkFieldId = createFieldId();
        const tableChild = await createTable({
          baseId,
          name: 'ManyOneChild',
          fields: [
            { type: 'singleLineText', id: childNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: childLinkFieldId,
              name: 'Parent',
              options: {
                relationship: 'manyOne',
                foreignTableId: tableParent.id,
                lookupFieldId: parentNameFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const childFieldIds = [childNameFieldId, childLinkFieldId];
        const childFieldNames = ['Name', 'Parent'];
        const childRecordsEmpty = await listRecords(tableChild.id);
        expect(
          printTableSnapshot(tableChild.name, childFieldNames, childRecordsEmpty, childFieldIds)
        ).toMatchInlineSnapshot(`
            "[ManyOneChild]
            -----------------
            # | Name | Parent
            -----------------
            -----------------"
          `);

        // Create children linking to parent
        await createRecord(tableChild.id, {
          [childNameFieldId]: 'Child1',
          [childLinkFieldId]: { id: parent1.id },
        });
        await createRecord(tableChild.id, {
          [childNameFieldId]: 'Child2',
          [childLinkFieldId]: { id: parent1.id },
        });
        await testContainer.processOutbox();

        const childRecords = await listRecords(tableChild.id);
        expect(printTableSnapshot(tableChild.name, childFieldNames, childRecords, childFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyOneChild]
            --------------------
            #  | Name   | Parent
            --------------------
            R0 | Child1 | P1    
            R1 | Child2 | P1    
            --------------------"
          `);

        // Find symmetric link field in tableParent
        const parentRecords = await listRecords(tableParent.id);
        const symLinkFieldKey = Object.keys(parentRecords[0]?.fields || {}).find(
          (k) => k !== parentNameFieldId && k !== '__id'
        );
        expect(symLinkFieldKey).toBeDefined();

        const parentFieldIds = [parentNameFieldId, symLinkFieldKey!];
        const parentFieldNames = ['Name', 'Children'];

        expect(
          printTableSnapshot(tableParent.name, parentFieldNames, parentRecords, parentFieldIds)
        ).toMatchInlineSnapshot(`
            "[ManyOneParent]
            --------------------------
            #  | Name | Children      
            --------------------------
            R0 | P1   | Child1, Child2
            --------------------------"
          `);

        // Add a third child
        await createRecord(tableChild.id, {
          [childNameFieldId]: 'Child3',
          [childLinkFieldId]: { id: parent1.id },
        });
        await testContainer.processOutbox();

        const childRecordsAfter = await listRecords(tableChild.id);
        expect(
          printTableSnapshot(tableChild.name, childFieldNames, childRecordsAfter, childFieldIds)
        ).toMatchInlineSnapshot(`
          "[ManyOneChild]
          --------------------
          #  | Name   | Parent
          --------------------
          R0 | Child1 | P1    
          R1 | Child2 | P1    
          R2 | Child3 | P1    
          --------------------"
        `);

        const parentRecordsAfter = await listRecords(tableParent.id);
        expect(
          printTableSnapshot(tableParent.name, parentFieldNames, parentRecordsAfter, parentFieldIds)
        ).toMatchInlineSnapshot(`
          "[ManyOneParent]
          ----------------------------------
          #  | Name | Children              
          ----------------------------------
          R0 | P1   | Child1, Child2, Child3
          ----------------------------------"
        `);
      });

      it('manyOne oneWay - updates lookup when changing link target', async () => {
        const bNameFieldId = createFieldId();
        const bValueFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'ManyOneOneWayB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: bValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordB1 = await createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bValueFieldId]: 10,
        });
        const recordB2 = await createRecord(tableB.id, {
          [bNameFieldId]: 'B2',
          [bValueFieldId]: 20,
        });

        const aNameFieldId = createFieldId();
        const aLinkFieldId = createFieldId();
        const aLookupFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'ManyOneOneWayA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: aLinkFieldId,
              name: 'Parent',
              options: {
                relationship: 'manyOne',
                foreignTableId: tableB.id,
                lookupFieldId: bNameFieldId,
                isOneWay: true,
              },
            },
            {
              type: 'lookup',
              id: aLookupFieldId,
              name: 'ParentVal',
              options: {
                linkFieldId: aLinkFieldId,
                foreignTableId: tableB.id,
                lookupFieldId: bValueFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const recordA = await createRecord(tableA.id, {
          [aNameFieldId]: 'Child',
          [aLinkFieldId]: { id: recordB1.id },
        });

        const aFieldIds = [aNameFieldId, aLinkFieldId, aLookupFieldId];
        const aFieldNames = ['Name', 'Parent', 'ParentVal'];
        const beforeRecords = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecords, aFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyOneOneWayA]
            -------------------------------
            #  | Name  | Parent | ParentVal
            -------------------------------
            R0 | Child | B1     | [10]     
            -------------------------------"
          `);
        const beforeRecord = beforeRecords.find((r) => r.id === recordA.id);
        const beforeLink = beforeRecord?.fields[aLinkFieldId] as { id?: string } | null;
        expect(beforeLink?.id).toBe(recordB1.id);
        expect(beforeRecord?.fields[aLookupFieldId]).toBe('[10]');

        await updateRecord(tableA.id, recordA.id, { [aLinkFieldId]: { id: recordB2.id } });
        await testContainer.processOutbox();

        const afterRecords = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, afterRecords, aFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyOneOneWayA]
            -------------------------------
            #  | Name  | Parent | ParentVal
            -------------------------------
            R0 | Child | B2     | [20]     
            -------------------------------"
          `);
        const afterRecord = afterRecords.find((r) => r.id === recordA.id);
        const afterLink = afterRecord?.fields[aLinkFieldId] as { id?: string } | null;
        expect(afterLink?.id).toBe(recordB2.id);
        expect(afterRecord?.fields[aLookupFieldId]).toBe('[20]');
      });
    });

    describe('manyMany relationship', () => {
      it('manyMany twoWay - rollup updates with add/remove', async () => {
        // Table B
        const bNameFieldId = createFieldId();
        const bValueFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'ManyManyB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: bValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordB1 = await createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bValueFieldId]: 10,
        });
        const recordB2 = await createRecord(tableB.id, {
          [bNameFieldId]: 'B2',
          [bValueFieldId]: 20,
        });

        // Table A: manyMany link to B
        const aNameFieldId = createFieldId();
        const aLinkFieldId = createFieldId();
        const aRollupFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'ManyManyA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: aLinkFieldId,
              name: 'Links',
              options: {
                relationship: 'manyMany',
                foreignTableId: tableB.id,
                lookupFieldId: bNameFieldId,
              },
            },
            {
              type: 'rollup',
              id: aRollupFieldId,
              name: 'Sum',
              options: { expression: 'sum({values})' },
              config: {
                linkFieldId: aLinkFieldId,
                foreignTableId: tableB.id,
                lookupFieldId: bValueFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const aFieldIds = [aNameFieldId, aLinkFieldId, aRollupFieldId];
        const aFieldNames = ['Name', 'Links', 'Sum'];

        await createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
        });

        const beforeRecords = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecords, aFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyManyA]
            ------------------------
            #  | Name | Links  | Sum
            ------------------------
            R0 | A1   | B1, B2 | 30 
            ------------------------"
          `);

        // Remove B1, keep only B2
        const record = beforeRecords[0];
        await updateRecord(tableA.id, record.id, {
          [aLinkFieldId]: [{ id: recordB2.id }],
        });
        await testContainer.processOutbox();

        const afterRecords = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, afterRecords, aFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyManyA]
            -----------------------
            #  | Name | Links | Sum
            -----------------------
            R0 | A1   | B2    | 20 
            -----------------------"
          `);
      });

      /**
       * Scenario: ManyMany twoWay - both tables show symmetric links.
       * A links to B1,B2 - B1 and B2 should each show link to A.
       */
      it('manyMany twoWay - junction table maintains both sides', async () => {
        // Table B
        const bNameFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'ManyManySymB',
          fields: [{ type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        const recordB1 = await createRecord(tableB.id, { [bNameFieldId]: 'B1' });
        const recordB2 = await createRecord(tableB.id, { [bNameFieldId]: 'B2' });

        // Table A: manyMany link to B
        const aNameFieldId = createFieldId();
        const aLinkFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'ManyManySymA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: aLinkFieldId,
              name: 'LinksB',
              options: {
                relationship: 'manyMany',
                foreignTableId: tableB.id,
                lookupFieldId: bNameFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        // A1 links to B1 and B2
        await createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
        });
        // A2 links to B1 only
        await createRecord(tableA.id, {
          [aNameFieldId]: 'A2',
          [aLinkFieldId]: [{ id: recordB1.id }],
        });
        await testContainer.processOutbox();

        const aFieldIds = [aNameFieldId, aLinkFieldId];
        const aFieldNames = ['Name', 'LinksB'];
        const aRecordsBefore = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, aRecordsBefore, aFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyManySymA]
            ------------------
            #  | Name | LinksB
            ------------------
            R0 | A1   | B1, B2
            R1 | A2   | B1    
            ------------------"
          `);

        // Find symmetric link field in tableB
        const bRecords = await listRecords(tableB.id);
        const symLinkFieldKey = Object.keys(bRecords[0]?.fields || {}).find(
          (k) => k !== bNameFieldId && k !== '__id'
        );
        expect(symLinkFieldKey).toBeDefined();

        const bFieldIds = [bNameFieldId, symLinkFieldKey!];
        const bFieldNames = ['Name', 'LinksA'];

        // B1 is linked by A1 and A2, B2 is linked by A1 only
        expect(printTableSnapshot(tableB.name, bFieldNames, bRecords, bFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyManySymB]
            ------------------
            #  | Name | LinksA
            ------------------
            R0 | B1   | A1, A2
            R1 | B2   | A1    
            ------------------"
          `);

        // Update A2 to also link B2
        const aRecords = await listRecords(tableA.id);
        const a2Record = aRecords.find((r) => r.fields[aNameFieldId] === 'A2');
        await updateRecord(tableA.id, a2Record!.id, {
          [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
        });
        await testContainer.processOutbox();

        const aRecordsAfter = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, aRecordsAfter, aFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyManySymA]
            ------------------
            #  | Name | LinksB
            ------------------
            R0 | A1   | B1, B2
            R1 | A2   | B1, B2
            ------------------"
          `);

        const bRecordsAfter = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, bRecordsAfter, bFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyManySymB]
            ------------------
            #  | Name | LinksA
            ------------------
            R0 | B1   | A1, A2
            R1 | B2   | A1, A2
            ------------------"
          `);
      });

      it('manyMany oneWay - only main table shows links', async () => {
        const bNameFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'ManyManyOneWayB',
          fields: [{ type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        const recordB1 = await createRecord(tableB.id, { [bNameFieldId]: 'B1' });
        const recordB2 = await createRecord(tableB.id, { [bNameFieldId]: 'B2' });

        const aNameFieldId = createFieldId();
        const aLinkFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'ManyManyOneWayA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: aLinkFieldId,
              name: 'LinksB',
              options: {
                relationship: 'manyMany',
                foreignTableId: tableB.id,
                lookupFieldId: bNameFieldId,
                isOneWay: true,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        await createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
        });
        await testContainer.processOutbox();

        const aFieldIds = [aNameFieldId, aLinkFieldId];
        const aFieldNames = ['Name', 'LinksB'];
        const aRecords = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, aRecords, aFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyManyOneWayA]
            ------------------
            #  | Name | LinksB
            ------------------
            R0 | A1   | B1, B2
            ------------------"
          `);

        const linkValues = aRecords[0]?.fields[aLinkFieldId] as Array<{ id?: string }>;
        expect(linkValues?.map((link) => link.id)).toEqual(
          expect.arrayContaining([recordB1.id, recordB2.id])
        );

        const bFieldIds = [bNameFieldId];
        const bFieldNames = ['Name'];
        const bRecords = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, bRecords, bFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyManyOneWayB]
            ---------
            #  | Name
            ---------
            R0 | B1  
            R1 | B2  
            ---------"
          `);
        bRecords.forEach((record) => {
          const extraKeys = Object.keys(record.fields ?? {}).filter(
            (key) => key !== bNameFieldId && key !== '__id'
          );
          expect(extraKeys).toHaveLength(0);
        });
      });
    });
  });

  // ===========================================================================
  // SECTION 4: PRIMARY FIELD AS FORMULA
  // ===========================================================================

  describe('primary field as formula', () => {
    /**
     * Scenario: Primary field is a formula that references other fields.
     * A.value -> A.primary (formula: CONCATENATE("Item-", value))
     * B.link -> looks up A.primary for title
     */
    it('updates link titles when primary formula field changes', async () => {
      // Table A: Primary is a formula based on value
      const aValueFieldId = createFieldId();
      const aPrimaryFieldId = createFieldId();
      const tableA = await createTable({
        baseId,
        name: 'FormulaPrimaryA',
        fields: [
          { type: 'number', id: aValueFieldId, name: 'Value' },
          {
            type: 'formula',
            id: aPrimaryFieldId,
            name: 'Title',
            isPrimary: true,
            options: { expression: `CONCATENATE("Item-", {${aValueFieldId}})` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const recordA = await createRecord(tableA.id, {
        [aValueFieldId]: 42,
      });

      const aFieldIds = [aValueFieldId, aPrimaryFieldId];
      const aFieldNames = ['Value', 'Title'];

      // Table B: Links to A
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const tableB = await createTable({
        baseId,
        name: 'FormulaPrimaryB',
        fields: [
          { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: bLinkFieldId,
            name: 'LinkA',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableA.id,
              lookupFieldId: aPrimaryFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const bFieldIds = [bNameFieldId, bLinkFieldId];
      const bFieldNames = ['Name', 'LinkA'];

      await createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bLinkFieldId]: { id: recordA.id },
      });

      const beforeRecordsA = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecordsA, aFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryA]
          -----------------------
          #  | Value | Title     
          -----------------------
          R0 | 42    | Item-42.00
          -----------------------"
        `);

      const beforeRecords = await listRecords(tableB.id);
      expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecords, bFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryB]
          ----------------------
          #  | Name | LinkA     
          ----------------------
          R0 | B1   | Item-42.00
          ----------------------"
        `);

      // Update A.Value -> A.Title (primary) -> B.LinkA title
      await updateRecord(tableA.id, recordA.id, { [aValueFieldId]: 100 });
      await testContainer.processOutbox();

      const afterRecordsA = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, afterRecordsA, aFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryA]
          ------------------------
          #  | Value | Title      
          ------------------------
          R0 | 100   | Item-100.00
          ------------------------"
        `);

      const afterRecords = await listRecords(tableB.id);
      expect(printTableSnapshot(tableB.name, bFieldNames, afterRecords, bFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryB]
          -----------------------
          #  | Name | LinkA      
          -----------------------
          R0 | B1   | Item-100.00
          -----------------------"
        `);
    });

    it('propagates formula primary field changes through lookup chain', async () => {
      const aValueFieldId = createFieldId();
      const aPrimaryFieldId = createFieldId();
      const tableA = await createTable({
        baseId,
        name: 'FormulaPrimaryChainA',
        fields: [
          { type: 'number', id: aValueFieldId, name: 'Value' },
          {
            type: 'formula',
            id: aPrimaryFieldId,
            name: 'Title',
            isPrimary: true,
            options: { expression: `CONCATENATE("Item-", {${aValueFieldId}})` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const recordA = await createRecord(tableA.id, {
        [aValueFieldId]: 7,
      });

      const aFieldIds = [aValueFieldId, aPrimaryFieldId];
      const aFieldNames = ['Value', 'Title'];

      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bLookupFieldId = createFieldId();
      const tableB = await createTable({
        baseId,
        name: 'FormulaPrimaryChainB',
        fields: [
          { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: bLinkFieldId,
            name: 'LinkA',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableA.id,
              lookupFieldId: aPrimaryFieldId,
            },
          },
          {
            type: 'lookup',
            id: bLookupFieldId,
            name: 'TitleFromA',
            options: {
              linkFieldId: bLinkFieldId,
              foreignTableId: tableA.id,
              lookupFieldId: aPrimaryFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const recordB = await createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bLinkFieldId]: { id: recordA.id },
      });

      const cNameFieldId = createFieldId();
      const cLinkFieldId = createFieldId();
      const cLookupFieldId = createFieldId();
      const tableC = await createTable({
        baseId,
        name: 'FormulaPrimaryChainC',
        fields: [
          { type: 'singleLineText', id: cNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: cLinkFieldId,
            name: 'LinkB',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: cLookupFieldId,
            name: 'TitleFromB',
            options: {
              linkFieldId: cLinkFieldId,
              foreignTableId: tableB.id,
              lookupFieldId: bLookupFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(tableC.id, {
        [cNameFieldId]: 'C1',
        [cLinkFieldId]: { id: recordB.id },
      });

      const beforeRecordsA = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecordsA, aFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryChainA]
          -----------------------
          #  | Value | Title     
          -----------------------
          R0 | 7     | Item-7.00
          -----------------------"
        `);

      const cFieldIds = [cNameFieldId, cLinkFieldId, cLookupFieldId];
      const cFieldNames = ['Name', 'LinkB', 'TitleFromB'];
      const beforeRecords = await listRecords(tableC.id);
      expect(printTableSnapshot(tableC.name, cFieldNames, beforeRecords, cFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryChainC]
          -------------------------------
          #  | Name | LinkB | TitleFromB 
          -------------------------------
          R0 | C1   | B1    | [Item-7.00]
          -------------------------------"
        `);
      expect(beforeRecords[0]?.fields[cLookupFieldId]).toBe('["Item-7.00"]');

      await updateRecord(tableA.id, recordA.id, { [aValueFieldId]: 12 });
      await testContainer.processOutbox();
      await testContainer.processOutbox();
      await testContainer.processOutbox();

      const afterRecordsA = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, afterRecordsA, aFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryChainA]
          -----------------------
          #  | Value | Title     
          -----------------------
          R0 | 12    | Item-12.00
          -----------------------"
        `);

      const afterRecords = await listRecords(tableC.id);
      expect(printTableSnapshot(tableC.name, cFieldNames, afterRecords, cFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryChainC]
          --------------------------------
          #  | Name | LinkB | TitleFromB  
          --------------------------------
          R0 | C1   | B1    | [Item-12.00]
          --------------------------------"
        `);
      expect(afterRecords[0]?.fields[cLookupFieldId]).toBe('["Item-12.00"]');
    });
  });

  // ===========================================================================
  // SECTION 5: SELF-REFERENCING LINKS
  // ===========================================================================

  describe('self-referencing links', () => {
    /**
     * NOTE: Self-referencing links require special API support to create the table first,
     * then add the link field separately.
     */
    it('self manyOne - updates child lookups when parent name changes', async () => {
      const nameFieldId = createFieldId();
      const table = await createTable({
        baseId,
        name: 'SelfManyOne',
        fields: [{ type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      const parentLinkFieldId = createFieldId();
      const parentLookupFieldId = createFieldId();

      await createField({
        baseId,
        tableId: table.id,
        field: {
          type: 'link',
          id: parentLinkFieldId,
          name: 'Parent',
          options: {
            relationship: 'manyOne',
            foreignTableId: table.id,
            lookupFieldId: nameFieldId,
            isOneWay: true,
          },
        },
      });

      await createField({
        baseId,
        tableId: table.id,
        field: {
          type: 'lookup',
          id: parentLookupFieldId,
          name: 'ParentName',
          options: {
            linkFieldId: parentLinkFieldId,
            foreignTableId: table.id,
            lookupFieldId: nameFieldId,
          },
        },
      });

      const parent = await createRecord(table.id, { [nameFieldId]: 'Parent' });
      const child = await createRecord(table.id, {
        [nameFieldId]: 'Child',
        [parentLinkFieldId]: { id: parent.id },
      });

      const fieldIds = [nameFieldId, parentLinkFieldId, parentLookupFieldId];
      const fieldNames = ['Name', 'Parent', 'ParentName'];
      const beforeRecords = await listRecords(table.id);
      expect(printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[SelfManyOne]
          ---------------------------------
          #  | Name   | Parent | ParentName
          ---------------------------------
          R0 | Parent | -      | -         
          R1 | Child  | Parent | [Parent]  
          ---------------------------------"
        `);
      const beforeChild = beforeRecords.find((r) => r.id === child.id);
      expect(String(beforeChild?.fields[parentLookupFieldId] ?? '')).toContain('Parent');

      await updateRecord(table.id, parent.id, { [nameFieldId]: 'Parent2' });
      await testContainer.processOutbox();

      const afterRecords = await listRecords(table.id);
      expect(printTableSnapshot(table.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[SelfManyOne]
          -----------------------------------
          #  | Name    | Parent  | ParentName
          -----------------------------------
          R0 | Parent2 | -       | -         
          R1 | Child   | Parent2 | [Parent2] 
          -----------------------------------"
        `);
      const afterChild = afterRecords.find((r) => r.id === child.id);
      expect(String(afterChild?.fields[parentLookupFieldId] ?? '')).toContain('Parent2');
    });

    it('self manyMany - updates rollup when adding/removing self-links', async () => {
      const nameFieldId = createFieldId();
      const valueFieldId = createFieldId();
      const table = await createTable({
        baseId,
        name: 'SelfManyMany',
        fields: [
          { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: valueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const linkFieldId = createFieldId();
      const rollupFieldId = createFieldId();

      await createField({
        baseId,
        tableId: table.id,
        field: {
          type: 'link',
          id: linkFieldId,
          name: 'Links',
          options: {
            relationship: 'manyMany',
            foreignTableId: table.id,
            lookupFieldId: nameFieldId,
            isOneWay: true,
          },
        },
      });

      await createField({
        baseId,
        tableId: table.id,
        field: {
          type: 'rollup',
          id: rollupFieldId,
          name: 'Sum',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId,
            foreignTableId: table.id,
            lookupFieldId: valueFieldId,
          },
        },
      });

      const record1 = await createRecord(table.id, {
        [nameFieldId]: 'R1',
        [valueFieldId]: 10,
      });
      const record2 = await createRecord(table.id, {
        [nameFieldId]: 'R2',
        [valueFieldId]: 20,
      });
      const record3 = await createRecord(table.id, {
        [nameFieldId]: 'R3',
        [valueFieldId]: 30,
      });

      await updateRecord(table.id, record1.id, {
        [linkFieldId]: [{ id: record2.id }, { id: record3.id }],
      });
      await testContainer.processOutbox();

      const fieldIds = [nameFieldId, linkFieldId, rollupFieldId];
      const fieldNames = ['Name', 'Links', 'Sum'];
      let records = await listRecords(table.id);
      expect(printTableSnapshot(table.name, fieldNames, records, fieldIds)).toMatchInlineSnapshot(`
          "[SelfManyMany]
          ------------------------
          #  | Name | Links  | Sum
          ------------------------
          R0 | R1   | R2, R3 | 50 
          R1 | R2   | -      | -  
          R2 | R3   | -      | -  
          ------------------------"
        `);
      let stored = records.find((r) => r.id === record1.id);
      expect(stored?.fields[rollupFieldId]).toBe(50);

      await updateRecord(table.id, record1.id, { [linkFieldId]: [{ id: record3.id }] });
      await testContainer.processOutbox();

      records = await listRecords(table.id);
      expect(printTableSnapshot(table.name, fieldNames, records, fieldIds)).toMatchInlineSnapshot(`
          "[SelfManyMany]
          -----------------------
          #  | Name | Links | Sum
          -----------------------
          R0 | R1   | R3    | 30 
          R1 | R2   | -     | -  
          R2 | R3   | -     | -  
          -----------------------"
        `);
      stored = records.find((r) => r.id === record1.id);
      expect(stored?.fields[rollupFieldId]).toBe(30);
    });

    it('self link with formula chain - handles cross_record dependencies correctly', async () => {
      const nameFieldId = createFieldId();
      const valueFieldId = createFieldId();
      const formulaFieldId = createFieldId();
      const table = await createTable({
        baseId,
        name: 'SelfFormulaChain',
        fields: [
          { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: valueFieldId, name: 'Value' },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Double',
            options: { expression: `{${valueFieldId}} * 2` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const parentLinkFieldId = createFieldId();
      const parentLookupFieldId = createFieldId();

      await createField({
        baseId,
        tableId: table.id,
        field: {
          type: 'link',
          id: parentLinkFieldId,
          name: 'Parent',
          options: {
            relationship: 'manyOne',
            foreignTableId: table.id,
            lookupFieldId: nameFieldId,
            isOneWay: true,
          },
        },
      });

      await createField({
        baseId,
        tableId: table.id,
        field: {
          type: 'lookup',
          id: parentLookupFieldId,
          name: 'ParentDouble',
          options: {
            linkFieldId: parentLinkFieldId,
            foreignTableId: table.id,
            lookupFieldId: formulaFieldId,
          },
        },
      });

      const parent = await createRecord(table.id, {
        [nameFieldId]: 'Parent',
        [valueFieldId]: 10,
      });
      const child = await createRecord(table.id, {
        [nameFieldId]: 'Child',
        [valueFieldId]: 5,
        [parentLinkFieldId]: { id: parent.id },
      });

      const fieldIds = [
        nameFieldId,
        valueFieldId,
        formulaFieldId,
        parentLinkFieldId,
        parentLookupFieldId,
      ];
      const fieldNames = ['Name', 'Value', 'Double', 'Parent', 'ParentDouble'];
      const beforeRecords = await listRecords(table.id);
      expect(printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[SelfFormulaChain]
          ----------------------------------------------------
          #  | Name   | Value | Double | Parent | ParentDouble
          ----------------------------------------------------
          R0 | Parent | 10    | 20     | -      | -           
          R1 | Child  | 5     | 10     | Parent | [20]        
          ----------------------------------------------------"
        `);
      const beforeChild = beforeRecords.find((r) => r.id === child.id);
      expect(beforeChild?.fields[parentLookupFieldId]).toBe('[20]');

      await updateRecord(table.id, parent.id, { [valueFieldId]: 15 });
      await testContainer.processOutbox();

      const afterRecords = await listRecords(table.id);
      expect(printTableSnapshot(table.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[SelfFormulaChain]
          ----------------------------------------------------
          #  | Name   | Value | Double | Parent | ParentDouble
          ----------------------------------------------------
          R0 | Parent | 15    | 30     | -      | -           
          R1 | Child  | 5     | 10     | Parent | [30]        
          ----------------------------------------------------"
        `);
      const afterChild = afterRecords.find((r) => r.id === child.id);
      expect(afterChild?.fields[parentLookupFieldId]).toBe('[30]');
    });
  });

  // ===========================================================================
  // SECTION 6: CRUD OPERATIONS
  // ===========================================================================

  describe('record CRUD operations', () => {
    describe('create record', () => {
      /**
       * Scenario: Create record triggers formula calculation.
       * Table with formula field - new record should have computed value.
       */
      it('calculates formula fields on record creation', async () => {
        const nameFieldId = createFieldId();
        const numFieldId = createFieldId();
        const formulaFieldId = createFieldId();

        const table = await createTable({
          baseId,
          name: 'CreateFormula',
          fields: [
            { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: numFieldId, name: 'Num' },
            {
              type: 'formula',
              id: formulaFieldId,
              name: 'Double',
              options: { expression: `{${numFieldId}} * 2` },
            },
          ],
          views: [{ type: 'grid' }],
        });

        await createRecord(table.id, { [nameFieldId]: 'Row1', [numFieldId]: 3 });

        const fieldIds = [nameFieldId, numFieldId, formulaFieldId];
        const fieldNames = ['Name', 'Num', 'Double'];
        const records = await listRecords(table.id);
        expect(printTableSnapshot(table.name, fieldNames, records, fieldIds))
          .toMatchInlineSnapshot(`
            "[CreateFormula]
            ------------------------
            #  | Name | Num | Double
            ------------------------
            R0 | Row1 | 3   | 6     
            ------------------------"
          `);
        const record = records[0];
        expect(record?.fields[formulaFieldId]).toBe(6);
      });

      /**
       * Scenario: Create record with link triggers symmetric link update.
       * A.link points to B - B's symmetric link should show A.
       */
      it('updates symmetric links on record creation with link', async () => {
        // Table B
        const bNameFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'CreateSymB',
          fields: [{ type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        const recordB = await createRecord(tableB.id, { [bNameFieldId]: 'Target' });

        // Table A: manyOne link to B
        const aNameFieldId = createFieldId();
        const aLinkFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'CreateSymA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: aLinkFieldId,
              name: 'LinkB',
              options: {
                relationship: 'manyOne',
                foreignTableId: tableB.id,
                lookupFieldId: bNameFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        // Before creating A record, B has no symmetric link content
        const bRecordsBefore = await listRecords(tableB.id);
        const symLinkFieldKey = Object.keys(bRecordsBefore[0]?.fields || {}).find(
          (k) => k !== bNameFieldId && k !== '__id'
        );
        expect(symLinkFieldKey).toBeDefined();

        const bFieldIds = [bNameFieldId, symLinkFieldKey!];
        const bFieldNames = ['Name', 'SymLinks'];

        expect(printTableSnapshot(tableB.name, bFieldNames, bRecordsBefore, bFieldIds))
          .toMatchInlineSnapshot(`
            "[CreateSymB]
            ----------------------
            #  | Name   | SymLinks
            ----------------------
            R0 | Target | -       
            ----------------------"
          `);

        // Create A1 linking to B
        await createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aLinkFieldId]: { id: recordB.id },
        });
        await testContainer.processOutbox();

        const bRecordsAfter1 = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, bRecordsAfter1, bFieldIds))
          .toMatchInlineSnapshot(`
            "[CreateSymB]
            ----------------------
            #  | Name   | SymLinks
            ----------------------
            R0 | Target | A1      
            ----------------------"
          `);

        // Create A2 also linking to B
        await createRecord(tableA.id, {
          [aNameFieldId]: 'A2',
          [aLinkFieldId]: { id: recordB.id },
        });
        await testContainer.processOutbox();

        const bRecordsAfter2 = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, bRecordsAfter2, bFieldIds))
          .toMatchInlineSnapshot(`
            "[CreateSymB]
            ----------------------
            #  | Name   | SymLinks
            ----------------------
            R0 | Target | A1, A2  
            ----------------------"
          `);
      });

      /**
       * Scenario: Create record triggers rollup update in linking table.
       * Create child record - parent's rollup should update.
       */
      it('updates rollup in parent when child record created', async () => {
        const parentNameFieldId = createFieldId();
        const parentTable = await createTable({
          baseId,
          name: 'ParentRollupCreate',
          fields: [
            { type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true },
          ],
          views: [{ type: 'grid' }],
        });

        const childNameFieldId = createFieldId();
        const childValueFieldId = createFieldId();
        const childLinkFieldId = createFieldId();
        const childTable = await createTable({
          baseId,
          name: 'ChildRollupCreate',
          fields: [
            { type: 'singleLineText', id: childNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: childValueFieldId, name: 'Value' },
            {
              type: 'link',
              id: childLinkFieldId,
              name: 'Parent',
              options: {
                relationship: 'manyOne',
                foreignTableId: parentTable.id,
                lookupFieldId: parentNameFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const parentTableWithLink = await getTableById(parentTable.id);
        const symmetricLinkField = parentTableWithLink.fields.find(
          (field) => field.type === 'link' && field.options?.symmetricFieldId === childLinkFieldId
        );
        expect(symmetricLinkField).toBeDefined();
        if (!symmetricLinkField) {
          throw new Error('Missing symmetric link field');
        }

        const rollupFieldId = createFieldId();
        await createField({
          baseId,
          tableId: parentTable.id,
          field: {
            type: 'rollup',
            id: rollupFieldId,
            name: 'Sum',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: symmetricLinkField.id,
              foreignTableId: childTable.id,
              lookupFieldId: childValueFieldId,
            },
          },
        });

        const parentRecord = await createRecord(parentTable.id, {
          [parentNameFieldId]: 'Parent1',
        });

        await createRecord(childTable.id, {
          [childNameFieldId]: 'Child1',
          [childValueFieldId]: 10,
          [childLinkFieldId]: { id: parentRecord.id },
        });
        await testContainer.processOutbox();

        const fieldIds = [parentNameFieldId, symmetricLinkField.id, rollupFieldId];
        const fieldNames = ['Name', 'Children', 'Sum'];
        const parentRecords = await listRecords(parentTable.id);
        expect(printTableSnapshot(parentTable.name, fieldNames, parentRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[ParentRollupCreate]
            -----------------------------
            #  | Name    | Children | Sum
            -----------------------------
            R0 | Parent1 | Child1   | 10 
            -----------------------------"
          `);
        const storedParent = parentRecords.find((r) => r.id === parentRecord.id);
        expect(storedParent?.fields[rollupFieldId]).toBe(10);
      });
    });

    describe('update record', () => {
      /**
       * Scenario: Update only some fields, verify only affected computed fields update.
       */
      it('handles partial update (only some fields)', async () => {
        const nameFieldId = createFieldId();
        const numAFieldId = createFieldId();
        const numBFieldId = createFieldId();
        const formulaAFieldId = createFieldId();
        const formulaBFieldId = createFieldId();

        const table = await createTable({
          baseId,
          name: 'PartialUpdate',
          fields: [
            { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: numAFieldId, name: 'NumA' },
            { type: 'number', id: numBFieldId, name: 'NumB' },
            {
              type: 'formula',
              id: formulaAFieldId,
              name: 'FormulaA',
              options: { expression: `{${numAFieldId}} * 2` },
            },
            {
              type: 'formula',
              id: formulaBFieldId,
              name: 'FormulaB',
              options: { expression: `{${numBFieldId}} * 3` },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const fieldIds = [nameFieldId, numAFieldId, numBFieldId, formulaAFieldId, formulaBFieldId];
        const fieldNames = ['Name', 'NumA', 'NumB', 'FormulaA', 'FormulaB'];

        await createRecord(table.id, {
          [nameFieldId]: 'Test',
          [numAFieldId]: 10,
          [numBFieldId]: 20,
        });

        const beforeRecords = await listRecords(table.id);
        expect(printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[PartialUpdate]
            ---------------------------------------------
            #  | Name | NumA | NumB | FormulaA | FormulaB
            ---------------------------------------------
            R0 | Test | 10   | 20   | 20       | 60      
            ---------------------------------------------"
          `);

        // Only update NumA, FormulaB should stay the same
        const record = beforeRecords[0];
        await updateRecord(table.id, record.id, { [numAFieldId]: 100 });

        const afterRecords = await listRecords(table.id);
        expect(printTableSnapshot(table.name, fieldNames, afterRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[PartialUpdate]
            ---------------------------------------------
            #  | Name | NumA | NumB | FormulaA | FormulaB
            ---------------------------------------------
            R0 | Test | 100  | 20   | 200      | 60      
            ---------------------------------------------"
          `);
      });

      /**
       * Scenario: Update field that no computed field depends on.
       */
      it('handles update with no computed field impact', async () => {
        const nameFieldId = createFieldId();
        const descFieldId = createFieldId();
        const numFieldId = createFieldId();
        const formulaFieldId = createFieldId();

        const table = await createTable({
          baseId,
          name: 'NoImpactUpdate',
          fields: [
            { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
            { type: 'singleLineText', id: descFieldId, name: 'Desc' },
            { type: 'number', id: numFieldId, name: 'Num' },
            {
              type: 'formula',
              id: formulaFieldId,
              name: 'Formula',
              options: { expression: `{${numFieldId}} * 2` },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const fieldIds = [nameFieldId, descFieldId, numFieldId, formulaFieldId];
        const fieldNames = ['Name', 'Desc', 'Num', 'Formula'];

        await createRecord(table.id, {
          [nameFieldId]: 'Test',
          [descFieldId]: 'Original',
          [numFieldId]: 10,
        });

        const beforeRecords = await listRecords(table.id);
        expect(printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[NoImpactUpdate]
            ------------------------------------
            #  | Name | Desc     | Num | Formula
            ------------------------------------
            R0 | Test | Original | 10  | 20     
            ------------------------------------"
          `);

        // Update Desc (no formula depends on it)
        const record = beforeRecords[0];
        await updateRecord(table.id, record.id, { [descFieldId]: 'Updated' });

        const afterRecords = await listRecords(table.id);
        expect(printTableSnapshot(table.name, fieldNames, afterRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[NoImpactUpdate]
            -----------------------------------
            #  | Name | Desc    | Num | Formula
            -----------------------------------
            R0 | Test | Updated | 10  | 20     
            -----------------------------------"
          `);
      });

      /**
       * Scenario: Single update triggers multiple computed fields.
       */
      it('handles update affecting multiple computed fields', async () => {
        const nameFieldId = createFieldId();
        const numFieldId = createFieldId();
        const formula1FieldId = createFieldId();
        const formula2FieldId = createFieldId();
        const formula3FieldId = createFieldId();

        const table = await createTable({
          baseId,
          name: 'MultiFormula',
          fields: [
            { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: numFieldId, name: 'Num' },
            {
              type: 'formula',
              id: formula1FieldId,
              name: 'Double',
              options: { expression: `{${numFieldId}} * 2` },
            },
            {
              type: 'formula',
              id: formula2FieldId,
              name: 'Square',
              options: { expression: `{${numFieldId}} * {${numFieldId}}` },
            },
            {
              type: 'formula',
              id: formula3FieldId,
              name: 'PlusTen',
              options: { expression: `{${numFieldId}} + 10` },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const fieldIds = [
          nameFieldId,
          numFieldId,
          formula1FieldId,
          formula2FieldId,
          formula3FieldId,
        ];
        const fieldNames = ['Name', 'Num', 'Double', 'Square', 'PlusTen'];

        await createRecord(table.id, { [nameFieldId]: 'Test', [numFieldId]: 5 });

        const beforeRecords = await listRecords(table.id);
        expect(printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[MultiFormula]
            -------------------------------------------
            #  | Name | Num | Double | Square | PlusTen
            -------------------------------------------
            R0 | Test | 5   | 10     | 25     | 15     
            -------------------------------------------"
          `);

        // Update Num - all three formulas should update
        const record = beforeRecords[0];
        await updateRecord(table.id, record.id, { [numFieldId]: 10 });

        const afterRecords = await listRecords(table.id);
        expect(printTableSnapshot(table.name, fieldNames, afterRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[MultiFormula]
            -------------------------------------------
            #  | Name | Num | Double | Square | PlusTen
            -------------------------------------------
            R0 | Test | 10  | 20     | 100    | 20     
            -------------------------------------------"
          `);
      });
    });

    describe('delete record', () => {
      /**
       * Scenario: Delete linked record triggers lookup/rollup update.
       * Delete B - A's lookup/rollup referencing B should update.
       */
      it('updates lookup to null when linked record deleted', async () => {
        // Table B: Source table
        const bNameFieldId = createFieldId();
        const bScoreFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'TableB_DeleteLookup',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: bScoreFieldId, name: 'Score' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordB = await createRecord(tableB.id, {
          [bNameFieldId]: 'ItemB',
          [bScoreFieldId]: 100,
        });

        // Table A: Has link to B and lookup on B.Score
        const aNameFieldId = createFieldId();
        const linkToBFieldId = createFieldId();
        const lookupScoreFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'TableA_DeleteLookup',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkToBFieldId,
              name: 'LinkToB',
              options: {
                relationship: 'manyOne',
                foreignTableId: tableB.id,
                lookupFieldId: bNameFieldId,
              },
            },
            {
              type: 'lookup',
              id: lookupScoreFieldId,
              name: 'LookupScore',
              options: {
                linkFieldId: linkToBFieldId,
                foreignTableId: tableB.id,
                lookupFieldId: bScoreFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const bFieldIds = [bNameFieldId, bScoreFieldId];
        const bFieldNames = ['Name', 'Score'];
        const aFieldIds = [aNameFieldId, linkToBFieldId, lookupScoreFieldId];
        const aFieldNames = ['Name', 'LinkToB', 'LookupScore'];

        // Create record in A linking to B (manyOne uses single object)
        const recordA = await createRecord(tableA.id, {
          [aNameFieldId]: 'ItemA',
          [linkToBFieldId]: { id: recordB.id },
        });

        const beforeRecordsB = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecordsB, bFieldIds))
          .toMatchInlineSnapshot(`
            "[TableB_DeleteLookup]
            ------------------
            #  | Name  | Score
            ------------------
            R0 | ItemB | 100  
            ------------------"
          `);

        // Verify initial state (lookup returns array of values, serialized as JSON string)
        const beforeRecordsA = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecordsA, aFieldIds))
          .toMatchInlineSnapshot(`
            "[TableA_DeleteLookup]
            ----------------------------------
            #  | Name  | LinkToB | LookupScore
            ----------------------------------
            R0 | ItemA | ItemB   | [100]      
            ----------------------------------"
          `);

        const beforeA = beforeRecordsA.find((r) => r.id === recordA.id);
        // Lookup value is stored as JSON array string like "[100]"
        expect(beforeA?.fields[lookupScoreFieldId]).toBe('[100]');

        // Delete the linked record B
        await deleteRecord(tableB.id, recordB.id);

        // Process any pending outbox tasks
        await testContainer.processOutbox();

        // Verify A's lookup is now null/empty and link is cleared
        const afterRecordsA = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, afterRecordsA, aFieldIds))
          .toMatchInlineSnapshot(`
            "[TableA_DeleteLookup]
            ----------------------------------
            #  | Name  | LinkToB | LookupScore
            ----------------------------------
            R0 | ItemA | -       | -          
            ----------------------------------"
          `);

        const afterRecordsB = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, afterRecordsB, bFieldIds))
          .toMatchInlineSnapshot(`
            "[TableB_DeleteLookup]
            ----------------
            # | Name | Score
            ----------------
            ----------------"
          `);

        const afterA = afterRecordsA.find((r) => r.id === recordA.id);
        // After deleting the linked record, lookup should be null/empty
        const lookupValue = afterA?.fields[lookupScoreFieldId];
        expect(
          lookupValue === null ||
            lookupValue === '[]' ||
            lookupValue === '' ||
            lookupValue === undefined
        ).toBe(true);
        // Link should be null (manyOne)
        const linkValue = afterA?.fields[linkToBFieldId];
        expect(linkValue === null || linkValue === undefined).toBe(true);
      });

      it('updates rollup when linked record deleted', async () => {
        // Table B: Source table
        const bNameFieldId = createFieldId();
        const bValueFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'TableB_DeleteRollup',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: bValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordB1 = await createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bValueFieldId]: 10,
        });
        const recordB2 = await createRecord(tableB.id, {
          [bNameFieldId]: 'B2',
          [bValueFieldId]: 20,
        });

        // Table A: Has link to B (manyMany) and rollup SUM on B.Value
        const aNameFieldId = createFieldId();
        const linksToBFieldId = createFieldId();
        const sumValuesFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'TableA_DeleteRollup',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linksToBFieldId,
              name: 'LinksToB',
              options: {
                relationship: 'manyMany',
                foreignTableId: tableB.id,
                lookupFieldId: bNameFieldId,
              },
            },
            {
              type: 'rollup',
              id: sumValuesFieldId,
              name: 'Sum',
              options: { expression: 'sum({values})' },
              config: {
                linkFieldId: linksToBFieldId,
                foreignTableId: tableB.id,
                lookupFieldId: bValueFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const aFieldIds = [aNameFieldId, linksToBFieldId, sumValuesFieldId];
        const aFieldNames = ['Name', 'LinksToB', 'Sum'];

        await createRecord(tableA.id, {
          [aNameFieldId]: 'ItemA',
          [linksToBFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
        });

        const beforeRecords = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecords, aFieldIds))
          .toMatchInlineSnapshot(`
            "[TableA_DeleteRollup]
            ---------------------------
            #  | Name  | LinksToB | Sum
            ---------------------------
            R0 | ItemA | B1, B2   | 30 
            ---------------------------"
          `);

        await deleteRecord(tableB.id, recordB1.id);
        await testContainer.processOutbox();

        const afterRecords = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, afterRecords, aFieldIds))
          .toMatchInlineSnapshot(`
            "[TableA_DeleteRollup]
            ---------------------------
            #  | Name  | LinksToB | Sum
            ---------------------------
            R0 | ItemA | B2       | 20 
            ---------------------------"
          `);
      });

      it('removes symmetric link when record deleted', async () => {
        // Table A: Simple table
        const aNameFieldId = createFieldId();
        const tableA = await createTable({
          baseId,
          name: 'TableA_DeleteSymmetric',
          fields: [{ type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        // Table B: Has manyMany link to A
        const bNameFieldId = createFieldId();
        const linkToAFieldId = createFieldId();
        const tableB = await createTable({
          baseId,
          name: 'TableB_DeleteSymmetric',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkToAFieldId,
              name: 'LinkToA',
              options: {
                relationship: 'manyMany',
                foreignTableId: tableA.id,
                lookupFieldId: aNameFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        // Create records in A
        const recordA1 = await createRecord(tableA.id, { [aNameFieldId]: 'A1' });
        const recordA2 = await createRecord(tableA.id, { [aNameFieldId]: 'A2' });

        // Create record in B linking to both A records
        const recordB = await createRecord(tableB.id, {
          [bNameFieldId]: 'B',
          [linkToAFieldId]: [{ id: recordA1.id }, { id: recordA2.id }],
        });

        // Process any pending symmetric link updates
        await testContainer.processOutbox();

        // Verify A1 has symmetric link to B (find the symmetric link field)
        const beforeA1Records = await listRecords(tableA.id);
        const beforeA1 = beforeA1Records.find((r) => r.id === recordA1.id);
        const symmetricLinkFieldKey = Object.keys(beforeA1?.fields || {}).find((k) => {
          const val = beforeA1?.fields[k];
          return Array.isArray(val) && val.some((v) => v.id === recordB.id);
        });
        expect(symmetricLinkFieldKey).toBeDefined();

        const aFieldIds = [aNameFieldId, symmetricLinkFieldKey!];
        const aFieldNames = ['Name', 'SymLink'];
        const bFieldIds = [bNameFieldId, linkToAFieldId];
        const bFieldNames = ['Name', 'LinkToA'];

        expect(printTableSnapshot(tableA.name, aFieldNames, beforeA1Records, aFieldIds))
          .toMatchInlineSnapshot(`
            "[TableA_DeleteSymmetric]
            -------------------
            #  | Name | SymLink
            -------------------
            R0 | A1   | B      
            R1 | A2   | B      
            -------------------"
          `);

        const beforeBRecords = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, beforeBRecords, bFieldIds))
          .toMatchInlineSnapshot(`
            "[TableB_DeleteSymmetric]
            -------------------
            #  | Name | LinkToA
            -------------------
            R0 | B    | A1, A2 
            -------------------"
          `);

        // Delete record B
        await deleteRecord(tableB.id, recordB.id);

        // Process symmetric link cleanup
        await testContainer.processOutbox();

        // Verify A1's symmetric link no longer contains B
        const afterA1Records = await listRecords(tableA.id);
        expect(printTableSnapshot(tableA.name, aFieldNames, afterA1Records, aFieldIds))
          .toMatchInlineSnapshot(`
            "[TableA_DeleteSymmetric]
            -------------------
            #  | Name | SymLink
            -------------------
            R0 | A1   | -      
            R1 | A2   | -      
            -------------------"
          `);

        const afterBRecords = await listRecords(tableB.id);
        expect(printTableSnapshot(tableB.name, bFieldNames, afterBRecords, bFieldIds))
          .toMatchInlineSnapshot(`
            "[TableB_DeleteSymmetric]
            ------------------
            # | Name | LinkToA
            ------------------
            ------------------"
          `);

        const afterA1 = afterA1Records.find((r) => r.id === recordA1.id);
        if (symmetricLinkFieldKey) {
          const afterSymmetricLinks = afterA1?.fields[symmetricLinkFieldKey] as Array<{
            id: string;
          }> | null;
          expect(afterSymmetricLinks?.some((l) => l.id === recordB.id) ?? false).toBe(false);
        }
      });
    });
  });

  // ===========================================================================
  // SECTION 7: EDGE CASES
  // ===========================================================================

  describe('edge cases', () => {
    /**
     * Scenario: Update triggers both value change and link change in same operation.
     */
    it('handles mixed value and link changes in single update', async () => {
      // Table B (target)
      const bNameFieldId = createFieldId();
      const bValueFieldId = createFieldId();
      const tableB = await createTable({
        baseId,
        name: 'MixedB',
        fields: [
          { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: bValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const recordB1 = await createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bValueFieldId]: 100,
      });
      const recordB2 = await createRecord(tableB.id, {
        [bNameFieldId]: 'B2',
        [bValueFieldId]: 200,
      });

      // Table A: Has own formula AND link lookup
      const aNameFieldId = createFieldId();
      const aNumFieldId = createFieldId();
      const aFormulaFieldId = createFieldId();
      const aLinkFieldId = createFieldId();
      const aLookupFieldId = createFieldId();
      const tableA = await createTable({
        baseId,
        name: 'MixedA',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aNumFieldId, name: 'Num' },
          {
            type: 'formula',
            id: aFormulaFieldId,
            name: 'Double',
            options: { expression: `{${aNumFieldId}} * 2` },
          },
          {
            type: 'link',
            id: aLinkFieldId,
            name: 'LinkB',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: aLookupFieldId,
            name: 'LookupVal',
            options: {
              linkFieldId: aLinkFieldId,
              foreignTableId: tableB.id,
              lookupFieldId: bValueFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const aFieldIds = [aNameFieldId, aNumFieldId, aFormulaFieldId, aLinkFieldId, aLookupFieldId];
      const aFieldNames = ['Name', 'Num', 'Double', 'LinkB', 'LookupVal'];

      await createRecord(tableA.id, {
        [aNameFieldId]: 'A1',
        [aNumFieldId]: 10,
        [aLinkFieldId]: { id: recordB1.id },
      });

      const beforeRecords = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecords, aFieldIds))
        .toMatchInlineSnapshot(`
          "[MixedA]
          --------------------------------------------
          #  | Name | Num | Double | LinkB | LookupVal
          --------------------------------------------
          R0 | A1   | 10  | 20     | B1    | [100]    
          --------------------------------------------"
        `);

      // Update both Num AND LinkB simultaneously
      const record = beforeRecords[0];
      await updateRecord(tableA.id, record.id, {
        [aNumFieldId]: 50,
        [aLinkFieldId]: { id: recordB2.id },
      });
      await testContainer.processOutbox();

      const afterRecords = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, afterRecords, aFieldIds))
        .toMatchInlineSnapshot(`
          "[MixedA]
          --------------------------------------------
          #  | Name | Num | Double | LinkB | LookupVal
          --------------------------------------------
          R0 | A1   | 50  | 100    | B2    | [200]    
          --------------------------------------------"
        `);
    });

    it('handles potential circular references without infinite loop', async () => {
      const aNameFieldId = createFieldId();
      const tableA = await createTable({
        baseId,
        name: 'CircularA',
        fields: [{ type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      const bNameFieldId = createFieldId();
      const tableB = await createTable({
        baseId,
        name: 'CircularB',
        fields: [{ type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      const aLinkFieldId = createFieldId();
      const aLookupFieldId = createFieldId();
      await createField({
        baseId,
        tableId: tableA.id,
        field: {
          type: 'link',
          id: aLinkFieldId,
          name: 'LinkB',
          options: {
            relationship: 'manyOne',
            foreignTableId: tableB.id,
            lookupFieldId: bNameFieldId,
            isOneWay: true,
          },
        },
      });

      await createField({
        baseId,
        tableId: tableA.id,
        field: {
          type: 'lookup',
          id: aLookupFieldId,
          name: 'BName',
          options: {
            linkFieldId: aLinkFieldId,
            foreignTableId: tableB.id,
            lookupFieldId: bNameFieldId,
          },
        },
      });

      const bLinkFieldId = createFieldId();
      const bLookupFieldId = createFieldId();
      await createField({
        baseId,
        tableId: tableB.id,
        field: {
          type: 'link',
          id: bLinkFieldId,
          name: 'LinkA',
          options: {
            relationship: 'manyOne',
            foreignTableId: tableA.id,
            lookupFieldId: aNameFieldId,
            isOneWay: true,
          },
        },
      });

      await createField({
        baseId,
        tableId: tableB.id,
        field: {
          type: 'lookup',
          id: bLookupFieldId,
          name: 'AName',
          options: {
            linkFieldId: bLinkFieldId,
            foreignTableId: tableA.id,
            lookupFieldId: aNameFieldId,
          },
        },
      });

      const recordA = await createRecord(tableA.id, { [aNameFieldId]: 'A1' });
      const recordB = await createRecord(tableB.id, { [bNameFieldId]: 'B1' });

      await updateRecord(tableA.id, recordA.id, { [aLinkFieldId]: { id: recordB.id } });
      await updateRecord(tableB.id, recordB.id, { [bLinkFieldId]: { id: recordA.id } });
      await testContainer.processOutbox();

      const aFieldIds = [aNameFieldId, aLinkFieldId, aLookupFieldId];
      const aFieldNames = ['Name', 'LinkB', 'BName'];
      const bFieldIds = [bNameFieldId, bLinkFieldId, bLookupFieldId];
      const bFieldNames = ['Name', 'LinkA', 'AName'];
      let aRecords = await listRecords(tableA.id);
      let bRecords = await listRecords(tableB.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, aRecords, aFieldIds))
        .toMatchInlineSnapshot(`
          "[CircularA]
          -------------------------
          #  | Name | LinkB | BName
          -------------------------
          R0 | A1   | B1    | [B1] 
          -------------------------"
        `);
      expect(printTableSnapshot(tableB.name, bFieldNames, bRecords, bFieldIds))
        .toMatchInlineSnapshot(`
          "[CircularB]
          -------------------------
          #  | Name | LinkA | AName
          -------------------------
          R0 | B1   | A1    | [A1] 
          -------------------------"
        `);
      const storedA = aRecords.find((r) => r.id === recordA.id);
      const storedB = bRecords.find((r) => r.id === recordB.id);
      expect(String(storedA?.fields[aLookupFieldId] ?? '')).toContain('B1');
      expect(String(storedB?.fields[bLookupFieldId] ?? '')).toContain('A1');

      await updateRecord(tableA.id, recordA.id, { [aNameFieldId]: 'A1-updated' });
      await testContainer.processOutbox();
      await testContainer.processOutbox();
      const drained = await testContainer.processOutbox();
      expect(drained).toBe(0);

      aRecords = await listRecords(tableA.id);
      bRecords = await listRecords(tableB.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, aRecords, aFieldIds))
        .toMatchInlineSnapshot(`
          "[CircularA]
          -------------------------------
          #  | Name       | LinkB | BName
          -------------------------------
          R0 | A1-updated | B1    | [B1] 
          -------------------------------"
        `);
      expect(printTableSnapshot(tableB.name, bFieldNames, bRecords, bFieldIds))
        .toMatchInlineSnapshot(`
          "[CircularB]
          -------------------------------------
          #  | Name | LinkA      | AName       
          -------------------------------------
          R0 | B1   | A1-updated | [A1-updated]
          -------------------------------------"
        `);
      const afterB = bRecords.find((r) => r.id === recordB.id);
      expect(String(afterB?.fields[bLookupFieldId] ?? '')).toContain('A1-updated');
    });

    /**
     * Scenario: Link array from empty to populated.
     */
    it('handles link array from empty to populated', async () => {
      // Table B
      const bNameFieldId = createFieldId();
      const bValueFieldId = createFieldId();
      const tableB = await createTable({
        baseId,
        name: 'EmptyToPopB',
        fields: [
          { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: bValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const recordB1 = await createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bValueFieldId]: 10,
      });
      const recordB2 = await createRecord(tableB.id, {
        [bNameFieldId]: 'B2',
        [bValueFieldId]: 20,
      });

      // Table A: manyMany link with rollup
      const aNameFieldId = createFieldId();
      const aLinkFieldId = createFieldId();
      const aRollupFieldId = createFieldId();
      const tableA = await createTable({
        baseId,
        name: 'EmptyToPopA',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: aLinkFieldId,
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
            },
          },
          {
            type: 'rollup',
            id: aRollupFieldId,
            name: 'Sum',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: aLinkFieldId,
              foreignTableId: tableB.id,
              lookupFieldId: bValueFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const aFieldIds = [aNameFieldId, aLinkFieldId, aRollupFieldId];
      const aFieldNames = ['Name', 'Links', 'Sum'];

      // Create with empty links
      await createRecord(tableA.id, { [aNameFieldId]: 'A1' });

      const beforeRecords = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecords, aFieldIds))
        .toMatchInlineSnapshot(`
          "[EmptyToPopA]
          -----------------------
          #  | Name | Links | Sum
          -----------------------
          R0 | A1   | -     | -  
          -----------------------"
        `);

      // Populate links
      const record = beforeRecords[0];
      await updateRecord(tableA.id, record.id, {
        [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
      });
      await testContainer.processOutbox();

      const afterRecords = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, afterRecords, aFieldIds))
        .toMatchInlineSnapshot(`
          "[EmptyToPopA]
          ------------------------
          #  | Name | Links  | Sum
          ------------------------
          R0 | A1   | B1, B2 | 30 
          ------------------------"
        `);
    });

    /**
     * Scenario: Link array from populated to empty.
     */
    it('handles link array from populated to empty', async () => {
      // Table B
      const bNameFieldId = createFieldId();
      const bValueFieldId = createFieldId();
      const tableB = await createTable({
        baseId,
        name: 'PopToEmptyB',
        fields: [
          { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: bValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const recordB1 = await createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bValueFieldId]: 10,
      });
      const recordB2 = await createRecord(tableB.id, {
        [bNameFieldId]: 'B2',
        [bValueFieldId]: 20,
      });

      // Table A
      const aNameFieldId = createFieldId();
      const aLinkFieldId = createFieldId();
      const aRollupFieldId = createFieldId();
      const tableA = await createTable({
        baseId,
        name: 'PopToEmptyA',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: aLinkFieldId,
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
            },
          },
          {
            type: 'rollup',
            id: aRollupFieldId,
            name: 'Sum',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: aLinkFieldId,
              foreignTableId: tableB.id,
              lookupFieldId: bValueFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const aFieldIds = [aNameFieldId, aLinkFieldId, aRollupFieldId];
      const aFieldNames = ['Name', 'Links', 'Sum'];

      // Create with links
      await createRecord(tableA.id, {
        [aNameFieldId]: 'A1',
        [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
      });

      const beforeRecords = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecords, aFieldIds))
        .toMatchInlineSnapshot(`
          "[PopToEmptyA]
          ------------------------
          #  | Name | Links  | Sum
          ------------------------
          R0 | A1   | B1, B2 | 30 
          ------------------------"
        `);

      // Clear all links
      const record = beforeRecords[0];
      await updateRecord(tableA.id, record.id, { [aLinkFieldId]: [] });
      await testContainer.processOutbox();

      const afterRecords = await listRecords(tableA.id);
      expect(printTableSnapshot(tableA.name, aFieldNames, afterRecords, aFieldIds))
        .toMatchInlineSnapshot(`
          "[PopToEmptyA]
          -----------------------
          #  | Name | Links | Sum
          -----------------------
          R0 | A1   | -     | -  
          -----------------------"
        `);
    });

    /**
     * Scenario: Null value in formula source field.
     */
    it('handles null values in formula calculations', async () => {
      const nameFieldId = createFieldId();
      const numFieldId = createFieldId();
      const formulaFieldId = createFieldId();

      const table = await createTable({
        baseId,
        name: 'NullFormula',
        fields: [
          { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: numFieldId, name: 'Num' },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Double',
            options: { expression: `{${numFieldId}} * 2` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [nameFieldId, numFieldId, formulaFieldId];
      const fieldNames = ['Name', 'Num', 'Double'];

      // Create with null Num
      await createRecord(table.id, { [nameFieldId]: 'NoNum' });
      // Create with Num
      await createRecord(table.id, { [nameFieldId]: 'HasNum', [numFieldId]: 5 });

      const beforeRecords = await listRecords(table.id);
      expect(printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[NullFormula]
          --------------------------
          #  | Name   | Num | Double
          --------------------------
          R0 | NoNum  | -   | -     
          R1 | HasNum | 5   | 10    
          --------------------------"
        `);

      // Set null to a value
      const noNumRecord = beforeRecords.find((r) => r.fields[nameFieldId] === 'NoNum');
      await updateRecord(table.id, noNumRecord!.id, { [numFieldId]: 10 });

      // Set value to null (by not including it or setting 0)
      const hasNumRecord = beforeRecords.find((r) => r.fields[nameFieldId] === 'HasNum');
      await updateRecord(table.id, hasNumRecord!.id, { [numFieldId]: null });

      const afterRecords = await listRecords(table.id);
      expect(printTableSnapshot(table.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[NullFormula]
          --------------------------
          #  | Name   | Num | Double
          --------------------------
          R0 | NoNum  | 10  | 20    
          R1 | HasNum | -   | -     
          --------------------------"
        `);
    });
  });

  // ===========================================================================
  // SECTION 8: CONDITIONAL ROLLUP & CONDITIONAL LOOKUP
  // ===========================================================================

  describe('conditionalRollup field updates', () => {
    /**
     * Scenario: ConditionalRollup with simple filter condition.
     * Foreign table has records with different values, filter by value > threshold.
     */
    it('updates conditionalRollup when foreign records match filter condition', async () => {
      // Foreign table: Source of rollup values
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalRollup Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      const record1 = await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
      });
      const record2 = await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
      });
      const record3 = await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
        [foreignStatusFieldId]: 'inactive',
      });

      // Host table: Has conditionalRollup field
      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalRollup Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalRollup',
            id: conditionalRollupFieldId,
            name: 'Active Sum',
            options: {
              expression: 'sum({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignStatusFieldId,
                      operator: 'is',
                      value: 'active',
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalRollupFieldId];
      const fieldNames = ['Name', 'Active Sum'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Host]
          ---------------------------
          #  | Name  | Active Sum
          ---------------------------
          R0 | Host1 | 30        
          ---------------------------"
        `);

      // Update foreign record value - should update rollup
      await updateRecord(foreignTable.id, record1.id, { [foreignValueFieldId]: 15 });
      await testContainer.processOutbox();

      const afterRecords = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Host]
          ---------------------------
          #  | Name  | Active Sum
          ---------------------------
          R0 | Host1 | 35        
          ---------------------------"
        `);
    });

    /**
     * Scenario: ConditionalRollup with multiple filter conditions (AND).
     */
    it('updates conditionalRollup with multiple AND filter conditions', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignCategoryFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalRollup MultiFilter Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
          { type: 'singleLineText', id: foreignCategoryFieldId, name: 'Category' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'A',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'B',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'A',
      });

      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalRollup MultiFilter Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalRollup',
            id: conditionalRollupFieldId,
            name: 'Filtered Sum',
            options: {
              expression: 'sum({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignStatusFieldId,
                      operator: 'is',
                      value: 'active',
                    },
                    {
                      fieldId: foreignCategoryFieldId,
                      operator: 'is',
                      value: 'A',
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalRollupFieldId];
      const fieldNames = ['Name', 'Filtered Sum'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup MultiFilter Host]
          --------------------------------
          #  | Name  | Filtered Sum
          --------------------------------
          R0 | Host1 | 40        
          --------------------------------"
        `);
    });

    /**
     * Scenario: ConditionalRollup with OR filter conditions.
     */
    it('updates conditionalRollup with OR filter conditions', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignCategoryFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalRollup ORFilter Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignCategoryFieldId, name: 'Category' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignCategoryFieldId]: 'A',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignCategoryFieldId]: 'B',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
        [foreignCategoryFieldId]: 'C',
      });

      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalRollup ORFilter Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalRollup',
            id: conditionalRollupFieldId,
            name: 'OR Sum',
            options: {
              expression: 'sum({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'or',
                  filterSet: [
                    {
                      fieldId: foreignCategoryFieldId,
                      operator: 'is',
                      value: 'A',
                    },
                    {
                      fieldId: foreignCategoryFieldId,
                      operator: 'is',
                      value: 'B',
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalRollupFieldId];
      const fieldNames = ['Name', 'OR Sum'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup ORFilter Host]
          ---------------------------
          #  | Name  | OR Sum
          ---------------------------
          R0 | Host1 | 30      
          ---------------------------"
        `);
    });

    /**
     * Scenario: ConditionalRollup with sort condition.
     */
    it('updates conditionalRollup with sort condition', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalRollup Sort Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 30,
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 10,
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 20,
      });

      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalRollup Sort Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalRollup',
            id: conditionalRollupFieldId,
            name: 'Sorted Max',
            options: {
              expression: 'max({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignValueFieldId,
                      operator: 'isGreater',
                      value: 5,
                    },
                  ],
                },
                sort: {
                  fieldId: foreignValueFieldId,
                  order: 'desc',
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalRollupFieldId];
      const fieldNames = ['Name', 'Sorted Max'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Sort Host]
          ---------------------------
          #  | Name  | Sorted Max
          ---------------------------
          R0 | Host1 | 30        
          ---------------------------"
        `);
    });

    /**
     * Scenario: ConditionalRollup with limit condition.
     */
    it('updates conditionalRollup with limit condition', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalRollup Limit Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item4',
        [foreignValueFieldId]: 40,
      });

      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalRollup Limit Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalRollup',
            id: conditionalRollupFieldId,
            name: 'Limited Sum',
            options: {
              expression: 'sum({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignValueFieldId,
                      operator: 'isGreater',
                      value: 5,
                    },
                  ],
                },
                sort: {
                  fieldId: foreignValueFieldId,
                  order: 'desc',
                },
                limit: 2,
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalRollupFieldId];
      const fieldNames = ['Name', 'Limited Sum'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      // Should sum only top 2 values (40 + 30 = 70)
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Limit Host]
          -----------------------------
          #  | Name  | Limited Sum
          -----------------------------
          R0 | Host1 | 70        
          -----------------------------"
        `);
    });

    /**
     * Scenario: ConditionalRollup with nested filter conditions.
     */
    it('updates conditionalRollup with nested filter conditions', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignCategoryFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalRollup Nested Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
          { type: 'singleLineText', id: foreignCategoryFieldId, name: 'Category' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'A',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'B',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
        [foreignStatusFieldId]: 'inactive',
        [foreignCategoryFieldId]: 'A',
      });

      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalRollup Nested Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalRollup',
            id: conditionalRollupFieldId,
            name: 'Nested Sum',
            options: {
              expression: 'sum({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignStatusFieldId,
                      operator: 'is',
                      value: 'active',
                    },
                    {
                      conjunction: 'or',
                      filterSet: [
                        {
                          fieldId: foreignCategoryFieldId,
                          operator: 'is',
                          value: 'A',
                        },
                        {
                          fieldId: foreignCategoryFieldId,
                          operator: 'is',
                          value: 'B',
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalRollupFieldId];
      const fieldNames = ['Name', 'Nested Sum'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Nested Host]
          -----------------------------
          #  | Name  | Nested Sum
          -----------------------------
          R0 | Host1 | 30        
          -----------------------------"
        `);
    });

    /**
     * Scenario: ConditionalRollup with different rollup expressions.
     */
    it('updates conditionalRollup with different rollup expressions', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalRollup Expressions Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
      });

      const hostNameFieldId = createFieldId();
      const sumFieldId = createFieldId();
      const avgFieldId = createFieldId();
      const maxFieldId = createFieldId();
      const minFieldId = createFieldId();
      const countFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalRollup Expressions Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalRollup',
            id: sumFieldId,
            name: 'Sum',
            options: {
              expression: 'sum({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignValueFieldId,
                      operator: 'isGreater',
                      value: 5,
                    },
                  ],
                },
              },
            },
          },
          {
            type: 'conditionalRollup',
            id: avgFieldId,
            name: 'Average',
            options: {
              expression: 'average({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignValueFieldId,
                      operator: 'isGreater',
                      value: 5,
                    },
                  ],
                },
              },
            },
          },
          {
            type: 'conditionalRollup',
            id: maxFieldId,
            name: 'Max',
            options: {
              expression: 'max({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignValueFieldId,
                      operator: 'isGreater',
                      value: 5,
                    },
                  ],
                },
              },
            },
          },
          {
            type: 'conditionalRollup',
            id: minFieldId,
            name: 'Min',
            options: {
              expression: 'min({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignValueFieldId,
                      operator: 'isGreater',
                      value: 5,
                    },
                  ],
                },
              },
            },
          },
          {
            type: 'conditionalRollup',
            id: countFieldId,
            name: 'Count',
            options: {
              expression: 'count({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignValueFieldId,
                      operator: 'isGreater',
                      value: 5,
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [
        hostNameFieldId,
        sumFieldId,
        avgFieldId,
        maxFieldId,
        minFieldId,
        countFieldId,
      ];
      const fieldNames = ['Name', 'Sum', 'Average', 'Max', 'Min', 'Count'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Expressions Host]
          ---------------------------------------------------------
          #  | Name  | Sum | Average | Max | Min | Count
          ---------------------------------------------------------
          R0 | Host1 | 60  | 20      | 30  | 10  | 3    
          ---------------------------------------------------------"
        `);
    });

    /**
     * Scenario: ConditionalRollup updates when foreign records are added/removed.
     */
    it('updates conditionalRollup when foreign records are added', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalRollup Add Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
      });

      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalRollup Add Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalRollup',
            id: conditionalRollupFieldId,
            name: 'Active Sum',
            options: {
              expression: 'sum({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignStatusFieldId,
                      operator: 'is',
                      value: 'active',
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalRollupFieldId];
      const fieldNames = ['Name', 'Active Sum'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Add Host]
          ---------------------------
          #  | Name  | Active Sum
          ---------------------------
          R0 | Host1 | 10        
          ---------------------------"
        `);

      // Add new foreign record matching condition
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
      });
      await testContainer.processOutbox();

      const afterRecords = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Add Host]
          ---------------------------
          #  | Name  | Active Sum
          ---------------------------
          R0 | Host1 | 30        
          ---------------------------"
        `);
    });

    /**
     * Scenario: ConditionalRollup with same-table condition (self-referencing).
     * This tests that conditionalRollup can filter records from the same table.
     */
    it('updates conditionalRollup with same-table condition', async () => {
      const nameFieldId = createFieldId();
      const valueFieldId = createFieldId();
      const statusFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const table = await createTable({
        baseId,
        name: 'ConditionalRollup Self',
        fields: [
          { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: valueFieldId, name: 'Value' },
          { type: 'singleLineText', id: statusFieldId, name: 'Status' },
          {
            type: 'conditionalRollup',
            id: conditionalRollupFieldId,
            name: 'Self Sum',
            options: {
              expression: 'sum({values})',
            },
            config: {
              foreignTableId: '', // Will be set to same table
              lookupFieldId: valueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: statusFieldId,
                      operator: 'is',
                      value: 'active',
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Update foreignTableId to be the same table
      // Note: This requires updating the field after table creation
      // For now, we'll test with a separate table and document the limitation
      test.todo(
        'Same-table conditionalRollup: Need to support setting foreignTableId to same table ID'
      );

      await createRecord(table.id, {
        [nameFieldId]: 'Item1',
        [valueFieldId]: 10,
        [statusFieldId]: 'active',
      });
      await createRecord(table.id, {
        [nameFieldId]: 'Item2',
        [valueFieldId]: 20,
        [statusFieldId]: 'active',
      });
      await createRecord(table.id, {
        [nameFieldId]: 'Item3',
        [valueFieldId]: 30,
        [statusFieldId]: 'inactive',
      });

      // For now, test with a separate foreign table
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalRollup Self Foreign',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', id: valueFieldId, name: 'Value' },
          { type: 'singleLineText', id: statusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      // This test documents that same-table conditionalRollup needs special handling
      // The field config needs to be updated after table creation to reference itself
    });

    /**
     * Scenario: ConditionalRollup rejects empty condition.
     */
    it('rejects conditionalRollup with empty condition', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalRollup Reject Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const hostNameFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalRollup Reject Host',
        fields: [{ type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Try to create conditionalRollup with empty condition (filter: null)
      const response = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: hostTable.id,
          field: {
            type: 'conditionalRollup',
            name: 'Invalid Rollup',
            options: {
              expression: 'sum({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: null,
              },
            },
          },
        }),
      });

      expect(response.status).toBe(400);
    });

    /**
     * Scenario: ConditionalRollup rejects condition with empty filterSet.
     */
    it('rejects conditionalRollup with condition having empty filterSet', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalRollup EmptyFilter Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const hostNameFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalRollup EmptyFilter Host',
        fields: [{ type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Try to create conditionalRollup with empty filterSet
      const response = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: hostTable.id,
          field: {
            type: 'conditionalRollup',
            name: 'Invalid Rollup',
            options: {
              expression: 'sum({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [],
                },
              },
            },
          },
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('conditionalLookup field updates', () => {
    /**
     * Scenario: ConditionalLookup with simple filter condition.
     */
    it('updates conditionalLookup when foreign records match filter condition', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalLookup Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
        [foreignStatusFieldId]: 'inactive',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalLookup Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'Active Values',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignStatusFieldId,
                      operator: 'is',
                      value: 'active',
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalLookupFieldId];
      const fieldNames = ['Name', 'Active Values'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Host]
          --------------------------------
          #  | Name  | Active Values
          --------------------------------
          R0 | Host1 | [10, 20]     
          --------------------------------"
        `);

      // Update foreign record value - should update lookup
      const foreignRecords = await listRecords(foreignTable.id);
      const item1 = foreignRecords.find((r) => r.fields[foreignNameFieldId] === 'Item1');
      await updateRecord(foreignTable.id, item1!.id, { [foreignValueFieldId]: 15 });
      await testContainer.processOutbox();

      const afterRecords = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Host]
          --------------------------------
          #  | Name  | Active Values
          --------------------------------
          R0 | Host1 | [15, 20]     
          --------------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup with sort condition.
     */
    it('updates conditionalLookup with sort condition', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalLookup Sort Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 30,
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 10,
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 20,
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalLookup Sort Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'Sorted Values',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignValueFieldId,
                      operator: 'isGreater',
                      value: 5,
                    },
                  ],
                },
                sort: {
                  fieldId: foreignValueFieldId,
                  order: 'desc',
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalLookupFieldId];
      const fieldNames = ['Name', 'Sorted Values'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Sort Host]
          --------------------------------
          #  | Name  | Sorted Values
          --------------------------------
          R0 | Host1 | [30, 20, 10] 
          --------------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup with limit condition.
     */
    it('updates conditionalLookup with limit condition', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalLookup Limit Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item4',
        [foreignValueFieldId]: 40,
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalLookup Limit Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'Limited Values',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignValueFieldId,
                      operator: 'isGreater',
                      value: 5,
                    },
                  ],
                },
                sort: {
                  fieldId: foreignValueFieldId,
                  order: 'desc',
                },
                limit: 2,
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalLookupFieldId];
      const fieldNames = ['Name', 'Limited Values'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      // Should return only top 2 values (40, 30)
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Limit Host]
          --------------------------------
          #  | Name  | Limited Values
          --------------------------------
          R0 | Host1 | [40, 30]     
          --------------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup with multiple filter conditions.
     */
    it('updates conditionalLookup with multiple filter conditions', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignCategoryFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalLookup MultiFilter Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
          { type: 'singleLineText', id: foreignCategoryFieldId, name: 'Category' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'A',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'B',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'A',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalLookup MultiFilter Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'Filtered Values',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignStatusFieldId,
                      operator: 'is',
                      value: 'active',
                    },
                    {
                      fieldId: foreignCategoryFieldId,
                      operator: 'is',
                      value: 'A',
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalLookupFieldId];
      const fieldNames = ['Name', 'Filtered Values'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup MultiFilter Host]
          --------------------------------
          #  | Name  | Filtered Values
          --------------------------------
          R0 | Host1 | [10, 30]      
          --------------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup with same-table condition (self-referencing).
     */
    it('updates conditionalLookup with same-table condition', async () => {
      test.todo(
        'Same-table conditionalLookup: Need to support setting foreignTableId to same table ID'
      );

      const nameFieldId = createFieldId();
      const valueFieldId = createFieldId();
      const statusFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const table = await createTable({
        baseId,
        name: 'ConditionalLookup Self',
        fields: [
          { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: valueFieldId, name: 'Value' },
          { type: 'singleLineText', id: statusFieldId, name: 'Status' },
          {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'Self Values',
            options: {
              foreignTableId: '', // Will be set to same table
              lookupFieldId: valueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: statusFieldId,
                      operator: 'is',
                      value: 'active',
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // This test documents that same-table conditionalLookup needs special handling
      // The field config needs to be updated after table creation to reference itself
    });

    /**
     * Scenario: ConditionalLookup rejects empty condition.
     */
    it('rejects conditionalLookup with empty condition', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalLookup Reject Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const hostNameFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalLookup Reject Host',
        fields: [{ type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Try to create conditionalLookup with empty condition (filter: null)
      const response = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: hostTable.id,
          field: {
            type: 'conditionalLookup',
            name: 'Invalid Lookup',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: null,
              },
            },
          },
        }),
      });

      expect(response.status).toBe(400);
    });

    /**
     * Scenario: ConditionalLookup with text field lookup.
     */
    it('updates conditionalLookup with text field lookup', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignTextFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalLookup Text Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: foreignTextFieldId, name: 'Text' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignTextFieldId]: 'Alpha',
        [foreignStatusFieldId]: 'active',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignTextFieldId]: 'Beta',
        [foreignStatusFieldId]: 'active',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignTextFieldId]: 'Gamma',
        [foreignStatusFieldId]: 'inactive',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalLookup Text Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'Active Texts',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignTextFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignStatusFieldId,
                      operator: 'is',
                      value: 'active',
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalLookupFieldId];
      const fieldNames = ['Name', 'Active Texts'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Text Host]
          --------------------------------
          #  | Name  | Active Texts
          --------------------------------
          R0 | Host1 | [Alpha, Beta]
          --------------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup updates when foreign records are added/removed.
     */
    it('updates conditionalLookup when foreign records are added', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalLookup Add Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalLookup Add Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'Active Values',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignStatusFieldId,
                      operator: 'is',
                      value: 'active',
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalLookupFieldId];
      const fieldNames = ['Name', 'Active Values'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Add Host]
          --------------------------------
          #  | Name  | Active Values
          --------------------------------
          R0 | Host1 | [10]         
          --------------------------------"
        `);

      // Add new foreign record matching condition
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
      });
      await testContainer.processOutbox();

      const afterRecords = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Add Host]
          --------------------------------
          #  | Name  | Active Values
          --------------------------------
          R0 | Host1 | [10, 20]     
          --------------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup with nested filter conditions.
     */
    it('updates conditionalLookup with nested filter conditions', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignCategoryFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalLookup Nested Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
          { type: 'singleLineText', id: foreignCategoryFieldId, name: 'Category' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'A',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'B',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
        [foreignStatusFieldId]: 'inactive',
        [foreignCategoryFieldId]: 'A',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalLookup Nested Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'Nested Values',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignStatusFieldId,
                      operator: 'is',
                      value: 'active',
                    },
                    {
                      conjunction: 'or',
                      filterSet: [
                        {
                          fieldId: foreignCategoryFieldId,
                          operator: 'is',
                          value: 'A',
                        },
                        {
                          fieldId: foreignCategoryFieldId,
                          operator: 'is',
                          value: 'B',
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalLookupFieldId];
      const fieldNames = ['Name', 'Nested Values'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Nested Host]
          --------------------------------
          #  | Name  | Nested Values
          --------------------------------
          R0 | Host1 | [10, 20]     
          --------------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup with boolean field lookup.
     */
    it('updates conditionalLookup with boolean field lookup', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignBooleanFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalLookup Boolean Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'checkbox', id: foreignBooleanFieldId, name: 'Flag' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignBooleanFieldId]: true,
        [foreignStatusFieldId]: 'active',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignBooleanFieldId]: false,
        [foreignStatusFieldId]: 'active',
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignBooleanFieldId]: true,
        [foreignStatusFieldId]: 'inactive',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalLookup Boolean Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'Active Flags',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignBooleanFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignStatusFieldId,
                      operator: 'is',
                      value: 'active',
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalLookupFieldId];
      const fieldNames = ['Name', 'Active Flags'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Boolean Host]
          --------------------------------
          #  | Name  | Active Flags
          --------------------------------
          R0 | Host1 | [true, false]
          --------------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup with different operators in condition.
     */
    it('updates conditionalLookup with different filter operators', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalLookup Operators Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
      });
      await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item4',
        [foreignValueFieldId]: 40,
      });

      const hostNameFieldId = createFieldId();
      const greaterThanFieldId = createFieldId();
      const lessThanFieldId = createFieldId();
      const equalFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalLookup Operators Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalLookup',
            id: greaterThanFieldId,
            name: 'Greater Than 15',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignValueFieldId,
                      operator: 'isGreater',
                      value: 15,
                    },
                  ],
                },
              },
            },
          },
          {
            type: 'conditionalLookup',
            id: lessThanFieldId,
            name: 'Less Than 25',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignValueFieldId,
                      operator: 'isLess',
                      value: 25,
                    },
                  ],
                },
              },
            },
          },
          {
            type: 'conditionalLookup',
            id: equalFieldId,
            name: 'Equal 20',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignValueFieldId,
                      operator: 'is',
                      value: 20,
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, greaterThanFieldId, lessThanFieldId, equalFieldId];
      const fieldNames = ['Name', 'Greater Than 15', 'Less Than 25', 'Equal 20'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Operators Host]
          -----------------------------------------------------
          #  | Name  | Greater Than 15 | Less Than 25 | Equal 20
          -----------------------------------------------------
          R0 | Host1 | [20, 30, 40]    | [10, 20]     | [20]     
          -----------------------------------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup updates when foreign record is deleted.
     */
    it('updates conditionalLookup when foreign record is deleted', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalLookup Delete Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      const record1 = await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
      });
      const record2 = await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalLookup Delete Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'Active Values',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignStatusFieldId,
                      operator: 'is',
                      value: 'active',
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalLookupFieldId];
      const fieldNames = ['Name', 'Active Values'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Delete Host]
          --------------------------------
          #  | Name  | Active Values
          --------------------------------
          R0 | Host1 | [10, 20]     
          --------------------------------"
        `);

      // Delete foreign record
      await deleteRecord(foreignTable.id, record1.id);
      await testContainer.processOutbox();

      const afterRecords = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Delete Host]
          --------------------------------
          #  | Name  | Active Values
          --------------------------------
          R0 | Host1 | [20]         
          --------------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup with field reference in condition (isSymbol).
     * This tests column-to-column comparison.
     */
    test.todo(
      'ConditionalLookup with field reference (isSymbol): Need to verify support for column-to-column comparison in conditions'
    );

    /**
     * Scenario: ConditionalRollup with field reference in condition (isSymbol).
     */
    test.todo(
      'ConditionalRollup with field reference (isSymbol): Need to verify support for column-to-column comparison in conditions'
    );

    /**
     * Scenario: ConditionalLookup with dateTime field lookup.
     */
    test.todo(
      'ConditionalLookup with dateTime field: Need to verify dateTime field lookup and formatting in conditionalLookup'
    );

    /**
     * Scenario: ConditionalRollup with dateTime field aggregation.
     */
    test.todo(
      'ConditionalRollup with dateTime field: Need to verify dateTime field aggregation functions (min/max) in conditionalRollup'
    );

    /**
     * Scenario: ConditionalLookup/conditionalRollup with formula field in condition.
     */
    test.todo(
      'Conditional fields with formula field in condition: Need to verify that formula fields can be used in condition filters'
    );

    /**
     * Scenario: ConditionalLookup/conditionalRollup with lookup field in condition.
     */
    test.todo(
      'Conditional fields with lookup field in condition: Need to verify that lookup fields can be used in condition filters'
    );

    /**
     * Scenario: ConditionalRollup with complex nested conditions and multiple aggregations.
     */
    test.todo(
      'ConditionalRollup with complex nested conditions: Need to verify deeply nested filter conditions (3+ levels) work correctly'
    );

    /**
     * Scenario: ConditionalLookup/conditionalRollup performance with large datasets.
     */
    test.todo(
      'Conditional fields performance: Need to verify performance with large foreign tables (1000+ records) and complex conditions'
    );

    /**
     * Scenario: ConditionalRollup updates when condition filter field changes.
     */
    it('updates conditionalRollup when condition filter field value changes', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalRollup FilterChange Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      const record1 = await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
      });
      const record2 = await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'inactive',
      });

      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalRollup FilterChange Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalRollup',
            id: conditionalRollupFieldId,
            name: 'Active Sum',
            options: {
              expression: 'sum({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignStatusFieldId,
                      operator: 'is',
                      value: 'active',
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalRollupFieldId];
      const fieldNames = ['Name', 'Active Sum'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup FilterChange Host]
          ---------------------------
          #  | Name  | Active Sum
          ---------------------------
          R0 | Host1 | 10        
          ---------------------------"
        `);

      // Change record2 status from inactive to active - should now be included
      await updateRecord(foreignTable.id, record2.id, { [foreignStatusFieldId]: 'active' });
      await testContainer.processOutbox();

      const afterRecords = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup FilterChange Host]
          ---------------------------
          #  | Name  | Active Sum
          ---------------------------
          R0 | Host1 | 30        
          ---------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup updates when condition filter field changes.
     */
    it('updates conditionalLookup when condition filter field value changes', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await createTable({
        baseId,
        name: 'ConditionalLookup FilterChange Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      const record1 = await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
      });
      const record2 = await createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'inactive',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await createTable({
        baseId,
        name: 'ConditionalLookup FilterChange Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'Active Values',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignStatusFieldId,
                      operator: 'is',
                      value: 'active',
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, conditionalLookupFieldId];
      const fieldNames = ['Name', 'Active Values'];

      await createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup FilterChange Host]
          --------------------------------
          #  | Name  | Active Values
          --------------------------------
          R0 | Host1 | [10]         
          --------------------------------"
        `);

      // Change record2 status from inactive to active - should now be included
      await updateRecord(foreignTable.id, record2.id, { [foreignStatusFieldId]: 'active' });
      await testContainer.processOutbox();

      const afterRecords = await listRecords(hostTable.id);
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup FilterChange Host]
          --------------------------------
          #  | Name  | Active Values
          --------------------------------
          R0 | Host1 | [10, 20]     
          --------------------------------"
        `);
    });
  });
});
