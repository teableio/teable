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
 *
 * Test Structure:
 * 1. Simple scenarios: Basic formula, single-level lookup
 * 2. Chain scenarios: Multi-level formula chains, cross-table cascades
 * 3. Link scenarios: All relationship types (oneOne, oneMany, manyOne, manyMany)
 * 4. Primary field scenarios: Primary field is formula
 * 5. Self-referencing: Self-referential link updates
 * 6. Edge cases: Mixed triggers, concurrent updates
 *
 * Each test validates:
 * - Before/after table state via inline snapshots (using printTable)
 * - Update plan metrics (step count, table count)
 * - Final DB state correctness
 * - API response correctness
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  deleteRecordsOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import type { ICreateTableCommandInput } from '@teable/v2-core';
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
       *
       * Trigger: Update A.number
       * Expected: A.formula updates synchronously
       */
      it.todo('updates formula when source number field changes');

      /**
       * Scenario: Formula chain within same table.
       * A.number -> A.formula1 (number * 2) -> A.formula2 (formula1 + 10)
       *
       * Trigger: Update A.number
       * Expected: Both formulas update in correct order (formula1 before formula2)
       */
      it.todo('updates formula chain in correct order');

      /**
       * Scenario: Formula referencing text field with CONCATENATE.
       * A.text -> A.formula (CONCATENATE("Hello, ", text))
       *
       * Trigger: Update A.text
       * Expected: A.formula updates with new concatenated value
       */
      it.todo('updates formula when source text field changes');
    });

    describe('lookup field updates', () => {
      /**
       * Scenario: Basic lookup through link field.
       * TableA.name -> TableB.link -> TableB.lookup (looks up A.name)
       *
       * Trigger: Update A.name
       * Expected: B.lookup updates with new value
       */
      it.todo('updates lookup when source field in foreign table changes');

      /**
       * Scenario: Lookup updates when link relation changes.
       * TableA has records A1, A2. TableB.link points to A1.
       *
       * Trigger: Change B.link from A1 to A2
       * Expected: B.lookup updates to A2's value
       */
      it.todo('updates lookup when link relation changes');
    });

    describe('rollup field updates', () => {
      /**
       * Scenario: Rollup SUM of linked record values.
       * TableA.value (numbers) <- TableB.link (manyMany) -> TableB.rollup (SUM)
       *
       * Trigger: Update A.value
       * Expected: B.rollup updates with new sum
       */
      it.todo('updates rollup when linked record value changes');

      /**
       * Scenario: Rollup updates when link relation changes.
       *
       * Trigger: Add/remove records from B.link
       * Expected: B.rollup recalculates with new set
       */
      it.todo('updates rollup when link relation changes');
    });
  });

  // ===========================================================================
  // SECTION 2: CHAIN SCENARIOS
  // ===========================================================================

  describe('chain scenarios', () => {
    /**
     * Scenario: Three-level formula chain in same table.
     * A.number -> A.formula1 -> A.formula2 -> A.formula3
     *
     * This tests same-table batch optimization potential.
     */
    it.todo('updates three-level formula chain in same table');

    /**
     * Scenario: Cross-table lookup chain.
     * TableA.name -> TableB.lookup1 -> TableC.lookup2
     *
     * Trigger: Update A.name
     * Expected: B.lookup1 updates first, then C.lookup2 updates
     * Verification: Update order is correct (level ordering)
     */
    it.todo('updates cross-table lookup chain in correct level order');

    /**
     * Scenario: Mixed formula and lookup chain.
     * A.number -> A.formula -> B.lookup (looks up A.formula) -> B.formula (uses lookup)
     *
     * Trigger: Update A.number
     * Expected: A.formula -> B.lookup -> B.formula in order
     */
    it.todo('updates mixed formula-lookup chain across tables');

    /**
     * Scenario: Link title update chain.
     * A.name (primary) -> B.link (shows A.name as title) -> C.link (references B)
     *
     * Trigger: Update A.name
     * Expected: B.link title updates, C.link if it references B also updates
     */
    it.todo('updates link titles through chain');
  });

  // ===========================================================================
  // SECTION 3: LINK SCENARIOS - RELATIONSHIP TYPES
  // ===========================================================================

  describe('link relationship types', () => {
    describe('oneOne relationship', () => {
      /**
       * oneOne: Each record in A links to exactly one record in B, and vice versa.
       *
       * Scenarios:
       * - Create link: Both sides see the relationship
       * - Update linked value: Lookup updates
       * - Change link target: Old target loses link, new target gains link
       */
      it.todo('oneOne twoWay - updates symmetric link when link changes');
      it.todo('oneOne twoWay - updates lookup when linked value changes');
      it.todo('oneOne oneWay - no symmetric link in foreign table');
    });

    describe('oneMany relationship', () => {
      /**
       * oneMany: One record in A links to many records in B.
       * From A's perspective: array of B records.
       * From B's perspective (symmetric): single A record.
       *
       * Scenarios:
       * - Add B record to A.link
       * - Remove B record from A.link
       * - Update B's value that A's lookup references
       */
      it.todo('oneMany twoWay - symmetric link shows parent in child records');
      it.todo('oneMany twoWay - rollup updates when adding/removing children');
      it.todo('oneMany oneWay - no symmetric link in foreign table');
    });

    describe('manyOne relationship', () => {
      /**
       * manyOne: Many records in A link to one record in B.
       * From A's perspective: single B record.
       * From B's perspective (symmetric): array of A records.
       *
       * Scenarios:
       * - Multiple A records point to same B
       * - Change A's link from B1 to B2
       * - Update B's value that A's lookup references
       */
      it.todo('manyOne twoWay - multiple records can link to same foreign record');
      it.todo('manyOne twoWay - symmetric link shows all children in parent');
      it.todo('manyOne oneWay - updates lookup when changing link target');
    });

    describe('manyMany relationship', () => {
      /**
       * manyMany: Many records in A link to many records in B.
       * Uses junction table for storage.
       *
       * Scenarios:
       * - Add/remove from link array
       * - Both sides show the relationship (twoWay)
       * - Rollup aggregates all linked values
       */
      it.todo('manyMany twoWay - junction table maintains both sides');
      it.todo('manyMany twoWay - rollup updates with add/remove');
      it.todo('manyMany oneWay - only main table shows links');
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
     *
     * Trigger: Update A.value
     * Expected: A.primary updates, B.link titles update
     */
    it.todo('updates link titles when primary formula field changes');

    /**
     * Scenario: Chain starting from formula primary field.
     * A.number -> A.primary (formula) -> B.lookup (primary) -> B.formula (uses lookup)
     *
     * Trigger: Update A.number
     * Expected: Full chain updates in order
     */
    it.todo('propagates formula primary field changes through lookup chain');
  });

  // ===========================================================================
  // SECTION 5: SELF-REFERENCING LINKS
  // ===========================================================================

  describe('self-referencing links', () => {
    /**
     * Scenario: Self-referential manyOne (parent-child hierarchy).
     * Table.name, Table.parent (link to self), Table.parentName (lookup of parent.name)
     *
     * Trigger: Update parent's name
     * Expected: All children's parentName lookup updates
     */
    it.todo('self manyOne - updates child lookups when parent name changes');

    /**
     * Scenario: Self-referential manyMany (e.g., friends relationship).
     * Table.name, Table.friends (link to self), Table.friendCount (rollup COUNT)
     *
     * Trigger: Add/remove friends
     * Expected: friendCount updates for affected records
     */
    it.todo('self manyMany - updates rollup when adding/removing self-links');

    /**
     * Scenario: Self-referential with formula chain.
     * Table.value, Table.parent, Table.parentValue (lookup), Table.combined (formula using parentValue)
     *
     * This creates cross_record dependencies within the same table.
     */
    it.todo('self link with formula chain - handles cross_record dependencies correctly');
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
      it.todo('calculates formula fields on record creation');

      /**
       * Scenario: Create record with link triggers symmetric link update.
       * A.link points to B - B's symmetric link should show A.
       */
      it.todo('updates symmetric links on record creation with link');

      /**
       * Scenario: Create record triggers rollup update in linking table.
       * Create child record - parent's rollup should update.
       */
      it.todo('updates rollup in parent when child record created');
    });

    describe('update record', () => {
      /**
       * Already covered in chain scenarios above.
       * Additional edge cases:
       */
      it.todo('handles partial update (only some fields)');
      it.todo('handles update with no computed field impact');
      it.todo('handles update affecting multiple computed fields');
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

        // Create record in A linking to B (manyOne uses single object)
        const recordA = await createRecord(tableA.id, {
          [aNameFieldId]: 'ItemA',
          [linkToBFieldId]: { id: recordB.id },
        });

        // Verify initial state (lookup returns array of values, serialized as JSON string)
        const beforeRecords = await listRecords(tableA.id);
        const beforeA = beforeRecords.find((r) => r.id === recordA.id);
        // Lookup value is stored as JSON array string like "[100]"
        expect(beforeA?.fields[lookupScoreFieldId]).toBe('[100]');

        // Delete the linked record B
        await deleteRecord(tableB.id, recordB.id);

        // Process any pending outbox tasks
        await testContainer.processOutbox();

        // Verify A's lookup is now null/empty and link is cleared
        const afterRecords = await listRecords(tableA.id);
        const afterA = afterRecords.find((r) => r.id === recordA.id);
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
              name: 'SumValues',
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

        // Create record in A linking to both B records
        const recordA = await createRecord(tableA.id, {
          [aNameFieldId]: 'ItemA',
          [linksToBFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
        });

        // Verify initial state: rollup should be 30
        const beforeRecords = await listRecords(tableA.id);
        const beforeA = beforeRecords.find((r) => r.id === recordA.id);
        expect(beforeA?.fields[sumValuesFieldId]).toBe(30);

        // Delete one of the linked records
        await deleteRecord(tableB.id, recordB1.id);

        // Process any pending outbox tasks
        await testContainer.processOutbox();

        // Verify A's rollup is now 20 (only B2 remains)
        const afterRecords = await listRecords(tableA.id);
        const afterA = afterRecords.find((r) => r.id === recordA.id);
        expect(afterA?.fields[sumValuesFieldId]).toBe(20);
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

        // Delete record B
        await deleteRecord(tableB.id, recordB.id);

        // Process symmetric link cleanup
        await testContainer.processOutbox();

        // Verify A1's symmetric link no longer contains B
        const afterA1Records = await listRecords(tableA.id);
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
     * Update A.text and A.link simultaneously.
     */
    it.todo('handles mixed value and link changes in single update');

    /**
     * Scenario: Circular dependency prevention.
     * A.formula1 references B.lookup which references A.formula1's source.
     * Should not cause infinite loop.
     */
    it.todo('handles potential circular references without infinite loop');

    /**
     * Scenario: Empty link array to non-empty (and vice versa).
     */
    it.todo('handles link array from empty to populated');
    it.todo('handles link array from populated to empty');

    /**
     * Scenario: Null value handling in formulas.
     * Formula references field that is null.
     */
    it.todo('handles null values in formula calculations');
  });

  // ===========================================================================
  // SECTION 8: IMPLEMENTED TESTS
  // ===========================================================================

  describe('implemented: basic formula chain', () => {
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
      const beforeSnapshot = printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds);

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

  describe('implemented: cross-table lookup', () => {
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

      // Create deal with link
      const deal = await createRecord(deals.id, {
        [dealNameFieldId]: 'Deal A',
        [linkFieldId]: [{ id: contact.id }],
      });

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

  describe('implemented: three-table cascade', () => {
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

      // Create B record linked to A
      const recordB = await createRecord(tableB.id, {
        [bNameFieldId]: 'Middle',
        [linkAFieldId]: [{ id: recordA.id }],
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

      // Create C record linked to B
      const recordC = await createRecord(tableC.id, {
        [cNameFieldId]: 'End',
        [linkBFieldId]: [{ id: recordB.id }],
      });

      // Before update
      const beforeRecords = await listRecords(tableC.id);
      const beforeSnapshot = printTableSnapshot(tableC.name, cFieldNames, beforeRecords, cFieldIds);

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

      // Small delay to let automatic dispatch settle before processOutbox claims the task
      await new Promise((r) => setTimeout(r, 50));

      // Process any pending outbox tasks (cross-table updates are async)
      await testContainer.processOutbox();

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
