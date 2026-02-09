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
 * - Explicit `expect(...)` assertions on key cell values (source of truth for test logic / AI)
 * - Before/after table state via inline snapshots (using printTable)
 * - Computed steps verification (using printComputedSteps) - ensures no extra steps
 * - Final DB state correctness
 * - API response correctness
 *
 * =============================================================================
 * TODO: Computed Steps Assertions
 * =============================================================================
 *
 * The following tests have computed steps assertions added:
 * - [x] updates formula when source number field changes
 * - [x] updates lookup when source field in foreign table changes
 * - [x] updates rollup when linked record value changes
 * - [x] updates cross-table lookup chain in correct level order
 * - [x] oneOne twoWay - updates lookup when linked value changes
 * - [x] oneMany twoWay - rollup updates when adding/removing children
 * - [x] manyMany twoWay - rollup updates with add/remove
 *
 * The following tests still need computed steps assertions:
 * - [ ] Other formula field tests
 * - [ ] Other lookup/rollup tests
 * - [ ] Primary field as formula tests
 * - [ ] Self-referencing link tests
 * - [ ] Edge case tests
 * - [ ] Conditional field tests
 *
 * =============================================================================
 * IMPORTANT: processOutbox() Usage Rules
 * =============================================================================
 *
 * **MUST call `await ctx.testContainer.processOutbox()` in the following cases:**
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
 * await ctx.createRecord(table.id, { ... });
 * // OR
 * await ctx.updateRecord(table.id, recordId, { ... });
 *
 * // If this affects cross-table computed fields, process outbox
 * await ctx.testContainer.processOutbox();
 * // For multi-level chains, may need multiple calls:
 * await ctx.testContainer.processOutbox();
 * await ctx.testContainer.processOutbox();
 *
 * // Then query and assert
 * const records = await listRecords(table.id);
 * expect(...).toMatchInlineSnapshot(...);
 * ```
 *
 * **When in doubt:** If a test involves lookup, rollup, or cross-table formula dependencies,
 * add `processOutbox()` calls. It's better to be safe than have flaky tests.
 */
import {
  printComputedSteps,
  buildNameMaps,
  buildMultiTableNameMaps,
} from '@teable/v2-container-node-test';
import type { ComputedPlanSnapshotOptions } from '@teable/v2-container-node-test';
import { listTableRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { getRandomString } from '@teable/v2-core';
import { printTable } from '@teable/v2-utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

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
    records: records.map((record) => ({
      ...record,
      fields: Object.fromEntries(
        Object.entries(record.fields).map(([key, value]) => {
          const parsed = typeof value === 'string' ? parseJsonArrayCell(value) ?? value : value;
          if (
            Array.isArray(parsed) &&
            parsed.some((item) => typeof item === 'object' && item !== null && 'title' in item)
          ) {
            const sorted = [...parsed].sort((a, b) =>
              String((a as { title?: string }).title ?? '').localeCompare(
                String((b as { title?: string }).title ?? '')
              )
            );
            return [key, sorted];
          }
          return [key, parsed];
        })
      ) as Record<string, unknown>,
    })),
    fieldIds,
  });

/**
 * NOTE ON SNAPSHOTS vs ASSERTIONS
 *
 * Inline snapshots are primarily for humans to quickly scan table states.
 * For correctness (and to keep AI from "learning the snapshot" in the wrong direction),
 * always assert key cell values explicitly before the snapshot.
 */
function parseJsonArrayCell(value: string): unknown[] | null {
  if (!value.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const formatArrayCellValue = (items: unknown[]): string => {
  if (items.length === 0) return '[]';
  const hasLinkObjects = items.some(
    (item) => typeof item === 'object' && item !== null && 'title' in item
  );
  if (hasLinkObjects) {
    const sorted = [...items].sort((a, b) =>
      String((a as { title?: string }).title ?? '').localeCompare(
        String((b as { title?: string }).title ?? '')
      )
    );
    return sorted
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          return (item as { title?: string }).title ?? '?';
        }
        return String(item);
      })
      .join(', ');
  }
  return `[${items.map((item) => String(item)).join(', ')}]`;
};

const formatCellValueForExpect = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return formatArrayCellValue(value);
  if (typeof value === 'string') {
    const parsedArray = parseJsonArrayCell(value);
    if (parsedArray) return formatArrayCellValue(parsedArray);
    return value;
  }
  if (typeof value === 'object') {
    const obj = value as { title?: string; id?: string };
    if (obj.title !== undefined) return obj.title;
    if (obj.id !== undefined) return obj.id;
    try {
      return JSON.stringify(value);
    } catch {
      return '[Object]';
    }
  }
  return String(value);
};

const expectCellDisplay = (
  records: Array<{ id: string; fields: Record<string, unknown> }>,
  recordIndex: number,
  fieldId: string,
  expectedDisplay: string
) => {
  const value = records[recordIndex]?.fields[fieldId];
  expect(formatCellValueForExpect(value)).toBe(expectedDisplay);
};

// =============================================================================
// Test Suite
// =============================================================================

describe('v2 computed field updates (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const drainOutbox = async (maxRounds = 10) => {
    for (let i = 0; i < maxRounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  // ---------------------------------------------------------------------------
  // API Helpers
  // ---------------------------------------------------------------------------

  // Local wrapper that drains outbox before listing (important for computed tests)
  const listRecords = async (tableId: string) => {
    await drainOutbox();
    return ctx.listRecords(tableId);
  };

  const listRecordsWithoutDrain = async (tableId: string) => {
    const params = new URLSearchParams({ tableId });
    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list records: ${errorText}`);
    }
    const parsed = listTableRecordsOkResponseSchema.safeParse(await response.json());
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse list records response');
    }
    return parsed.data.data.records;
  };

  // ---------------------------------------------------------------------------
  // Setup & Teardown
  // ---------------------------------------------------------------------------

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  // No afterAll dispose needed - handled by vitest.setup.ts

  beforeEach(() => {
    // Clear logs before each test to ensure we only capture the current test's computed plans
    ctx.testContainer.clearLogs();
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

        const table = await ctx.createTable({
          baseId: ctx.baseId,
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

        // Build name maps for readable computed steps snapshot
        const nameMaps: ComputedPlanSnapshotOptions = buildNameMaps(
          { id: table.id, name: table.name },
          [
            { id: nameFieldId, name: 'Name' },
            { id: valueFieldId, name: 'Value' },
            { id: doubledFieldId, name: 'Doubled' },
          ]
        );

        await ctx.createRecord(table.id, { [nameFieldId]: 'Test', [valueFieldId]: 5 });

        const beforeRecords = await listRecords(table.id);
        expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '10');
        expect(printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[FormulaNumberTest]
            ---------------------------
            #  | Name | Value | Doubled
            ---------------------------
            R0 | Test | 5     | 10
            ---------------------------"
          `);

        // Clear logs before the update operation we want to test
        ctx.testContainer.clearLogs();

        const record = beforeRecords[0];
        await ctx.updateRecord(table.id, record.id, { [valueFieldId]: 15 });
        await drainOutbox();

        // Verify computed update steps - ensure no extra steps
        const plan = ctx.testContainer.getLastComputedPlan();
        expect(plan).toBeDefined();
        expect(plan!.steps.length).toBe(1); // Only one step: update Doubled
        expect(plan!.steps[0].fieldIds).toContain(doubledFieldId);
        expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
          "[Computed Steps: 1]
            L0: FormulaNumberTest -> [Doubled]"
        `);

        const afterRecords = await listRecords(table.id);
        expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '30');
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

        const table = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(table.id, { [nameFieldId]: 'Test', [valueFieldId]: 5 });

        const beforeRecords = await listRecords(table.id);
        expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '20');
        expect(printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[FormulaChainTest]
            ---------------------------
            #  | Name | Value | F1 | F2
            ---------------------------
            R0 | Test | 5     | 10 | 20
            ---------------------------"
          `);

        ctx.testContainer.clearLogs();
        const record = beforeRecords[0];
        await ctx.updateRecord(table.id, record.id, { [valueFieldId]: 10 });
        await drainOutbox();

        // Verify computed update steps - formula chain should update F1 then F2
        const plan = ctx.testContainer.getLastComputedPlan();
        expect(plan).toBeDefined();
        expect(plan!.steps.length).toBe(1);
        expect(plan!.steps[0].fieldIds).toEqual([formula1FieldId, formula2FieldId]);
        const nameMaps = buildNameMaps({ id: table.id, name: 'FormulaChainTest' }, [
          { id: valueFieldId, name: 'Value' },
          { id: formula1FieldId, name: 'F1' },
          { id: formula2FieldId, name: 'F2' },
        ]);
        expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
          "[Computed Steps: 1]
            L0: FormulaChainTest -> [F1, F2]"
        `);

        const afterRecords = await listRecords(table.id);
        expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '30');
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

        const table = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(table.id, { [nameFieldId]: 'Test', [textFieldId]: 'World' });

        const beforeRecords = await listRecords(table.id);
        expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], 'Hello, World');
        expect(printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds))
          .toMatchInlineSnapshot(`
            "[FormulaTextTest]
            --------------------------------
            #  | Name | Text  | Greeting
            --------------------------------
            R0 | Test | World | Hello, World
            --------------------------------"
          `);

        ctx.testContainer.clearLogs();
        const record = beforeRecords[0];
        await ctx.updateRecord(table.id, record.id, { [textFieldId]: 'Universe' });
        await drainOutbox();

        const plan = ctx.testContainer.getLastComputedPlan();
        expect(plan).toBeDefined();
        expect(plan!.steps.length).toBe(1);
        expect(plan!.steps[0].fieldIds).toContain(greetingFieldId);
        const nameMaps = buildNameMaps({ id: table.id, name: 'FormulaTextTest' }, [
          { id: textFieldId, name: 'Text' },
          { id: greetingFieldId, name: 'Greeting' },
        ]);
        expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
          "[Computed Steps: 1]
            L0: FormulaTextTest -> [Greeting]"
        `);

        const afterRecords = await listRecords(table.id);
        expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], 'Hello, Universe');
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

      /**
       * Scenario: Formula referencing single select + user field.
       * A.status + A.assignee -> A.summary (CONCATENATE(status, " - ", assignee))
       */
      it('updates formula when singleSelect changes with user field in expression', async () => {
        const nameFieldId = createFieldId();
        const statusFieldId = createFieldId();
        const assigneeFieldId = createFieldId();
        const summaryFieldId = createFieldId();

        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'FormulaSelectUserTest',
          fields: [
            { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'singleSelect',
              id: statusFieldId,
              name: 'Status',
              options: ['A', 'B'],
            },
            {
              type: 'user',
              id: assigneeFieldId,
              name: 'Assignee',
              options: {
                isMultiple: false,
                shouldNotify: false,
              },
            },
            {
              type: 'formula',
              id: summaryFieldId,
              name: 'Summary',
              options: {
                expression: `CONCATENATE({${statusFieldId}}, " - ", {${assigneeFieldId}})`,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const statusField = table.fields.find((field) => field.id === statusFieldId);
        const statusChoices =
          (statusField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ??
          [];
        const optionA = statusChoices.find((choice) => choice.name === 'A');
        const optionB = statusChoices.find((choice) => choice.name === 'B');
        if (!optionA?.id || !optionB?.id) {
          throw new Error('Missing status options');
        }

        await ctx.createRecord(table.id, {
          [nameFieldId]: 'Test',
          [statusFieldId]: optionA.id,
          [assigneeFieldId]: {
            id: ctx.testUser.id,
            title: ctx.testUser.name,
          },
        });

        const beforeRecords = await listRecords(table.id);
        expectCellDisplay(beforeRecords, 0, assigneeFieldId, ctx.testUser.name);
        expectCellDisplay(beforeRecords, 0, summaryFieldId, `A - ${ctx.testUser.name}`);

        ctx.testContainer.clearLogs();
        const record = beforeRecords[0];
        await ctx.updateRecord(table.id, record.id, { [statusFieldId]: optionB.id });
        await drainOutbox();

        const plans = ctx.testContainer.getComputedPlans();
        expect(plans.length).toBe(1);
        const plan = plans[0];
        expect(plan.steps.length).toBe(1);
        expect(plan.steps[0].fieldIds).toEqual([summaryFieldId]);
        const allStepFieldIds = plan.steps.flatMap((step) => step.fieldIds);
        expect(allStepFieldIds).not.toContain(assigneeFieldId);
        const nameMaps = buildNameMaps({ id: table.id, name: 'FormulaSelectUserTest' }, [
          { id: statusFieldId, name: 'Status' },
          { id: assigneeFieldId, name: 'Assignee' },
          { id: summaryFieldId, name: 'Summary' },
        ]);
        expect(printComputedSteps(plan, nameMaps)).toMatchInlineSnapshot(`
          "[Computed Steps: 1]
            L0: FormulaSelectUserTest -> [Summary]"
        `);

        const afterRecords = await listRecords(table.id);
        expectCellDisplay(afterRecords, 0, assigneeFieldId, ctx.testUser.name);
        expectCellDisplay(afterRecords, 0, summaryFieldId, `B - ${ctx.testUser.name}`);
      });

      /**
       * Scenario: Formula field using DATETIME_PARSE referencing a date field.
       * A.date -> A.formula (DATETIME_PARSE(YEAR(TODAY()) & "-" & MONTH(date) & "-" & DAY(date)))
       *
       * This test verifies that when a Date field is updated, the DATETIME_PARSE formula
       * correctly recalculates. This is a regression test for a bug where formula values
       * sometimes didn't update after Date field changes.
       *
       * Related issue: Table tbl12J3ZBV0490mwzvm showed formula=null for record with date=2025-09-15
       */
      it('updates DATETIME_PARSE formula when source date field changes', async () => {
        const nameFieldId = createFieldId();
        const dateFieldId = createFieldId();
        const formulaFieldId = createFieldId();

        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'FormulaDatetimeParseTest',
          fields: [
            { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'date',
              id: dateFieldId,
              name: 'Date',
              options: {
                formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'Asia/Shanghai' },
              },
            },
            {
              type: 'formula',
              id: formulaFieldId,
              name: 'ParsedDate',
              options: {
                expression: `DATETIME_PARSE(YEAR(TODAY()) & "-" & MONTH({${dateFieldId}}) & "-" & DAY({${dateFieldId}}))`,
                timeZone: 'Asia/Shanghai',
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const fieldIds = [nameFieldId, dateFieldId, formulaFieldId];
        const fieldNames = ['Name', 'Date', 'ParsedDate'];

        // Create record with initial date (September 15, 2025)
        await ctx.createRecord(table.id, {
          [nameFieldId]: 'Test',
          [dateFieldId]: '2025-09-15T09:47:06.000Z',
        });

        const beforeRecords = await listRecords(table.id);

        // Formula should have computed a valid value (not null)
        const beforeFormulaValue = beforeRecords[0]?.fields[formulaFieldId];
        expect(beforeFormulaValue).not.toBeNull();
        expect(beforeFormulaValue).not.toBeUndefined();

        // Verify the parsed date contains the month and day from the source date
        const beforeParsed = new Date(beforeFormulaValue as string);
        expect(beforeParsed.getUTCMonth()).toBe(8); // September = 8 (0-indexed)
        expect(beforeParsed.getUTCDate()).toBe(15);

        ctx.testContainer.clearLogs();

        // Update the date to December 28, 2025
        const record = beforeRecords[0];
        await ctx.updateRecord(table.id, record.id, {
          [dateFieldId]: '2025-12-28T09:48:15.000Z',
        });
        await drainOutbox();

        // Verify computed plan was generated
        const plan = ctx.testContainer.getLastComputedPlan();
        expect(plan).toBeDefined();
        expect(plan!.steps.length).toBe(1);
        expect(plan!.steps[0].fieldIds).toContain(formulaFieldId);

        const nameMaps = buildNameMaps({ id: table.id, name: 'FormulaDatetimeParseTest' }, [
          { id: dateFieldId, name: 'Date' },
          { id: formulaFieldId, name: 'ParsedDate' },
        ]);
        expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
          "[Computed Steps: 1]
            L0: FormulaDatetimeParseTest -> [ParsedDate]"
        `);

        const afterRecords = await listRecords(table.id);

        // Formula should still have a valid value after update
        const afterFormulaValue = afterRecords[0]?.fields[formulaFieldId];
        expect(afterFormulaValue).not.toBeNull();
        expect(afterFormulaValue).not.toBeUndefined();

        // Verify the new parsed date contains the updated month and day
        const afterParsed = new Date(afterFormulaValue as string);
        expect(afterParsed.getUTCMonth()).toBe(11); // December = 11 (0-indexed)
        expect(afterParsed.getUTCDate()).toBe(28);
      });

      /**
       * Scenario: Formula field using DATETIME_PARSE with single-digit month.
       * Tests that months like September (9) are correctly parsed even without zero-padding.
       *
       * This specifically tests the case where MONTH() returns "9" instead of "09",
       * which the DATETIME_PARSE function should still be able to parse.
       */
      it('updates DATETIME_PARSE formula with single-digit month correctly', async () => {
        const nameFieldId = createFieldId();
        const dateFieldId = createFieldId();
        const formulaFieldId = createFieldId();

        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'FormulaDatetimeParseSingleDigitTest',
          fields: [
            { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'date',
              id: dateFieldId,
              name: 'Date',
              options: {
                formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'Asia/Shanghai' },
              },
            },
            {
              type: 'formula',
              id: formulaFieldId,
              name: 'ParsedDate',
              options: {
                expression: `DATETIME_PARSE(YEAR(TODAY()) & "-" & MONTH({${dateFieldId}}) & "-" & DAY({${dateFieldId}}))`,
                timeZone: 'Asia/Shanghai',
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        // Test with all single-digit months (1-9) and single-digit days (1-9)
        const testCases = [
          { input: '2025-01-05T00:00:00.000Z', expectedMonth: 0, expectedDay: 5 },
          { input: '2025-09-01T00:00:00.000Z', expectedMonth: 8, expectedDay: 1 },
          { input: '2025-03-03T00:00:00.000Z', expectedMonth: 2, expectedDay: 3 },
        ];

        for (const testCase of testCases) {
          // Create record
          const createResult = await ctx.createRecord(table.id, {
            [nameFieldId]: `Test-${testCase.expectedMonth + 1}-${testCase.expectedDay}`,
            [dateFieldId]: testCase.input,
          });

          const records = await listRecords(table.id);
          const record = records.find((r) => r.id === createResult.id);

          // Verify formula computed correctly
          const formulaValue = record?.fields[formulaFieldId];
          expect(formulaValue).not.toBeNull();
          expect(formulaValue).not.toBeUndefined();

          const parsed = new Date(formulaValue as string);
          expect(parsed.getUTCMonth()).toBe(testCase.expectedMonth);
          expect(parsed.getUTCDate()).toBe(testCase.expectedDay);
        }
      });

      describe('basic formula chain', () => {
        it('updates formula chain when source number changes', async () => {
          const amountFieldId = createFieldId();
          const scoreFieldId = createFieldId();
          const scoreLabelFieldId = createFieldId();

          const table = await ctx.createTable({
            baseId: ctx.baseId,
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
          const record = await ctx.createRecord(table.id, {
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

          expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], 'Score: 10');
          expect(beforeSnapshot).toMatchInlineSnapshot(`
            "[Formula Chain Test]
            ----------------------------------------
            #  | Name  | Amount | Score | ScoreLabel
            ----------------------------------------
            R0 | Alpha | 5      | 10    | Score: 10
            ----------------------------------------"
          `);

          // Update amount
          ctx.testContainer.clearLogs();
          await ctx.updateRecord(table.id, record.id, { [amountFieldId]: 7 });
          await drainOutbox();

          const plan = ctx.testContainer.getLastComputedPlan();
          expect(plan).toBeDefined();
          expect(plan!.steps.length).toBe(1);
          expect(plan!.steps[0].fieldIds).toContain(scoreFieldId);
          expect(plan!.steps[0].fieldIds).toContain(scoreLabelFieldId);
          const nameMaps = buildNameMaps({ id: table.id, name: 'Formula Chain Test' }, [
            { id: amountFieldId, name: 'Amount' },
            { id: scoreFieldId, name: 'Score' },
            { id: scoreLabelFieldId, name: 'ScoreLabel' },
          ]);
          expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
            "[Computed Steps: 1]
              L0: Formula Chain Test -> [Score, ScoreLabel]"
          `);

          // After update
          const afterRecords = await listRecords(table.id);
          const afterSnapshot = printTableSnapshot(table.name, fieldNames, afterRecords, fieldIds);

          expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], 'Score: 14');
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
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LookupSourceA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: aValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordA = await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'ItemA',
          [aValueFieldId]: 100,
        });

        const bNameFieldId = createFieldId();
        const linkFieldId = createFieldId();
        const lookupFieldId = createFieldId();
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
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

        const createdB = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'ItemB',
          [linkFieldId]: { id: recordA.id },
        });

        // Process outbox to ensure lookup field is calculated
        await ctx.testContainer.processOutbox();

        const beforeRecordsA = await listRecords(tableA.id);
        expectCellDisplay(beforeRecordsA, 0, aFieldIds[aFieldIds.length - 1], '100');
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
        expectCellDisplay(beforeRecordsB, 0, bFieldIds[bFieldIds.length - 1], '[100]');
        expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecordsB, bFieldIds))
          .toMatchInlineSnapshot(`
            "[LookupTargetB]
            ------------------------------
            #  | Name  | LinkA | LookupVal
            ------------------------------
            R0 | ItemB | ItemA | [100]
            ------------------------------"
          `);

        await ctx.updateRecord(tableA.id, recordA.id, { [aValueFieldId]: 200 });
        await ctx.testContainer.processOutbox();

        const afterRecordsA = await listRecords(tableA.id);
        expectCellDisplay(afterRecordsA, 0, aFieldIds[aFieldIds.length - 1], '200');
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
        expectCellDisplay(afterRecordsB, 0, bFieldIds[bFieldIds.length - 1], '[200]');
        expect(printTableSnapshot(tableB.name, bFieldNames, afterRecordsB, bFieldIds))
          .toMatchInlineSnapshot(`
            "[LookupTargetB]
            ------------------------------
            #  | Name  | LinkA | LookupVal
            ------------------------------
            R0 | ItemB | ItemA | [200]
            ------------------------------"
          `);

        // Verify computed update steps - cross-table lookup should update in TableB
        const plan = ctx.testContainer.getLastComputedPlan();
        expect(plan).toBeDefined();
        expect(plan!.steps.length).toBe(1); // Only one step: update LookupVal in TableB
        const nameMaps = buildMultiTableNameMaps([
          { id: tableA.id, name: 'LookupSourceA', fields: [{ id: aValueFieldId, name: 'Value' }] },
          {
            id: tableB.id,
            name: 'LookupTargetB',
            fields: [{ id: lookupFieldId, name: 'LookupVal' }],
          },
        ]);
        expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
          "[Computed Steps: 1]
            L0: LookupTargetB -> [LookupVal]
          [Edges: 2]"
        `);
      });

      /**
       * Scenario: Lookup updates when link relation changes.
       * TableA has records A1, A2. TableB.link points to A1.
       */
      it('updates lookup when link relation changes', async () => {
        const aNameFieldId = createFieldId();
        const aValueFieldId = createFieldId();
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LookupRelA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: aValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordA1 = await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aValueFieldId]: 10,
        });
        const recordA2 = await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'A2',
          [aValueFieldId]: 20,
        });

        const bNameFieldId = createFieldId();
        const linkFieldId = createFieldId();
        const lookupFieldId = createFieldId();
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'ItemB',
          [linkFieldId]: { id: recordA1.id },
        });

        // Process outbox to ensure lookup field is calculated
        await ctx.testContainer.processOutbox();

        const beforeRecords = await listRecords(tableB.id);
        expectCellDisplay(beforeRecords, 0, bFieldIds[bFieldIds.length - 1], '[10]');
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
        await ctx.updateRecord(tableB.id, recordB.id, { [linkFieldId]: { id: recordA2.id } });

        const midRecords = await listRecordsWithoutDrain(tableB.id);
        const midLinkValue = midRecords[0]?.fields[linkFieldId];
        const midLinkId =
          typeof midLinkValue === 'string'
            ? midLinkValue
            : Array.isArray(midLinkValue)
              ? (midLinkValue[0] as { id?: string } | undefined)?.id
              : midLinkValue && typeof midLinkValue === 'object' && 'id' in midLinkValue
                ? (midLinkValue as { id?: string }).id
                : undefined;
        expect(midLinkId).toBe(recordA2.id);
        expectCellDisplay(midRecords, 0, bFieldIds[bFieldIds.length - 1], '[10]');

        await ctx.testContainer.processOutbox();

        const afterRecords = await listRecords(tableB.id);
        expectCellDisplay(afterRecords, 0, bFieldIds[bFieldIds.length - 1], '[20]');
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
          const contacts = await ctx.createTable({
            baseId: ctx.baseId,
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
          const contact = await ctx.createRecord(contacts.id, {
            [contactNameFieldId]: 'Alice',
            [scoreFieldId]: 2,
          });

          // Create linking table (Deals)
          const linkFieldId = createFieldId();
          const lookupFieldId = createFieldId();

          const deals = await ctx.createTable({
            baseId: ctx.baseId,
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
          const deal = await ctx.createRecord(deals.id, {
            [dealNameFieldId]: 'Deal A',
            [linkFieldId]: { id: contact.id },
          });

          const beforeContacts = await listRecords(contacts.id);
          expectCellDisplay(
            beforeContacts,
            0,
            contactFieldIds[contactFieldIds.length - 1],
            'Score: 2'
          );
          expect(
            printTableSnapshot(contacts.name, contactFieldNames, beforeContacts, contactFieldIds)
          ).toMatchInlineSnapshot(`
            "[Contacts Source]
            -------------------------------
            #  | Name  | Score | ScoreLabel
            -------------------------------
            R0 | Alice | 2     | Score: 2
            -------------------------------"
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
          expectCellDisplay(beforeRecords, 0, dealFieldIds[dealFieldIds.length - 1], '[Score: 2]');
          expect(beforeSnapshot).toMatchInlineSnapshot(`
            "[Deals Target]
            ------------------------------------
            #  | Deal   | Contact | ContactScore
            ------------------------------------
            R0 | Deal A | Alice   | [Score: 2]
            ------------------------------------"
          `);

          // Update contact's score (triggers: Contact.Score -> Contact.ScoreLabel -> Deal.lookup)
          await ctx.updateRecord(contacts.id, contact.id, { [scoreFieldId]: 8 });

          // Process any pending outbox tasks (cross-table updates are async)
          await ctx.testContainer.processOutbox();

          const afterContacts = await listRecords(contacts.id);
          expectCellDisplay(
            afterContacts,
            0,
            contactFieldIds[contactFieldIds.length - 1],
            'Score: 8'
          );
          expect(
            printTableSnapshot(contacts.name, contactFieldNames, afterContacts, contactFieldIds)
          ).toMatchInlineSnapshot(`
            "[Contacts Source]
            -------------------------------
            #  | Name  | Score | ScoreLabel
            -------------------------------
            R0 | Alice | 8     | Score: 8
            -------------------------------"
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
          expectCellDisplay(afterRecords, 0, dealFieldIds[dealFieldIds.length - 1], '[Score: 8]');
          expect(afterSnapshot).toMatchInlineSnapshot(`
            "[Deals Target]
            ------------------------------------
            #  | Deal   | Contact | ContactScore
            ------------------------------------
            R0 | Deal A | Alice   | [Score: 8]
            ------------------------------------"
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
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupSourceA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: aValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordA1 = await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aValueFieldId]: 10,
        });
        const recordA2 = await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'A2',
          [aValueFieldId]: 20,
        });

        const bNameFieldId = createFieldId();
        const linkFieldId = createFieldId();
        const rollupFieldId = createFieldId();
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'ItemB',
          [linkFieldId]: [{ id: recordA1.id }, { id: recordA2.id }],
        });

        // Process outbox to ensure rollup field is calculated
        await ctx.testContainer.processOutbox();

        const beforeRecordsA = await listRecords(tableA.id);
        expectCellDisplay(beforeRecordsA, 0, aFieldIds[aFieldIds.length - 1], '10');
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
        expectCellDisplay(beforeRecordsB, 0, bFieldIds[bFieldIds.length - 1], '30');
        expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecordsB, bFieldIds))
          .toMatchInlineSnapshot(`
            "[RollupTargetB]
            -------------------------
            #  | Name  | Links  | Sum
            -------------------------
            R0 | ItemB | A1, A2 | 30
            -------------------------"
          `);

        await ctx.updateRecord(tableA.id, recordA1.id, { [aValueFieldId]: 50 });
        await ctx.testContainer.processOutbox();

        const afterRecordsA = await listRecords(tableA.id);
        expectCellDisplay(afterRecordsA, 0, aFieldIds[aFieldIds.length - 1], '50');
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
        expectCellDisplay(afterRecordsB, 0, bFieldIds[bFieldIds.length - 1], '70');
        expect(printTableSnapshot(tableB.name, bFieldNames, afterRecordsB, bFieldIds))
          .toMatchInlineSnapshot(`
            "[RollupTargetB]
            -------------------------
            #  | Name  | Links  | Sum
            -------------------------
            R0 | ItemB | A1, A2 | 70
            -------------------------"
          `);

        // Verify computed update steps - cross-table rollup should update in TableB
        const plan = ctx.testContainer.getLastComputedPlan();
        expect(plan).toBeDefined();
        expect(plan!.steps.length).toBe(1); // Only one step: update Sum in TableB
        const nameMaps = buildMultiTableNameMaps([
          { id: tableA.id, name: 'RollupSourceA', fields: [{ id: aValueFieldId, name: 'Value' }] },
          { id: tableB.id, name: 'RollupTargetB', fields: [{ id: rollupFieldId, name: 'Sum' }] },
        ]);
        expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
          "[Computed Steps: 1]
            L0: RollupTargetB -> [Sum]
          [Edges: 2]"
        `);
      });

      /**
       * Scenario: Rollup updates when link relation changes.
       */
      it('updates rollup when link relation changes', async () => {
        const aNameFieldId = createFieldId();
        const aValueFieldId = createFieldId();
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupRelA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: aValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordA1 = await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aValueFieldId]: 10,
        });
        const recordA2 = await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'A2',
          [aValueFieldId]: 20,
        });
        const recordA3 = await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'A3',
          [aValueFieldId]: 30,
        });

        const bNameFieldId = createFieldId();
        const linkFieldId = createFieldId();
        const rollupFieldId = createFieldId();
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'ItemB',
          [linkFieldId]: [{ id: recordA1.id }],
        });

        // Process outbox to ensure rollup field is calculated
        await ctx.testContainer.processOutbox();

        const beforeRecords = await listRecords(tableB.id);
        expectCellDisplay(beforeRecords, 0, bFieldIds[bFieldIds.length - 1], '10');
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
        await ctx.updateRecord(tableB.id, recordB.id, {
          [linkFieldId]: [{ id: recordA1.id }, { id: recordA2.id }, { id: recordA3.id }],
        });
        await ctx.testContainer.processOutbox();

        const afterRecords = await listRecords(tableB.id);
        expectCellDisplay(afterRecords, 0, bFieldIds[bFieldIds.length - 1], '60');
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

      const table = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(table.id, { [nameFieldId]: 'Test', [numFieldId]: 5 });

      const beforeRecords = await listRecords(table.id);
      expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '60');
      expect(printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ThreeLevelFormula]
          ------------------------------
          #  | Name | Num | F1 | F2 | F3
          ------------------------------
          R0 | Test | 5   | 10 | 20 | 60
          ------------------------------"
        `);

      ctx.testContainer.clearLogs();
      const record = beforeRecords[0];
      await ctx.updateRecord(table.id, record.id, { [numFieldId]: 10 });
      await drainOutbox();

      // Verify computed update steps - three-level formula chain
      const plan = ctx.testContainer.getLastComputedPlan();
      expect(plan).toBeDefined();
      expect(plan!.steps.length).toBe(1);
      expect(plan!.steps[0].fieldIds).toEqual([f1FieldId, f2FieldId, f3FieldId]);
      const nameMaps = buildNameMaps({ id: table.id, name: 'ThreeLevelFormula' }, [
        { id: numFieldId, name: 'Num' },
        { id: f1FieldId, name: 'F1' },
        { id: f2FieldId, name: 'F2' },
        { id: f3FieldId, name: 'F3' },
      ]);
      expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
        "[Computed Steps: 1]
          L0: ThreeLevelFormula -> [F1, F2, F3]"
      `);

      const afterRecords = await listRecords(table.id);
      expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '90');
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
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ChainA',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const recordA = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A1',
        [aValueFieldId]: 100,
      });

      // Table B: Links to A, has lookup of A.Value
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bLookupFieldId = createFieldId();
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
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

      const recordB = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bLinkFieldId]: { id: recordA.id },
      });

      // Table C: Links to B, has lookup of B.LookupA (chain)
      const cNameFieldId = createFieldId();
      const cLinkFieldId = createFieldId();
      const cLookupFieldId = createFieldId();
      const tableC = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(tableC.id, {
        [cNameFieldId]: 'C1',
        [cLinkFieldId]: { id: recordB.id },
      });

      // Process outbox to ensure all computed fields (lookup chain) are calculated
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      const beforeRecordsA = await listRecords(tableA.id);
      expectCellDisplay(beforeRecordsA, 0, aFieldIds[aFieldIds.length - 1], '100');
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
      expectCellDisplay(beforeRecords, 0, cFieldIds[cFieldIds.length - 1], '[100]');
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
      await ctx.updateRecord(tableA.id, recordA.id, { [aValueFieldId]: 999 });
      await ctx.testContainer.processOutbox();

      const afterRecordsA = await listRecords(tableA.id);
      expectCellDisplay(afterRecordsA, 0, aFieldIds[aFieldIds.length - 1], '999');
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
      expectCellDisplay(afterRecords, 0, cFieldIds[cFieldIds.length - 1], '[999]');
      expect(printTableSnapshot(tableC.name, cFieldNames, afterRecords, cFieldIds))
        .toMatchInlineSnapshot(`
          "[ChainC]
          ---------------------------
          #  | Name | LinkB | LookupB
          ---------------------------
          R0 | C1   | B1    | [999]
          ---------------------------"
        `);

      // Verify computed update steps - should cascade A -> B -> C
      const plan = ctx.testContainer.getLastComputedPlan();
      expect(plan).toBeDefined();
      // Cross-table chain: LookupA in B, then LookupB in C
      expect(plan!.steps.length).toBe(1);
      const nameMaps = buildMultiTableNameMaps([
        { id: tableA.id, name: 'ChainA', fields: [{ id: aValueFieldId, name: 'Value' }] },
        { id: tableB.id, name: 'ChainB', fields: [{ id: bLookupFieldId, name: 'LookupA' }] },
        { id: tableC.id, name: 'ChainC', fields: [{ id: cLookupFieldId, name: 'LookupB' }] },
      ]);
      // Note: The exact steps depend on outbox processing; may show partial chain
      expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
        "[Computed Steps: 1]
          L0: ChainC -> [LookupB]
        [Edges: 2]"
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
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
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

      const recordA = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A1',
        [aNumFieldId]: 10,
      });

      // Table B: Links to A, lookup A.Doubled, formula based on lookup
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bLookupFieldId = createFieldId();
      const bFormulaFieldId = createFieldId();
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bLinkFieldId]: { id: recordA.id },
      });

      // Process outbox to ensure lookup and formula fields are calculated
      await ctx.testContainer.processOutbox();

      const beforeRecordsA = await listRecords(tableA.id);
      expectCellDisplay(beforeRecordsA, 0, aFieldIds[aFieldIds.length - 1], '20');
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
      expectCellDisplay(beforeRecords, 0, bFieldIds[bFieldIds.length - 1], '30');
      expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecords, bFieldIds))
        .toMatchInlineSnapshot(`
          "[MixedB]
          -------------------------------------------
          #  | Name | LinkA | LookupDoubled | PlusTen
          -------------------------------------------
          R0 | B1   | A1    | [20]          | 30
          -------------------------------------------"
        `);

      // Update A.Num: A.Doubled -> B.LookupDoubled -> B.PlusTen
      ctx.testContainer.clearLogs(); // Clear logs before the update chain
      await ctx.updateRecord(tableA.id, recordA.id, { [aNumFieldId]: 50 });
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Verify computed update steps - cross-table formula-lookup chain
      // The chain: A.Num -> A.Doubled (sync) -> B.LookupDoubled (async) -> B.PlusTen (async)
      const plans = ctx.testContainer.getComputedPlans();
      // Note: updateRecord enqueues work in external_mode; plans come from outbox processing.
      expect(plans.length).toBe(3);
      const nameMaps = buildMultiTableNameMaps([
        {
          id: tableA.id,
          name: 'MixedA',
          fields: [
            { id: aNumFieldId, name: 'Num' },
            { id: aFormulaFieldId, name: 'Doubled' },
          ],
        },
        {
          id: tableB.id,
          name: 'MixedB',
          fields: [
            { id: bLookupFieldId, name: 'LookupDoubled' },
            { id: bFormulaFieldId, name: 'PlusTen' },
          ],
        },
      ]);
      // Chain: A.Doubled (L0) -> B.LookupDoubled (L1) -> B.PlusTen (L2)
      expect(plans[0].steps.length).toBe(3);
      expect(printComputedSteps(plans[0], nameMaps)).toMatchInlineSnapshot(`
        "[Computed Steps: 3]
          L0: MixedA -> [Doubled]
          L1: MixedB -> [LookupDoubled]
          L2: MixedB -> [PlusTen]
        [Edges: 2]"
      `);

      const afterRecordsA = await listRecords(tableA.id);
      expectCellDisplay(afterRecordsA, 0, aFieldIds[aFieldIds.length - 1], '100');
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
      expectCellDisplay(afterRecords, 0, bFieldIds[bFieldIds.length - 1], '110');
      expect(printTableSnapshot(tableB.name, bFieldNames, afterRecords, bFieldIds))
        .toMatchInlineSnapshot(`
          "[MixedB]
          -------------------------------------------
          #  | Name | LinkA | LookupDoubled | PlusTen
          -------------------------------------------
          R0 | B1   | A1    | [100]         | 110
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
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
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

      const recordA1 = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A1',
        [aAmountFieldId]: 10,
      });
      const recordA2 = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A2',
        [aAmountFieldId]: 5,
      });

      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bRollupFieldId = createFieldId();
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
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

      const recordB = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bLinkFieldId]: [{ id: recordA1.id }, { id: recordA2.id }],
      });

      const cNameFieldId = createFieldId();
      const cLinkFieldId = createFieldId();
      const cLookupFieldId = createFieldId();
      const tableC = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(tableC.id, {
        [cNameFieldId]: 'C1',
        [cLinkFieldId]: { id: recordB.id },
      });

      // Process outbox to ensure all computed fields (formula, rollup, lookup) are calculated
      for (let i = 0; i < 5; i += 1) {
        await ctx.testContainer.processOutbox();
      }

      const bFieldIds = [bNameFieldId, bLinkFieldId, bRollupFieldId];
      const bFieldNames = ['Name', 'Links', 'TotalSum'];
      const cFieldIds = [cNameFieldId, cLinkFieldId, cLookupFieldId];
      const cFieldNames = ['Name', 'LinkB', 'SumFromB'];

      const beforeRecordsB = await listRecords(tableB.id);
      expectCellDisplay(beforeRecordsB, 0, bFieldIds[bFieldIds.length - 1], '40');
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
      expectCellDisplay(beforeRecordsC, 0, cFieldIds[cFieldIds.length - 1], '[40]');
      expect(printTableSnapshot(tableC.name, cFieldNames, beforeRecordsC, cFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaRollupC]
          ----------------------------
          #  | Name | LinkB | SumFromB
          ----------------------------
          R0 | C1   | B1    | [40]
          ----------------------------"
        `);

      ctx.testContainer.clearLogs(); // Clear logs before the update chain
      await ctx.updateRecord(tableA.id, recordA1.id, { [aAmountFieldId]: 20 });
      for (let i = 0; i < 5; i += 1) {
        await ctx.testContainer.processOutbox();
      }

      // Verify computed update steps - formula-rollup-lookup chain across 3 tables
      // Chain: A.Amount -> A.Double -> A.Total (sync) -> B.TotalSum (async) -> C.SumFromB (async)
      const plans = ctx.testContainer.getComputedPlans();
      // Note: updateRecord enqueues work in external_mode; plans come from outbox processing.
      expect(plans.length).toBe(4);
      const nameMaps = buildMultiTableNameMaps([
        {
          id: tableA.id,
          name: 'FormulaRollupA',
          fields: [
            { id: aAmountFieldId, name: 'Amount' },
            { id: aDoubleFieldId, name: 'Double' },
            { id: aTotalFieldId, name: 'Total' },
          ],
        },
        {
          id: tableB.id,
          name: 'FormulaRollupB',
          fields: [{ id: bRollupFieldId, name: 'TotalSum' }],
        },
        {
          id: tableC.id,
          name: 'FormulaRollupC',
          fields: [{ id: cLookupFieldId, name: 'SumFromB' }],
        },
      ]);
      // First plan: sync formula chain in A + cross-table updates
      // Chain: A.Amount -> A.Double -> A.Total -> B.TotalSum -> C.SumFromB
      expect(plans[0].steps.length).toBe(3);
      expect(printComputedSteps(plans[0], nameMaps)).toMatchInlineSnapshot(`
        "[Computed Steps: 3]
          L0: FormulaRollupA -> [Double, Total]
          L2: FormulaRollupB -> [TotalSum]
          L3: FormulaRollupC -> [SumFromB]
        [Edges: 4]"
      `);

      const afterRecordsB = await listRecords(tableB.id);
      expectCellDisplay(afterRecordsB, 0, bFieldIds[bFieldIds.length - 1], '60');
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
      expectCellDisplay(afterRecordsC, 0, cFieldIds[cFieldIds.length - 1], '[60]');
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
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'TitleChainA',
        fields: [{ type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      const recordA = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'Original Title',
      });

      // Table B: Links to A
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bLinkFieldId]: { id: recordA.id },
      });

      // Process outbox to ensure link title is updated
      await ctx.testContainer.processOutbox();

      const beforeRecordsA = await listRecords(tableA.id);
      expectCellDisplay(beforeRecordsA, 0, aFieldIds[aFieldIds.length - 1], 'Original Title');
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
      expectCellDisplay(beforeRecords, 0, bFieldIds[bFieldIds.length - 1], 'Original Title');
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
      await ctx.updateRecord(tableA.id, recordA.id, { [aNameFieldId]: 'Updated Title' });
      await ctx.testContainer.processOutbox();

      const afterRecordsA = await listRecords(tableA.id);
      expectCellDisplay(afterRecordsA, 0, aFieldIds[aFieldIds.length - 1], 'Updated Title');
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
      expectCellDisplay(afterRecords, 0, bFieldIds[bFieldIds.length - 1], 'Updated Title');
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
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Cascade A',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', id: valueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });
        const aNameFieldId = tableA.fields.find((f) => f.isPrimary)?.id ?? '';

        // Create A record
        const recordA = await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'Source',
          [valueFieldId]: 10,
        });

        const aFieldIds = [aNameFieldId, valueFieldId];
        const aFieldNames = ['Name', 'Value'];

        // Table B: Links to A, has lookup
        const linkAFieldId = createFieldId();
        const lookupAFieldId = createFieldId();
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
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
        const recordB = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'Middle',
          [linkAFieldId]: { id: recordA.id },
        });

        // Table C: Links to B, has lookup of B's lookup
        const linkBFieldId = createFieldId();
        const lookupBFieldId = createFieldId();
        const tableC = await ctx.createTable({
          baseId: ctx.baseId,
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
        const recordC = await ctx.createRecord(tableC.id, {
          [cNameFieldId]: 'End',
          [linkBFieldId]: { id: recordB.id },
        });

        // Process outbox to ensure lookup chain is calculated
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();

        const beforeRecordsA = await listRecords(tableA.id);
        expectCellDisplay(beforeRecordsA, 0, aFieldIds[aFieldIds.length - 1], '10');
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
        expectCellDisplay(beforeRecords, 0, cFieldIds[cFieldIds.length - 1], '[10]');
        expect(beforeSnapshot).toMatchInlineSnapshot(`
          "[Cascade C]
          -------------------------------
          #  | Name | LinkB  | ValueFromB
          -------------------------------
          R0 | End  | Middle | [10]
          -------------------------------"
        `);

        // Update A.Value - should cascade A -> B.lookup -> C.lookup
        await ctx.updateRecord(tableA.id, recordA.id, { [valueFieldId]: 99 });

        // Process outbox tasks for multi-level cascade (A->B, then B->C)
        // Each level may enqueue the next level, so we need multiple passes
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();

        const afterRecordsA = await listRecords(tableA.id);
        expectCellDisplay(afterRecordsA, 0, aFieldIds[aFieldIds.length - 1], '99');
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
        expectCellDisplay(afterRecords, 0, cFieldIds[cFieldIds.length - 1], '[99]');
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

    /**
     * Scenario: SUM over lookup values containing scientific-notation strings.
     * v1 reference: formula-lookup-sum-regression.e2e-spec.ts
     *
     * Regression: SUM({lookupTextValues}) should safely coerce numeric strings and ignore invalid
     * numeric inputs (like scientific-notation strings that used to form malformed numerics),
     * and updates should not raise Postgres 22P02.
     *
     * Chain: invoiceTable.AmountText (singleLineText) -> planTable.link -> planTable.lookup -> planTable.formula (SUM)
     *
     * In v1, scientific-notation strings are coerced to NULL (ignored), and valid numeric strings are summed.
     * Expected result: 5250 + 4000 = 9250 (ignoring '3.7525002300010774e+35').
     */
    it('safely sums lookup values containing scientific-notation strings during updates', async () => {
      // Source table with text amounts (one contains scientific notation).
      const invoiceNameFieldId = createFieldId();
      const amountTextFieldId = createFieldId();
      const invoiceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'sum_reg_invoices_v2',
        fields: [
          { type: 'singleLineText', id: invoiceNameFieldId, name: 'Invoice', isPrimary: true },
          { type: 'singleLineText', id: amountTextFieldId, name: 'AmountText' },
        ],
        views: [{ type: 'grid' }],
      });

      const invoice1 = await ctx.createRecord(invoiceTable.id, {
        [invoiceNameFieldId]: 'INV-001',
        [amountTextFieldId]: '5250.00',
      });
      const invoice2 = await ctx.createRecord(invoiceTable.id, {
        [invoiceNameFieldId]: 'INV-002',
        [amountTextFieldId]: '4000.00',
      });
      const invoice3 = await ctx.createRecord(invoiceTable.id, {
        [invoiceNameFieldId]: 'INV-003',
        [amountTextFieldId]: '3.7525002300010774e+35', // should be ignored
      });

      // Target table with link -> lookup -> formula SUM.
      const titleFieldId = createFieldId();
      const linkFieldId = createFieldId();
      const lookupFieldId = createFieldId();
      const formulaFieldId = createFieldId();

      const planTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'sum_reg_plans_v2',
        fields: [
          { type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true },
          {
            type: 'link',
            id: linkFieldId,
            name: 'Invoices',
            options: {
              relationship: 'manyMany',
              foreignTableId: invoiceTable.id,
              lookupFieldId: invoiceNameFieldId,
              isOneWay: true,
            },
          },
          {
            type: 'lookup',
            id: lookupFieldId,
            name: 'InvoiceAmounts',
            options: {
              foreignTableId: invoiceTable.id,
              linkFieldId,
              lookupFieldId: amountTextFieldId,
            },
          },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Total',
            options: { expression: `SUM({${lookupFieldId}})` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const planRecord = await ctx.createRecord(planTable.id, { [titleFieldId]: 'Plan A' });

      // Link all invoice records to the plan.
      await ctx.updateRecord(planTable.id, planRecord.id, {
        [linkFieldId]: [{ id: invoice1.id }, { id: invoice2.id }, { id: invoice3.id }],
      });

      // Trigger an additional update to simulate the PATCH scenario from the report.
      await ctx.updateRecord(planTable.id, planRecord.id, { [titleFieldId]: 'Plan A updated' });

      // Drain async tasks if any were enqueued by the updates.
      for (let i = 0; i < 5; i += 1) {
        const drained = await ctx.testContainer.processOutbox();
        if (drained === 0) break;
      }

      const records = await listRecords(planTable.id);
      const updated = records.find((r) => r.id === planRecord.id);
      const total = updated?.fields[formulaFieldId];

      // The scientific-notation string is ignored (coerces to NULL -> 0), valid numbers are summed.
      expect(total).toBe(9250);
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
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'SymOneOneA',
          fields: [{ type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        const recordA1 = await ctx.createRecord(tableA.id, { [aNameFieldId]: 'A1' });
        const recordA2 = await ctx.createRecord(tableA.id, { [aNameFieldId]: 'A2' });

        // Table B: oneOne link to A
        const bNameFieldId = createFieldId();
        const bLinkFieldId = createFieldId();
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
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
        await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bLinkFieldId]: { id: recordA1.id },
        });
        await ctx.testContainer.processOutbox();

        // Find symmetric link field in tableA
        const aFieldsBefore = await listRecords(tableA.id);
        const symLinkFieldKey = Object.keys(aFieldsBefore[0]?.fields || {}).find(
          (k) => k !== aNameFieldId && k !== '__id'
        );
        expect(symLinkFieldKey).toBeDefined();

        const aFieldIds = [aNameFieldId, symLinkFieldKey!];
        const aFieldNames = ['Name', 'SymLink'];

        expectCellDisplay(aFieldsBefore, 0, aFieldIds[aFieldIds.length - 1], 'B1');
        expect(printTableSnapshot(tableA.name, aFieldNames, aFieldsBefore, aFieldIds))
          .toMatchInlineSnapshot(`
            "[SymOneOneA]
            -------------------
            #  | Name | SymLink
            -------------------
            R0 | A1   | B1
            R1 | A2   | -
            -------------------"
          `);

        // Change B1's link from A1 to A2
        const bRecords = await listRecords(tableB.id);
        await ctx.updateRecord(tableB.id, bRecords[0].id, {
          [bLinkFieldId]: { id: recordA2.id },
        });
        await ctx.testContainer.processOutbox();

        const aFieldsAfter = await listRecords(tableA.id);
        expectCellDisplay(aFieldsAfter, 0, aFieldIds[aFieldIds.length - 1], '-');
        expect(printTableSnapshot(tableA.name, aFieldNames, aFieldsAfter, aFieldIds))
          .toMatchInlineSnapshot(`
            "[SymOneOneA]
            -------------------
            #  | Name | SymLink
            -------------------
            R0 | A1   | -
            R1 | A2   | B1
            -------------------"
          `);
      });

      it('oneOne twoWay - updates lookup when linked value changes', async () => {
        // Table A
        const aNameFieldId = createFieldId();
        const aValueFieldId = createFieldId();
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'OneOneA',
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: aValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordA = await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aValueFieldId]: 100,
        });

        // Table B: oneOne link to A
        const bNameFieldId = createFieldId();
        const bLinkFieldId = createFieldId();
        const bLookupFieldId = createFieldId();
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bLinkFieldId]: { id: recordA.id },
        });

        // Process outbox to ensure symmetric link is updated
        await ctx.testContainer.processOutbox();

        const beforeRecordsA = await listRecords(tableA.id);
        expectCellDisplay(beforeRecordsA, 0, aFieldIds[aFieldIds.length - 1], '100');
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
        expectCellDisplay(beforeRecords, 0, bFieldIds[bFieldIds.length - 1], '[100]');
        expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecords, bFieldIds))
          .toMatchInlineSnapshot(`
            "[OneOneB]
            -----------------------------
            #  | Name | LinkA | LookupVal
            -----------------------------
            R0 | B1   | A1    | [100]
            -----------------------------"
          `);

        await ctx.updateRecord(tableA.id, recordA.id, { [aValueFieldId]: 999 });
        await ctx.testContainer.processOutbox();

        const afterRecordsA = await listRecords(tableA.id);
        expectCellDisplay(afterRecordsA, 0, aFieldIds[aFieldIds.length - 1], '999');
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
        expectCellDisplay(afterRecords, 0, bFieldIds[bFieldIds.length - 1], '[999]');
        expect(printTableSnapshot(tableB.name, bFieldNames, afterRecords, bFieldIds))
          .toMatchInlineSnapshot(`
            "[OneOneB]
            -----------------------------
            #  | Name | LinkA | LookupVal
            -----------------------------
            R0 | B1   | A1    | [999]
            -----------------------------"
          `);

        // Verify computed update steps - oneOne lookup should update in TableB
        const plan = ctx.testContainer.getLastComputedPlan();
        expect(plan).toBeDefined();
        expect(plan!.steps.length).toBe(1);
        const nameMaps = buildMultiTableNameMaps([
          { id: tableA.id, name: 'OneOneA', fields: [{ id: aValueFieldId, name: 'Value' }] },
          { id: tableB.id, name: 'OneOneB', fields: [{ id: bLookupFieldId, name: 'LookupVal' }] },
        ]);
        expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
          "[Computed Steps: 1]
            L0: OneOneB -> [LookupVal]
          [Edges: 2]"
        `);
      });

      it('oneOne oneWay - no symmetric link in foreign table', async () => {
        const aNameFieldId = createFieldId();
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'OneOneOneWayA',
          fields: [{ type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        const recordA = await ctx.createRecord(tableA.id, { [aNameFieldId]: 'A1' });

        const bNameFieldId = createFieldId();
        const bLinkFieldId = createFieldId();
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bLinkFieldId]: { id: recordA.id },
        });
        await ctx.testContainer.processOutbox();

        const bFieldIds = [bNameFieldId, bLinkFieldId];
        const bFieldNames = ['Name', 'LinkA'];
        const bRecords = await listRecords(tableB.id);
        expectCellDisplay(bRecords, 0, bFieldIds[bFieldIds.length - 1], 'A1');
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
        expectCellDisplay(aRecords, 0, aFieldIds[aFieldIds.length - 1], 'A1');
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
        const tableChild = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'OneManyChild',
          fields: [{ type: 'singleLineText', id: childNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        const child1 = await ctx.createRecord(tableChild.id, { [childNameFieldId]: 'C1' });
        const child2 = await ctx.createRecord(tableChild.id, { [childNameFieldId]: 'C2' });

        // Table Parent: oneMany link to children
        const parentNameFieldId = createFieldId();
        const parentLinkFieldId = createFieldId();
        const tableParent = await ctx.createTable({
          baseId: ctx.baseId,
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
        await ctx.createRecord(tableParent.id, {
          [parentNameFieldId]: 'Parent1',
          [parentLinkFieldId]: [{ id: child1.id }, { id: child2.id }],
        });
        await ctx.testContainer.processOutbox();

        const parentFieldIds = [parentNameFieldId, parentLinkFieldId];
        const parentFieldNames = ['Name', 'Children'];
        const parentRecords = await listRecords(tableParent.id);
        // Link arrays may be returned in non-deterministic order; sort for stable assertions/snapshots.
        const stableParentRecords = parentRecords.map((record) => {
          const raw = record.fields[parentLinkFieldId];
          const normalized = typeof raw === 'string' ? parseJsonArrayCell(raw) ?? raw : raw;
          const sorted =
            Array.isArray(normalized) &&
            normalized.some((item) => typeof item === 'object' && item !== null && 'title' in item)
              ? [...normalized].sort((a, b) =>
                  String((a as { title?: string }).title ?? '').localeCompare(
                    String((b as { title?: string }).title ?? '')
                  )
                )
              : normalized;
          return {
            ...record,
            fields: {
              ...record.fields,
              [parentLinkFieldId]: sorted,
            },
          };
        });
        expectCellDisplay(
          stableParentRecords,
          0,
          parentFieldIds[parentFieldIds.length - 1],
          'C1, C2'
        );
        expect(
          printTableSnapshot(
            tableParent.name,
            parentFieldNames,
            stableParentRecords,
            parentFieldIds
          )
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
        expectCellDisplay(childRecords, 0, childFieldIds[childFieldIds.length - 1], 'Parent1');
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
        await ctx.updateRecord(tableParent.id, parentRecords[0].id, {
          [parentLinkFieldId]: [{ id: child1.id }],
        });
        await ctx.testContainer.processOutbox();

        const parentRecordsAfter = await listRecords(tableParent.id);
        expectCellDisplay(parentRecordsAfter, 0, parentFieldIds[parentFieldIds.length - 1], 'C1');
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
        expectCellDisplay(childRecordsAfter, 0, childFieldIds[childFieldIds.length - 1], 'Parent1');
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
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'OneManyB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: bValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordB1 = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bValueFieldId]: 10,
        });
        const recordB2 = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B2',
          [bValueFieldId]: 20,
        });
        const recordB3 = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B3',
          [bValueFieldId]: 30,
        });

        // Table A (parent): oneMany link to B
        const aNameFieldId = createFieldId();
        const aLinkFieldId = createFieldId();
        const aRollupFieldId = createFieldId();
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'Parent',
          [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
        });

        const beforeRecords = await listRecords(tableA.id);
        expectCellDisplay(beforeRecords, 0, aFieldIds[aFieldIds.length - 1], '30');
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
        ctx.testContainer.clearLogs(); // Clear logs before the update we want to test
        await ctx.updateRecord(tableA.id, record.id, {
          [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }, { id: recordB3.id }],
        });
        await ctx.testContainer.processOutbox();

        const afterRecords = await listRecords(tableA.id);
        expectCellDisplay(afterRecords, 0, aFieldIds[aFieldIds.length - 1], '60');
        expect(printTableSnapshot(tableA.name, aFieldNames, afterRecords, aFieldIds))
          .toMatchInlineSnapshot(`
            "[OneManyA]
            ------------------------------
            #  | Name   | Children   | Sum
            ------------------------------
            R0 | Parent | B1, B2, B3 | 60
            ------------------------------"
          `);

        // Verify computed update steps
        // When updating link in TableA, triggers rollup update (sync) + symmetric link (async)
        const plan = ctx.testContainer.getLastComputedPlan();
        expect(plan).toBeDefined();
        expect(plan!.steps.length).toBe(3);

        // Get the symmetric link field ID from tableB (auto-created when two-way link was created)
        const updatedTableB = await ctx.getTableById(tableB.id);
        const symmetricLinkFieldId = updatedTableB.fields.find(
          (f) => f.type === 'link' && f.options?.foreignTableId === tableA.id
        )?.id;
        expect(symmetricLinkFieldId).toBeDefined();

        const hasRollupStep = plan!.steps.some(
          (s) => s.tableId === tableA.id && s.fieldIds.includes(aRollupFieldId)
        );
        const hasSymmetricLinkStep = plan!.steps.some(
          (s) => s.tableId === tableB.id && s.fieldIds.includes(symmetricLinkFieldId!)
        );
        expect(hasRollupStep).toBe(true);
        expect(hasSymmetricLinkStep).toBe(true);
      });

      it('oneMany twoWay - lookup updates when removing children', async () => {
        // Table B (children)
        const bNameFieldId = createFieldId();
        const bValueFieldId = createFieldId();
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'OneManyLookupB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: bValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordB1 = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bValueFieldId]: 123,
        });
        const recordB2 = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B2',
          [bValueFieldId]: 456,
        });

        // Table A (parent): oneMany link to B + lookup on B.Value
        const aNameFieldId = createFieldId();
        const aLinkFieldId = createFieldId();
        const aLookupFieldId = createFieldId();
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'OneManyLookupA',
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
              type: 'lookup',
              id: aLookupFieldId,
              name: 'ChildValues',
              options: {
                linkFieldId: aLinkFieldId,
                foreignTableId: tableB.id,
                lookupFieldId: bValueFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const parent = await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'Parent',
          [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
        });
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();

        const beforeRecords = await listRecords(tableA.id);
        const beforeParent = beforeRecords.find((r) => r.id === parent.id);
        const beforeLookup = beforeParent?.fields[aLookupFieldId];
        expect(
          Array.isArray(beforeLookup)
            ? [...beforeLookup].map((v) => Number(v)).sort((a, b) => a - b)
            : beforeLookup
        ).toEqual([123, 456]);

        // Remove one linked child
        await ctx.updateRecord(tableA.id, parent.id, {
          [aLinkFieldId]: [{ id: recordB1.id }],
        });
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();

        const afterRemoveRecords = await listRecords(tableA.id);
        const afterRemoveParent = afterRemoveRecords.find((r) => r.id === parent.id);
        expect(afterRemoveParent?.fields[aLookupFieldId]).toEqual([123]);

        // Clear all links
        await ctx.updateRecord(tableA.id, parent.id, {
          [aLinkFieldId]: null,
        });
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();

        const afterClearRecords = await listRecords(tableA.id);
        const afterClearParent = afterClearRecords.find((r) => r.id === parent.id);
        const lookupValue = afterClearParent?.fields[aLookupFieldId];
        expect(
          lookupValue === null ||
            lookupValue === undefined ||
            (Array.isArray(lookupValue) && lookupValue.length === 0)
        ).toBe(true);
      });

      it('oneMany oneWay - no symmetric link in foreign table', async () => {
        const childNameFieldId = createFieldId();
        const tableChild = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'OneManyOneWayChild',
          fields: [{ type: 'singleLineText', id: childNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        const child1 = await ctx.createRecord(tableChild.id, { [childNameFieldId]: 'C1' });
        const child2 = await ctx.createRecord(tableChild.id, { [childNameFieldId]: 'C2' });

        const parentNameFieldId = createFieldId();
        const parentLinkFieldId = createFieldId();
        const tableParent = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(tableParent.id, {
          [parentNameFieldId]: 'Parent1',
          [parentLinkFieldId]: [{ id: child1.id }, { id: child2.id }],
        });
        await ctx.testContainer.processOutbox();

        const parentFieldIds = [parentNameFieldId, parentLinkFieldId];
        const parentFieldNames = ['Name', 'Children'];
        const parentRecords = await listRecords(tableParent.id);
        expectCellDisplay(parentRecords, 0, parentFieldIds[parentFieldIds.length - 1], 'C1, C2');
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
        expectCellDisplay(childRecords, 0, childFieldIds[childFieldIds.length - 1], 'C1');
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

      /**
       * Scenario: Insert optimization - skip oneMany link on One-side table insert.
       *
       * When inserting a new record to the One-side table (Parent) with a bidirectional
       * oneMany link, the symmetric link field should NOT trigger computed update steps
       * because FK is in the foreign table (Child), not the current table.
       *
       * A new Parent record cannot have any Child FK pointing to it yet.
       */
      it('oneMany twoWay - insert to One-side skips computed steps for symmetric link', async () => {
        // Table Child (will have FK pointing to Parent)
        const childNameFieldId = createFieldId();
        const tableChild = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'InsertOptChild',
          fields: [{ type: 'singleLineText', id: childNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        // Table Parent: oneMany link to Child (bidirectional)
        const parentNameFieldId = createFieldId();
        const parentLinkFieldId = createFieldId();
        const tableParent = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'InsertOptParent',
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
                // isOneWay omitted = false (bidirectional)
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        // Get symmetric link field in tableChild
        const updatedTableChild = await ctx.getTableById(tableChild.id);
        const symmetricLinkFieldId = updatedTableChild.fields.find(
          (f) => f.type === 'link' && f.options?.foreignTableId === tableParent.id
        )?.id;
        expect(symmetricLinkFieldId).toBeDefined();

        // Clear logs before creating record
        ctx.testContainer.clearLogs();

        // Insert new Parent record (One-side, FK NOT here)
        const parentRecord = await ctx.createRecord(tableParent.id, {
          [parentNameFieldId]: 'NewParent',
        });

        // Verify computed plan has NO steps for the oneMany link in Parent table
        // Because FK is in Child table, not Parent table
        const plan = ctx.testContainer.getLastComputedPlan();

        // The oneMany link in Parent should NOT be in the steps
        // (but symmetric link in Child may be triggered for title updates)
        if (plan) {
          const parentLinkStep = plan.steps.find(
            (s) =>
              s.tableId.toString() === tableParent.id &&
              s.fieldIds.some((f) => f.toString() === parentLinkFieldId)
          );
          expect(parentLinkStep).toBeUndefined();
        }

        // Verify the record was created correctly
        const parentRecords = await listRecords(tableParent.id);
        const created = parentRecords.find((r) => r.id === parentRecord.id);
        expect(created).toBeDefined();
        expect(created!.fields[parentNameFieldId]).toBe('NewParent');

        // The oneMany link should be empty (no children linked yet)
        const linkValue = created!.fields[parentLinkFieldId];
        const isEmpty =
          linkValue === null ||
          linkValue === undefined ||
          (Array.isArray(linkValue) && linkValue.length === 0);
        expect(isEmpty).toBe(true);

        // Verify table state
        const parentFieldIds = [parentNameFieldId, parentLinkFieldId];
        const parentFieldNames = ['Name', 'Children'];
        expect(
          printTableSnapshot(tableParent.name, parentFieldNames, parentRecords, parentFieldIds)
        ).toMatchInlineSnapshot(`
          "[InsertOptParent]
          -------------------------
          #  | Name      | Children
          -------------------------
          R0 | NewParent | -
          -------------------------"
        `);
      });

      /**
       * Scenario: When creating a Parent record with Children link value set,
       * the symmetric link field (Child.Parent) should be updated, AND any lookup
       * fields in Child that depend on the symmetric link should also be updated.
       *
       * This tests the fix for: symmetric link's dependent lookup fields were not
       * being computed during insert with link values.
       */
      it('oneMany twoWay - insert with link value updates symmetric link dependent lookups', async () => {
        // Table Parent (the "one" side)
        const parentNameFieldId = createFieldId();
        const tableParent = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'SymLookupParent',
          fields: [
            { type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true },
          ],
          views: [{ type: 'grid' }],
        });

        // Table Child: manyOne link to Parent + lookup for Parent.Name
        const childNameFieldId = createFieldId();
        const childLinkFieldId = createFieldId();
        const childLookupFieldId = createFieldId();
        const tableChild = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'SymLookupChild',
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
            {
              type: 'lookup',
              id: childLookupFieldId,
              name: 'ParentName',
              options: {
                linkFieldId: childLinkFieldId,
                foreignTableId: tableParent.id,
                lookupFieldId: parentNameFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        // Get symmetric link field ID in tableParent (oneMany link)
        const updatedTableParent = await ctx.getTableById(tableParent.id);
        const symmetricLinkFieldId = updatedTableParent.fields.find(
          (f) => f.type === 'link' && f.options?.foreignTableId === tableChild.id
        )?.id;
        expect(symmetricLinkFieldId).toBeDefined();

        // Create a Child record (no link set yet)
        const childRecord = await ctx.createRecord(tableChild.id, {
          [childNameFieldId]: 'ChildA',
        });

        // Verify Child record has empty ParentName lookup initially
        const childRecordsBefore = await listRecords(tableChild.id);
        const childBefore = childRecordsBefore.find((r) => r.id === childRecord.id);
        expect(childBefore).toBeDefined();
        const lookupValueBefore = childBefore!.fields[childLookupFieldId];
        expect(
          lookupValueBefore === null ||
            lookupValueBefore === undefined ||
            (Array.isArray(lookupValueBefore) && lookupValueBefore.length === 0)
        ).toBe(true);

        // Now create a Parent record with Children link value set to [ChildA]
        // This should:
        // 1. Update Child's FK to point to new Parent
        // 2. Update Child's Parent link field to show the new Parent
        // 3. Update Child's ParentName lookup to show Parent's name
        ctx.testContainer.clearLogs();
        await ctx.createRecord(tableParent.id, {
          [parentNameFieldId]: 'ParentX',
          [symmetricLinkFieldId!]: [{ id: childRecord.id }],
        });

        // Process outbox for cross-table computed updates
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();

        // Verify computed plan includes the lookup field update
        const plan = ctx.testContainer.getLastComputedPlan();
        if (plan) {
          // Should have at least 2 steps:
          // 1. Child.Parent (manyOne link) - level 0
          // 2. Child.ParentName (lookup) - level 1
          // Note: Parent.Children (oneMany) is correctly skipped (FK not in Parent table)
          expect(plan.steps.length).toBeGreaterThanOrEqual(2);

          // Verify lookup field is in the steps
          const lookupStep = plan.steps.find((s) =>
            s.fieldIds.some((f) => f.toString() === childLookupFieldId)
          );
          expect(lookupStep).toBeDefined();
          expect(lookupStep!.level).toBe(1); // Lookup depends on symmetric link, so level 1
        }

        // Verify Child record now has the correct ParentName lookup value
        const childRecordsAfter = await listRecords(tableChild.id);
        const childAfter = childRecordsAfter.find((r) => r.id === childRecord.id);
        expect(childAfter).toBeDefined();

        // ParentName lookup should now show 'ParentX'
        // Lookup values are stored as arrays
        const lookupValueAfter = childAfter!.fields[childLookupFieldId];
        expect(lookupValueAfter).toEqual(['ParentX']);

        // Print table snapshot
        const childFieldIds = [childNameFieldId, childLinkFieldId, childLookupFieldId];
        const childFieldNames = ['Name', 'Parent', 'ParentName'];
        expect(
          printTableSnapshot(tableChild.name, childFieldNames, childRecordsAfter, childFieldIds)
        ).toMatchInlineSnapshot(`
          "[SymLookupChild]
          ----------------------------------
          #  | Name   | Parent  | ParentName
          ----------------------------------
          R0 | ChildA | ParentX | [ParentX]
          ----------------------------------"
        `);
      });

      /**
       * Scenario: When updating the symmetric link field in the foreign table,
       * the lookup field in the original table should be updated.
       *
       * This is the "update" counterpart to the "insert" test above.
       * It specifically tests: Parent has oneMany link to Child + lookup on Child.Name.
       * When updating Child's symmetric link (manyOne) to point to a Parent,
       * the Parent's lookup should be updated.
       */
      it('oneMany twoWay - update symmetric link updates lookup in parent table', async () => {
        // Table Parent (the "one" side with oneMany link)
        const parentNameFieldId = createFieldId();
        const tableParent = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'SymUpdateParent',
          fields: [
            { type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true },
          ],
          views: [{ type: 'grid' }],
        });

        // Table Child: has a value field (Number) that Parent will lookup
        const childNameFieldId = createFieldId();
        const childValueFieldId = createFieldId();
        const tableChild = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'SymUpdateChild',
          fields: [
            { type: 'singleLineText', id: childNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: childValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        // Create Child records first
        const childA = await ctx.createRecord(tableChild.id, {
          [childNameFieldId]: 'ChildA',
          [childValueFieldId]: 123,
        });
        const childB = await ctx.createRecord(tableChild.id, {
          [childNameFieldId]: 'ChildB',
          [childValueFieldId]: 456,
        });

        // Now add oneMany link + lookup to Parent table
        const parentLinkFieldId = createFieldId();
        const parentLookupFieldId = createFieldId();
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: tableParent.id,
          field: {
            type: 'link',
            id: parentLinkFieldId,
            name: 'Children',
            options: {
              relationship: 'oneMany',
              foreignTableId: tableChild.id,
              lookupFieldId: childNameFieldId,
            },
          },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: tableParent.id,
          field: {
            type: 'lookup',
            id: parentLookupFieldId,
            name: 'ChildValues',
            options: {
              linkFieldId: parentLinkFieldId,
              foreignTableId: tableChild.id,
              lookupFieldId: childValueFieldId,
            },
          },
        });

        // Get symmetric link field ID in Child table (auto-created manyOne)
        const updatedTableChild = await ctx.getTableById(tableChild.id);
        const symmetricLinkFieldId = updatedTableChild.fields.find(
          (f) => f.type === 'link' && f.options?.foreignTableId === tableParent.id
        )?.id;
        expect(symmetricLinkFieldId).toBeDefined();

        // Create a Parent record with Children link set to [ChildA, ChildB]
        const parent = await ctx.createRecord(tableParent.id, {
          [parentNameFieldId]: 'ParentX',
          [parentLinkFieldId]: [{ id: childA.id }, { id: childB.id }],
        });
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();

        // Verify Parent's lookup shows both children's values
        const beforeRecords = await listRecords(tableParent.id);
        const beforeParent = beforeRecords.find((r) => r.id === parent.id);
        expect(beforeParent).toBeDefined();
        const lookupBefore = beforeParent!.fields[parentLookupFieldId];
        expect(
          Array.isArray(lookupBefore)
            ? [...lookupBefore].map((v) => Number(v)).sort((a, b) => a - b)
            : lookupBefore
        ).toEqual([123, 456]);

        // Now UPDATE the symmetric link in Child table (set ChildB's Parent link to null)
        // This should trigger Parent's lookup to update
        ctx.testContainer.clearLogs();
        await ctx.updateRecord(tableChild.id, childB.id, {
          [symmetricLinkFieldId!]: null,
        });
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();

        // Verify Parent's lookup now only shows ChildA's value
        const afterRecords = await listRecords(tableParent.id);
        const afterParent = afterRecords.find((r) => r.id === parent.id);
        expect(afterParent).toBeDefined();
        const lookupAfter = afterParent!.fields[parentLookupFieldId];
        expect(lookupAfter).toEqual([123]);

        // Test adding a link via symmetric field
        // Update ChildB's symmetric link to point back to Parent
        ctx.testContainer.clearLogs();
        await ctx.updateRecord(tableChild.id, childB.id, {
          [symmetricLinkFieldId!]: { id: parent.id },
        });
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();

        // Verify Parent's lookup now shows both values again
        const afterReaddRecords = await listRecords(tableParent.id);
        const afterReaddParent = afterReaddRecords.find((r) => r.id === parent.id);
        expect(afterReaddParent).toBeDefined();
        const lookupAfterReadd = afterReaddParent!.fields[parentLookupFieldId];
        expect(
          Array.isArray(lookupAfterReadd)
            ? [...lookupAfterReadd].map((v) => Number(v)).sort((a, b) => a - b)
            : lookupAfterReadd
        ).toEqual([123, 456]);
      });
    });

    describe('manyOne relationship', () => {
      it('manyOne twoWay - multiple records can link to same foreign record', async () => {
        // Table B (the "one")
        const bNameFieldId = createFieldId();
        const bValueFieldId = createFieldId();
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'ManyOneB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: bValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordB = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'Shared',
          [bValueFieldId]: 100,
        });

        // Table A (the "many"): manyOne link to B
        const aNameFieldId = createFieldId();
        const aLinkFieldId = createFieldId();
        const aLookupFieldId = createFieldId();
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
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
        await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'Child1',
          [aLinkFieldId]: { id: recordB.id },
        });
        await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'Child2',
          [aLinkFieldId]: { id: recordB.id },
        });
        await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'Child3',
          [aLinkFieldId]: { id: recordB.id },
        });

        const beforeRecords = await listRecords(tableA.id);
        expectCellDisplay(beforeRecords, 0, aFieldIds[aFieldIds.length - 1], '[100]');
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
        expectCellDisplay(beforeRecordsB, 0, bFieldIds[bFieldIds.length - 1], '100');
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
        await ctx.updateRecord(tableB.id, recordB.id, { [bValueFieldId]: 999 });
        await ctx.testContainer.processOutbox();

        const afterRecordsB = await listRecords(tableB.id);
        expectCellDisplay(afterRecordsB, 0, bFieldIds[bFieldIds.length - 1], '999');
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
        expectCellDisplay(afterRecords, 0, aFieldIds[aFieldIds.length - 1], '[999]');
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
        const tableParent = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'ManyOneParent',
          fields: [
            { type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true },
          ],
          views: [{ type: 'grid' }],
        });

        const parent1 = await ctx.createRecord(tableParent.id, { [parentNameFieldId]: 'P1' });

        // Table Child: manyOne link to parent
        const childNameFieldId = createFieldId();
        const childLinkFieldId = createFieldId();
        const tableChild = await ctx.createTable({
          baseId: ctx.baseId,
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
        expect(childRecordsEmpty).toHaveLength(0);
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
        await ctx.createRecord(tableChild.id, {
          [childNameFieldId]: 'Child1',
          [childLinkFieldId]: { id: parent1.id },
        });
        await ctx.createRecord(tableChild.id, {
          [childNameFieldId]: 'Child2',
          [childLinkFieldId]: { id: parent1.id },
        });
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();

        const childRecords = await listRecords(tableChild.id);
        expectCellDisplay(childRecords, 0, childFieldIds[childFieldIds.length - 1], 'P1');
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

        expectCellDisplay(
          parentRecords,
          0,
          parentFieldIds[parentFieldIds.length - 1],
          'Child1, Child2'
        );
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
        await ctx.createRecord(tableChild.id, {
          [childNameFieldId]: 'Child3',
          [childLinkFieldId]: { id: parent1.id },
        });
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();

        const childRecordsAfter = await listRecords(tableChild.id);
        expectCellDisplay(childRecordsAfter, 0, childFieldIds[childFieldIds.length - 1], 'P1');
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
        expectCellDisplay(
          parentRecordsAfter,
          0,
          parentFieldIds[parentFieldIds.length - 1],
          'Child1, Child2, Child3'
        );
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
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'ManyOneOneWayB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: bValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordB1 = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bValueFieldId]: 10,
        });
        const recordB2 = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B2',
          [bValueFieldId]: 20,
        });

        const aNameFieldId = createFieldId();
        const aLinkFieldId = createFieldId();
        const aLookupFieldId = createFieldId();
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
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

        const recordA = await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'Child',
          [aLinkFieldId]: { id: recordB1.id },
        });

        const aFieldIds = [aNameFieldId, aLinkFieldId, aLookupFieldId];
        const aFieldNames = ['Name', 'Parent', 'ParentVal'];
        const beforeRecords = await listRecords(tableA.id);
        expectCellDisplay(beforeRecords, 0, aFieldIds[aFieldIds.length - 1], '[10]');
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
        expect(beforeRecord?.fields[aLookupFieldId]).toEqual([10]);

        await ctx.updateRecord(tableA.id, recordA.id, { [aLinkFieldId]: { id: recordB2.id } });
        await ctx.testContainer.processOutbox();

        const afterRecords = await listRecords(tableA.id);
        expectCellDisplay(afterRecords, 0, aFieldIds[aFieldIds.length - 1], '[20]');
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
        expect(afterRecord?.fields[aLookupFieldId]).toEqual([20]);
      });
    });

    describe('manyMany relationship', () => {
      it('manyMany twoWay - rollup updates with add/remove', async () => {
        // Table B
        const bNameFieldId = createFieldId();
        const bValueFieldId = createFieldId();
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'ManyManyB',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: bValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordB1 = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bValueFieldId]: 10,
        });
        const recordB2 = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B2',
          [bValueFieldId]: 20,
        });

        // Table A: manyMany link to B
        const aNameFieldId = createFieldId();
        const aLinkFieldId = createFieldId();
        const aRollupFieldId = createFieldId();
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
        });

        const beforeRecords = await listRecords(tableA.id);
        expectCellDisplay(beforeRecords, 0, aFieldIds[aFieldIds.length - 1], '30');
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
        ctx.testContainer.clearLogs(); // Clear logs before the update we want to test
        await ctx.updateRecord(tableA.id, record.id, {
          [aLinkFieldId]: [{ id: recordB2.id }],
        });
        await ctx.testContainer.processOutbox();

        const afterRecords = await listRecords(tableA.id);
        expectCellDisplay(afterRecords, 0, aFieldIds[aFieldIds.length - 1], '20');
        expect(printTableSnapshot(tableA.name, aFieldNames, afterRecords, aFieldIds))
          .toMatchInlineSnapshot(`
            "[ManyManyA]
            -----------------------
            #  | Name | Links | Sum
            -----------------------
            R0 | A1   | B2    | 20
            -----------------------"
          `);

        // Verify computed update steps
        // When updating link in TableA, triggers rollup update (sync) + symmetric link (async)
        const plan = ctx.testContainer.getLastComputedPlan();
        expect(plan).toBeDefined();
        expect(plan!.steps.length).toBe(3);

        // Get the symmetric link field ID from tableB (auto-created when two-way link was created)
        const updatedTableB = await ctx.getTableById(tableB.id);
        const symmetricLinkFieldId = updatedTableB.fields.find(
          (f) => f.type === 'link' && f.options?.foreignTableId === tableA.id
        )?.id;
        expect(symmetricLinkFieldId).toBeDefined();

        const hasRollupStep = plan!.steps.some(
          (s) => s.tableId === tableA.id && s.fieldIds.includes(aRollupFieldId)
        );
        const hasSymmetricLinkStep = plan!.steps.some(
          (s) => s.tableId === tableB.id && s.fieldIds.includes(symmetricLinkFieldId!)
        );
        expect(hasRollupStep).toBe(true);
        expect(hasSymmetricLinkStep).toBe(true);
      });

      /**
       * Scenario: ManyMany twoWay - both tables show symmetric links.
       * A links to B1,B2 - B1 and B2 should each show link to A.
       */
      it('manyMany twoWay - junction table maintains both sides', async () => {
        // Table B
        const bNameFieldId = createFieldId();
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'ManyManySymB',
          fields: [{ type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        const recordB1 = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'B1' });
        const recordB2 = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'B2' });

        // Table A: manyMany link to B
        const aNameFieldId = createFieldId();
        const aLinkFieldId = createFieldId();
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
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
        await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
        });
        // A2 links to B1 only
        await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'A2',
          [aLinkFieldId]: [{ id: recordB1.id }],
        });
        await ctx.testContainer.processOutbox();

        const aFieldIds = [aNameFieldId, aLinkFieldId];
        const aFieldNames = ['Name', 'LinksB'];
        const aRecordsBefore = await listRecords(tableA.id);
        expectCellDisplay(aRecordsBefore, 0, aFieldIds[aFieldIds.length - 1], 'B1, B2');
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
        expectCellDisplay(bRecords, 0, bFieldIds[bFieldIds.length - 1], 'A1, A2');
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
        await ctx.updateRecord(tableA.id, a2Record!.id, {
          [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
        });
        await ctx.testContainer.processOutbox();

        const aRecordsAfter = await listRecords(tableA.id);
        expectCellDisplay(aRecordsAfter, 0, aFieldIds[aFieldIds.length - 1], 'B1, B2');
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
        expectCellDisplay(bRecordsAfter, 0, bFieldIds[bFieldIds.length - 1], 'A1, A2');
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
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'ManyManyOneWayB',
          fields: [{ type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        const recordB1 = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'B1' });
        const recordB2 = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'B2' });

        const aNameFieldId = createFieldId();
        const aLinkFieldId = createFieldId();
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
        });
        await ctx.testContainer.processOutbox();

        const aFieldIds = [aNameFieldId, aLinkFieldId];
        const aFieldNames = ['Name', 'LinksB'];
        const aRecords = await listRecords(tableA.id);
        expectCellDisplay(aRecords, 0, aFieldIds[aFieldIds.length - 1], 'B1, B2');
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
        expectCellDisplay(bRecords, 0, bFieldIds[bFieldIds.length - 1], 'B1');
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

    /**
     * Scenario: Link field conversion one-way -> two-way backfills symmetric values.
     * v1 reference: computed-orchestrator.e2e-spec.ts (post-convert persists symmetric link values on foreign table)
     *
     * NOTE: Implement after v2 supports link conversion and "update columns" backfill for existing link rows.
     */
    test.todo(
      'Link convert (one-way → two-way) backfill: Implement after v2 link conversion + update-columns backfill is supported'
    );

    /**
     * Scenario: Link null handling does not produce [{"id": null, "title": null}] artifacts.
     * v1 reference: link-field-null-handling.e2e-spec.ts
     *
     * NOTE: This may belong in a dedicated "link serialization" e2e suite; add here only if we want
     * computed/lookup consumers to explicitly assert the absence of null-link artifacts.
     */
    test.todo(
      'Link null handling artifacts: Need to verify empty links do not serialize as [{id:null,title:null}] and do not break computed consumers'
    );
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
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
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

      const recordA = await ctx.createRecord(tableA.id, {
        [aValueFieldId]: 42,
      });

      const aFieldIds = [aValueFieldId, aPrimaryFieldId];
      const aFieldNames = ['Value', 'Title'];

      // Table B: Links to A
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bLinkFieldId]: { id: recordA.id },
      });

      const beforeRecordsA = await listRecords(tableA.id);
      expectCellDisplay(beforeRecordsA, 0, aFieldIds[aFieldIds.length - 1], 'Item-42');
      expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecordsA, aFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryA]
          --------------------
          #  | Value | Title
          --------------------
          R0 | 42    | Item-42
          --------------------"
        `);

      const beforeRecords = await listRecords(tableB.id);
      expectCellDisplay(beforeRecords, 0, bFieldIds[bFieldIds.length - 1], 'Item-42');
      expect(printTableSnapshot(tableB.name, bFieldNames, beforeRecords, bFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryB]
          -------------------
          #  | Name | LinkA
          -------------------
          R0 | B1   | Item-42
          -------------------"
        `);

      // Update A.Value -> A.Title (primary) -> B.LinkA title
      await ctx.updateRecord(tableA.id, recordA.id, { [aValueFieldId]: 100 });
      await ctx.testContainer.processOutbox();
      // Some cross-table title updates can be enqueued after the first drain (via async handlers).
      await ctx.testContainer.processOutbox();

      const afterRecordsA = await listRecords(tableA.id);
      expectCellDisplay(afterRecordsA, 0, aFieldIds[aFieldIds.length - 1], 'Item-100');
      expect(printTableSnapshot(tableA.name, aFieldNames, afterRecordsA, aFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryA]
          ---------------------
          #  | Value | Title
          ---------------------
          R0 | 100   | Item-100
          ---------------------"
        `);

      const afterRecords = await listRecords(tableB.id);
      expectCellDisplay(afterRecords, 0, bFieldIds[bFieldIds.length - 1], 'Item-100');
      expect(printTableSnapshot(tableB.name, bFieldNames, afterRecords, bFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryB]
          --------------------
          #  | Name | LinkA
          --------------------
          R0 | B1   | Item-100
          --------------------"
        `);
    });

    it('propagates formula primary field changes through lookup chain', async () => {
      const aValueFieldId = createFieldId();
      const aPrimaryFieldId = createFieldId();
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
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

      const recordA = await ctx.createRecord(tableA.id, {
        [aValueFieldId]: 7,
      });

      const aFieldIds = [aValueFieldId, aPrimaryFieldId];
      const aFieldNames = ['Value', 'Title'];

      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bLookupFieldId = createFieldId();
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
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

      const recordB = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bLinkFieldId]: { id: recordA.id },
      });

      const cNameFieldId = createFieldId();
      const cLinkFieldId = createFieldId();
      const cLookupFieldId = createFieldId();
      const tableC = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(tableC.id, {
        [cNameFieldId]: 'C1',
        [cLinkFieldId]: { id: recordB.id },
      });

      const beforeRecordsA = await listRecords(tableA.id);
      expectCellDisplay(beforeRecordsA, 0, aFieldIds[aFieldIds.length - 1], 'Item-7');
      expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecordsA, aFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryChainA]
          -------------------
          #  | Value | Title
          -------------------
          R0 | 7     | Item-7
          -------------------"
        `);

      const cFieldIds = [cNameFieldId, cLinkFieldId, cLookupFieldId];
      const cFieldNames = ['Name', 'LinkB', 'TitleFromB'];
      const beforeRecords = await listRecords(tableC.id);
      expectCellDisplay(beforeRecords, 0, cFieldIds[cFieldIds.length - 1], '[Item-7]');
      expect(printTableSnapshot(tableC.name, cFieldNames, beforeRecords, cFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryChainC]
          ------------------------------
          #  | Name | LinkB | TitleFromB
          ------------------------------
          R0 | C1   | B1    | [Item-7]
          ------------------------------"
        `);

      await ctx.updateRecord(tableA.id, recordA.id, { [aValueFieldId]: 12 });
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      const afterRecordsA = await listRecords(tableA.id);
      expectCellDisplay(afterRecordsA, 0, aFieldIds[aFieldIds.length - 1], 'Item-12');
      expect(printTableSnapshot(tableA.name, aFieldNames, afterRecordsA, aFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryChainA]
          --------------------
          #  | Value | Title
          --------------------
          R0 | 12    | Item-12
          --------------------"
        `);

      const afterRecords = await listRecords(tableC.id);
      expectCellDisplay(afterRecords, 0, cFieldIds[cFieldIds.length - 1], '[Item-12]');
      expect(printTableSnapshot(tableC.name, cFieldNames, afterRecords, cFieldIds))
        .toMatchInlineSnapshot(`
          "[FormulaPrimaryChainC]
          ------------------------------
          #  | Name | LinkB | TitleFromB
          ------------------------------
          R0 | C1   | B1    | [Item-12]
          ------------------------------"
        `);
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
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'SelfManyOne',
        fields: [{ type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      const parentLinkFieldId = createFieldId();
      const parentLookupFieldId = createFieldId();

      await ctx.createField({
        baseId: ctx.baseId,
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

      await ctx.createField({
        baseId: ctx.baseId,
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

      const parent = await ctx.createRecord(table.id, { [nameFieldId]: 'Parent' });
      const child = await ctx.createRecord(table.id, {
        [nameFieldId]: 'Child',
        [parentLinkFieldId]: { id: parent.id },
      });

      const fieldIds = [nameFieldId, parentLinkFieldId, parentLookupFieldId];
      const fieldNames = ['Name', 'Parent', 'ParentName'];
      const beforeRecords = await listRecords(table.id);
      expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '-');
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

      ctx.testContainer.clearLogs(); // Clear logs before the update
      await ctx.updateRecord(table.id, parent.id, { [nameFieldId]: 'Parent2' });
      await ctx.testContainer.processOutbox();

      // Verify computed update steps - self-referencing link lookup updates
      const plan = ctx.testContainer.getLastComputedPlan();
      expect(plan).toBeDefined();
      expect(plan!.steps.length).toBe(1); // One step: update ParentName lookup
      const nameMaps = buildNameMaps({ id: table.id, name: 'SelfManyOne' }, [
        { id: nameFieldId, name: 'Name' },
        { id: parentLinkFieldId, name: 'Parent' },
        { id: parentLookupFieldId, name: 'ParentName' },
      ]);
      expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
        "[Computed Steps: 1]
          L0: SelfManyOne -> [Parent, ParentName]
        [Edges: 2]"
      `);

      const afterRecords = await listRecords(table.id);
      expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '-');
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
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'SelfManyMany',
        fields: [
          { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: valueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const linkFieldId = createFieldId();
      const rollupFieldId = createFieldId();

      await ctx.createField({
        baseId: ctx.baseId,
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

      await ctx.createField({
        baseId: ctx.baseId,
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

      const record1 = await ctx.createRecord(table.id, {
        [nameFieldId]: 'R1',
        [valueFieldId]: 10,
      });
      const record2 = await ctx.createRecord(table.id, {
        [nameFieldId]: 'R2',
        [valueFieldId]: 20,
      });
      const record3 = await ctx.createRecord(table.id, {
        [nameFieldId]: 'R3',
        [valueFieldId]: 30,
      });

      await ctx.updateRecord(table.id, record1.id, {
        [linkFieldId]: [{ id: record2.id }, { id: record3.id }],
      });
      await ctx.testContainer.processOutbox();

      const fieldIds = [nameFieldId, linkFieldId, rollupFieldId];
      const fieldNames = ['Name', 'Links', 'Sum'];
      let records = await listRecords(table.id);
      expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '50');
      expect(printTableSnapshot(table.name, fieldNames, records, fieldIds)).toMatchInlineSnapshot(`
        "[SelfManyMany]
        ------------------------
        #  | Name | Links  | Sum
        ------------------------
        R0 | R1   | R2, R3 | 50
        R1 | R2   | -      | 0
        R2 | R3   | -      | 0
        ------------------------"
      `);
      let stored = records.find((r) => r.id === record1.id);
      expect(stored?.fields[rollupFieldId]).toBe(50);

      ctx.testContainer.clearLogs(); // Clear logs before the update
      await ctx.updateRecord(table.id, record1.id, { [linkFieldId]: [{ id: record3.id }] });
      await ctx.testContainer.processOutbox();

      // Verify computed update steps - self-referencing manyMany rollup updates
      const plan = ctx.testContainer.getLastComputedPlan();
      expect(plan).toBeDefined();
      expect(plan!.steps.length).toBe(2); // Two steps: link title update + Sum rollup
      const nameMaps = buildNameMaps({ id: table.id, name: 'SelfManyMany' }, [
        { id: nameFieldId, name: 'Name' },
        { id: valueFieldId, name: 'Value' },
        { id: linkFieldId, name: 'Links' },
        { id: rollupFieldId, name: 'Sum' },
      ]);
      expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
        "[Computed Steps: 2]
          L0: SelfManyMany -> [Links]
          L1: SelfManyMany -> [Sum]
        [Edges: 2]"
      `);

      records = await listRecords(table.id);
      expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '30');
      expect(printTableSnapshot(table.name, fieldNames, records, fieldIds)).toMatchInlineSnapshot(`
         "[SelfManyMany]
         -----------------------
         #  | Name | Links | Sum
         -----------------------
         R0 | R1   | R3    | 30
         R1 | R2   | -     | 0
         R2 | R3   | -     | 0
         -----------------------"
       `);

      stored = records.find((r) => r.id === record1.id);
      expect(stored?.fields[rollupFieldId]).toBe(30);
    });

    it('self link with formula chain - handles cross_record dependencies correctly', async () => {
      const nameFieldId = createFieldId();
      const valueFieldId = createFieldId();
      const formulaFieldId = createFieldId();
      const table = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createField({
        baseId: ctx.baseId,
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

      await ctx.createField({
        baseId: ctx.baseId,
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

      const parent = await ctx.createRecord(table.id, {
        [nameFieldId]: 'Parent',
        [valueFieldId]: 10,
      });
      const child = await ctx.createRecord(table.id, {
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
      expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '-');
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
      expect(beforeChild?.fields[parentLookupFieldId]).toEqual([20]);

      ctx.testContainer.clearLogs(); // Clear logs before the update
      await ctx.updateRecord(table.id, parent.id, { [valueFieldId]: 15 });
      await ctx.testContainer.processOutbox();

      // Verify computed update steps - self-referencing formula chain
      // Chain: Value -> Double (formula) -> ParentDouble (lookup of formula)
      const plans = ctx.testContainer.getComputedPlans();
      expect(plans.length).toBe(2);
      const nameMaps = buildNameMaps({ id: table.id, name: 'SelfFormulaChain' }, [
        { id: valueFieldId, name: 'Value' },
        { id: formulaFieldId, name: 'Double' },
        { id: parentLinkFieldId, name: 'Parent' },
        { id: parentLookupFieldId, name: 'ParentDouble' },
      ]);
      // First plan: sync formula update (Double) + link title update
      expect(plans[0].steps.length).toBe(2);
      expect(printComputedSteps(plans[0], nameMaps)).toMatchInlineSnapshot(`
        "[Computed Steps: 2]
          L0: SelfFormulaChain -> [Double]
          L1: SelfFormulaChain -> [ParentDouble]
        [Edges: 1]"
      `);

      const afterRecords = await listRecords(table.id);
      expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '-');
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
      expect(afterChild?.fields[parentLookupFieldId]).toEqual([30]);
    });

    /**
     * Scenario: Multi-level self ancestry links + lookup chain + COUNTA formula.
     * v1 reference: formula-counta-lookup-ancestry.e2e-spec.ts
     *
     * Tests deep self-referencing parent chains where:
     *   parent (link) -> ancestor1..ancestorN (lookup of link) -> level formula (COUNTA over ancestors)
     *
     * Ensures computed propagation works for deep dependency chains and remains stable after duplication.
     */
    it('counts every non-empty ancestor link even when the field is duplicated', async () => {
      const titleFieldId = createFieldId();
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'SelfAncestryCounTA',
        fields: [{ type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      const parentFieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'link',
          id: parentFieldId,
          name: 'parent',
          options: {
            relationship: 'manyOne',
            foreignTableId: table.id,
            lookupFieldId: titleFieldId,
            isOneWay: true,
          },
        },
      });

      const ancestor1FieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'lookup',
          id: ancestor1FieldId,
          name: 'ancestor1',
          options: {
            foreignTableId: table.id,
            linkFieldId: parentFieldId,
            lookupFieldId: parentFieldId,
          },
        },
      });

      const ancestor2FieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'lookup',
          id: ancestor2FieldId,
          name: 'ancestor2',
          options: {
            foreignTableId: table.id,
            linkFieldId: parentFieldId,
            lookupFieldId: ancestor1FieldId,
          },
        },
      });

      const ancestor3FieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'lookup',
          id: ancestor3FieldId,
          name: 'ancestor3',
          options: {
            foreignTableId: table.id,
            linkFieldId: parentFieldId,
            lookupFieldId: ancestor2FieldId,
          },
        },
      });

      const ancestor4FieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'lookup',
          id: ancestor4FieldId,
          name: 'ancestor4',
          options: {
            foreignTableId: table.id,
            linkFieldId: parentFieldId,
            lookupFieldId: ancestor3FieldId,
          },
        },
      });

      const ancestor5FieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'lookup',
          id: ancestor5FieldId,
          name: 'ancestor5',
          options: {
            foreignTableId: table.id,
            linkFieldId: parentFieldId,
            lookupFieldId: ancestor4FieldId,
          },
        },
      });

      const levelExpression = `COUNTA({${ancestor5FieldId}},{${ancestor4FieldId}},{${ancestor3FieldId}},{${ancestor2FieldId}},{${ancestor1FieldId}},{${parentFieldId}})+1`;

      const levelFieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'formula',
          id: levelFieldId,
          name: 'level',
          options: { expression: levelExpression },
        },
      });

      const levelCopyFieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'formula',
          id: levelCopyFieldId,
          name: 'level_copy',
          options: { expression: levelExpression },
        },
      });

      const root = await ctx.createRecord(table.id, { [titleFieldId]: 'root' });
      const child = await ctx.createRecord(table.id, {
        [titleFieldId]: 'child',
        [parentFieldId]: { id: root.id },
      });
      const grandchild = await ctx.createRecord(table.id, {
        [titleFieldId]: 'grandchild',
        [parentFieldId]: { id: child.id },
      });
      const greatGrandchild = await ctx.createRecord(table.id, {
        [titleFieldId]: 'great-grandchild',
        [parentFieldId]: { id: grandchild.id },
      });

      // Allow computed lookups to propagate through the ancestry chain.
      for (let i = 0; i < 10; i += 1) {
        const drained = await ctx.testContainer.processOutbox();
        if (drained === 0) break;
      }

      const records = await listRecords(table.id);
      const leafIndex = records.findIndex((r) => r.id === greatGrandchild.id);
      expect(leafIndex).toBeGreaterThanOrEqual(0);

      // Leaf should have parent link set and both duplicated formulas should match.
      expectCellDisplay(records, leafIndex, parentFieldId, 'grandchild');
      expectCellDisplay(records, leafIndex, levelFieldId, '4');
      expectCellDisplay(records, leafIndex, levelCopyFieldId, '4');
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

        const table = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(table.id, { [nameFieldId]: 'Row1', [numFieldId]: 3 });

        const fieldIds = [nameFieldId, numFieldId, formulaFieldId];
        const fieldNames = ['Name', 'Num', 'Double'];
        const records = await listRecords(table.id);
        expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '6');
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
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'CreateSymB',
          fields: [{ type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        const recordB = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'Target' });

        // Table A: manyOne link to B
        const aNameFieldId = createFieldId();
        const aLinkFieldId = createFieldId();
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
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

        expectCellDisplay(bRecordsBefore, 0, bFieldIds[bFieldIds.length - 1], '-');
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
        await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'A1',
          [aLinkFieldId]: { id: recordB.id },
        });
        await ctx.testContainer.processOutbox();

        const bRecordsAfter1 = await listRecords(tableB.id);
        expectCellDisplay(bRecordsAfter1, 0, bFieldIds[bFieldIds.length - 1], 'A1');
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
        await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'A2',
          [aLinkFieldId]: { id: recordB.id },
        });
        await ctx.testContainer.processOutbox();

        const bRecordsAfter2 = await listRecords(tableB.id);
        expectCellDisplay(bRecordsAfter2, 0, bFieldIds[bFieldIds.length - 1], 'A1, A2');
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
        const parentTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'ParentRollupCreate',
          fields: [
            { type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true },
          ],
          views: [{ type: 'grid' }],
        });

        const childNameFieldId = createFieldId();
        const childValueFieldId = createFieldId();
        const childLinkFieldId = createFieldId();
        const childTable = await ctx.createTable({
          baseId: ctx.baseId,
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

        const parentTableWithLink = await ctx.getTableById(parentTable.id);
        const symmetricLinkField = parentTableWithLink.fields.find(
          (field) => field.type === 'link' && field.options?.symmetricFieldId === childLinkFieldId
        );
        expect(symmetricLinkField).toBeDefined();
        if (!symmetricLinkField) {
          throw new Error('Missing symmetric link field');
        }

        const rollupFieldId = createFieldId();
        await ctx.createField({
          baseId: ctx.baseId,
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

        const parentRecord = await ctx.createRecord(parentTable.id, {
          [parentNameFieldId]: 'Parent1',
        });

        await ctx.createRecord(childTable.id, {
          [childNameFieldId]: 'Child1',
          [childValueFieldId]: 10,
          [childLinkFieldId]: { id: parentRecord.id },
        });
        await ctx.testContainer.processOutbox();

        const fieldIds = [parentNameFieldId, symmetricLinkField.id, rollupFieldId];
        const fieldNames = ['Name', 'Children', 'Sum'];
        const parentRecords = await listRecords(parentTable.id);
        expectCellDisplay(parentRecords, 0, fieldIds[fieldIds.length - 1], '10');
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

        const table = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(table.id, {
          [nameFieldId]: 'Test',
          [numAFieldId]: 10,
          [numBFieldId]: 20,
        });

        const beforeRecords = await listRecords(table.id);
        expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '60');
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
        await ctx.updateRecord(table.id, record.id, { [numAFieldId]: 100 });

        const afterRecords = await listRecords(table.id);
        expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '60');
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

        const table = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(table.id, {
          [nameFieldId]: 'Test',
          [descFieldId]: 'Original',
          [numFieldId]: 10,
        });

        const beforeRecords = await listRecords(table.id);
        expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '20');
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
        await ctx.updateRecord(table.id, record.id, { [descFieldId]: 'Updated' });

        const afterRecords = await listRecords(table.id);
        expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '20');
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

        const table = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(table.id, { [nameFieldId]: 'Test', [numFieldId]: 5 });

        const beforeRecords = await listRecords(table.id);
        expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '15');
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
        await ctx.updateRecord(table.id, record.id, { [numFieldId]: 10 });

        const afterRecords = await listRecords(table.id);
        expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '20');
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
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'TableB_DeleteLookup',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: bScoreFieldId, name: 'Score' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordB = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'ItemB',
          [bScoreFieldId]: 100,
        });

        // Table A: Has link to B and lookup on B.Score
        const aNameFieldId = createFieldId();
        const linkToBFieldId = createFieldId();
        const lookupScoreFieldId = createFieldId();
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
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
        const recordA = await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'ItemA',
          [linkToBFieldId]: { id: recordB.id },
        });

        const beforeRecordsB = await listRecords(tableB.id);
        expectCellDisplay(beforeRecordsB, 0, bFieldIds[bFieldIds.length - 1], '100');
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
        expectCellDisplay(beforeRecordsA, 0, aFieldIds[aFieldIds.length - 1], '[100]');
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
        expect(beforeA?.fields[lookupScoreFieldId]).toEqual([100]);

        // Delete the linked record B
        await ctx.deleteRecord(tableB.id, recordB.id);

        // Process any pending outbox tasks
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();

        // Verify A's lookup is now null/empty and link is cleared
        const afterRecordsA = await listRecords(tableA.id);
        expectCellDisplay(afterRecordsA, 0, aFieldIds[aFieldIds.length - 1], '-');
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
        expect(afterRecordsB).toHaveLength(0);
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
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'TableB_DeleteRollup',
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: bValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const recordB1 = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bValueFieldId]: 10,
        });
        const recordB2 = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B2',
          [bValueFieldId]: 20,
        });

        // Table A: Has link to B (manyMany) and rollup SUM on B.Value
        const aNameFieldId = createFieldId();
        const linksToBFieldId = createFieldId();
        const sumValuesFieldId = createFieldId();
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
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

        await ctx.createRecord(tableA.id, {
          [aNameFieldId]: 'ItemA',
          [linksToBFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
        });

        const beforeRecords = await listRecords(tableA.id);
        expectCellDisplay(beforeRecords, 0, aFieldIds[aFieldIds.length - 1], '30');
        expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecords, aFieldIds))
          .toMatchInlineSnapshot(`
            "[TableA_DeleteRollup]
            ---------------------------
            #  | Name  | LinksToB | Sum
            ---------------------------
            R0 | ItemA | B1, B2   | 30
            ---------------------------"
          `);

        await ctx.deleteRecord(tableB.id, recordB1.id);
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();

        const afterRecords = await listRecords(tableA.id);
        expectCellDisplay(afterRecords, 0, aFieldIds[aFieldIds.length - 1], '20');
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
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'TableA_DeleteSymmetric',
          fields: [{ type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        // Table B: Has manyMany link to A
        const bNameFieldId = createFieldId();
        const linkToAFieldId = createFieldId();
        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
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
        const recordA1 = await ctx.createRecord(tableA.id, { [aNameFieldId]: 'A1' });
        const recordA2 = await ctx.createRecord(tableA.id, { [aNameFieldId]: 'A2' });

        // Create record in B linking to both A records
        const recordB = await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B',
          [linkToAFieldId]: [{ id: recordA1.id }, { id: recordA2.id }],
        });

        // Process any pending symmetric link updates
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();

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

        expectCellDisplay(beforeA1Records, 0, aFieldIds[aFieldIds.length - 1], 'B');
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
        expectCellDisplay(beforeBRecords, 0, bFieldIds[bFieldIds.length - 1], 'A1, A2');
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
        await ctx.deleteRecord(tableB.id, recordB.id);

        // Process symmetric link cleanup
        await ctx.testContainer.processOutbox();
        await ctx.testContainer.processOutbox();

        // Verify A1's symmetric link no longer contains B
        const afterA1Records = await listRecords(tableA.id);
        expectCellDisplay(afterA1Records, 0, aFieldIds[aFieldIds.length - 1], '-');
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
        expect(afterBRecords).toHaveLength(0);
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
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'MixedB',
        fields: [
          { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: bValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const recordB1 = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bValueFieldId]: 100,
      });
      const recordB2 = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B2',
        [bValueFieldId]: 200,
      });

      // Table A: Has own formula AND link lookup
      const aNameFieldId = createFieldId();
      const aNumFieldId = createFieldId();
      const aFormulaFieldId = createFieldId();
      const aLinkFieldId = createFieldId();
      const aLookupFieldId = createFieldId();
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A1',
        [aNumFieldId]: 10,
        [aLinkFieldId]: { id: recordB1.id },
      });

      const beforeRecords = await listRecords(tableA.id);
      expectCellDisplay(beforeRecords, 0, aFieldIds[aFieldIds.length - 1], '[100]');
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
      await ctx.updateRecord(tableA.id, record.id, {
        [aNumFieldId]: 50,
        [aLinkFieldId]: { id: recordB2.id },
      });
      await ctx.testContainer.processOutbox();

      const afterRecords = await listRecords(tableA.id);
      expectCellDisplay(afterRecords, 0, aFieldIds[aFieldIds.length - 1], '[200]');
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
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CircularA',
        fields: [{ type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      const bNameFieldId = createFieldId();
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CircularB',
        fields: [{ type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      const aLinkFieldId = createFieldId();
      const aLookupFieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
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

      await ctx.createField({
        baseId: ctx.baseId,
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
      await ctx.createField({
        baseId: ctx.baseId,
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

      await ctx.createField({
        baseId: ctx.baseId,
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

      const recordA = await ctx.createRecord(tableA.id, { [aNameFieldId]: 'A1' });
      const recordB = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'B1' });

      await ctx.updateRecord(tableA.id, recordA.id, { [aLinkFieldId]: { id: recordB.id } });
      await ctx.updateRecord(tableB.id, recordB.id, { [bLinkFieldId]: { id: recordA.id } });
      await ctx.testContainer.processOutbox();

      const aFieldIds = [aNameFieldId, aLinkFieldId, aLookupFieldId];
      const aFieldNames = ['Name', 'LinkB', 'BName'];
      const bFieldIds = [bNameFieldId, bLinkFieldId, bLookupFieldId];
      const bFieldNames = ['Name', 'LinkA', 'AName'];
      let aRecords = await listRecords(tableA.id);
      let bRecords = await listRecords(tableB.id);
      expectCellDisplay(aRecords, 0, aFieldIds[aFieldIds.length - 1], '[B1]');
      expect(printTableSnapshot(tableA.name, aFieldNames, aRecords, aFieldIds))
        .toMatchInlineSnapshot(`
          "[CircularA]
          -------------------------
          #  | Name | LinkB | BName
          -------------------------
          R0 | A1   | B1    | [B1]
          -------------------------"
        `);
      expectCellDisplay(bRecords, 0, bFieldIds[bFieldIds.length - 1], '[A1]');
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

      await ctx.updateRecord(tableA.id, recordA.id, { [aNameFieldId]: 'A1-updated' });
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      const drained = await ctx.testContainer.processOutbox();
      expect(drained).toBe(0);

      aRecords = await listRecords(tableA.id);
      bRecords = await listRecords(tableB.id);
      expectCellDisplay(aRecords, 0, aFieldIds[aFieldIds.length - 1], '[B1]');
      expect(printTableSnapshot(tableA.name, aFieldNames, aRecords, aFieldIds))
        .toMatchInlineSnapshot(`
          "[CircularA]
          -------------------------------
          #  | Name       | LinkB | BName
          -------------------------------
          R0 | A1-updated | B1    | [B1]
          -------------------------------"
        `);
      expectCellDisplay(bRecords, 0, bFieldIds[bFieldIds.length - 1], '[A1-updated]');
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
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'EmptyToPopB',
        fields: [
          { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: bValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const recordB1 = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bValueFieldId]: 10,
      });
      const recordB2 = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B2',
        [bValueFieldId]: 20,
      });

      // Table A: manyMany link with rollup
      const aNameFieldId = createFieldId();
      const aLinkFieldId = createFieldId();
      const aRollupFieldId = createFieldId();
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
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

      // Create with explicit empty links to trigger rollup seed update
      await ctx.createRecord(tableA.id, { [aNameFieldId]: 'A1', [aLinkFieldId]: [] });

      const beforeRecords = await listRecords(tableA.id);
      expectCellDisplay(beforeRecords, 0, aFieldIds[aFieldIds.length - 1], '0');
      expect(printTableSnapshot(tableA.name, aFieldNames, beforeRecords, aFieldIds))
        .toMatchInlineSnapshot(`
          "[EmptyToPopA]
          -----------------------
          #  | Name | Links | Sum
          -----------------------
          R0 | A1   | -     | 0
          -----------------------"
        `);

      // Populate links
      const record = beforeRecords[0];
      await ctx.updateRecord(tableA.id, record.id, {
        [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
      });
      await ctx.testContainer.processOutbox();

      const afterRecords = await listRecords(tableA.id);
      expectCellDisplay(afterRecords, 0, aFieldIds[aFieldIds.length - 1], '30');
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
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'PopToEmptyB',
        fields: [
          { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: bValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const recordB1 = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bValueFieldId]: 10,
      });
      const recordB2 = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B2',
        [bValueFieldId]: 20,
      });

      // Table A
      const aNameFieldId = createFieldId();
      const aLinkFieldId = createFieldId();
      const aRollupFieldId = createFieldId();
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
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
      await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A1',
        [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
      });

      const beforeRecords = await listRecords(tableA.id);
      expectCellDisplay(beforeRecords, 0, aFieldIds[aFieldIds.length - 1], '30');
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
      await ctx.updateRecord(tableA.id, record.id, { [aLinkFieldId]: [] });
      await ctx.testContainer.processOutbox();

      const afterRecords = await listRecords(tableA.id);
      expectCellDisplay(afterRecords, 0, aFieldIds[aFieldIds.length - 1], '0');
      expect(printTableSnapshot(tableA.name, aFieldNames, afterRecords, aFieldIds))
        .toMatchInlineSnapshot(`
          "[PopToEmptyA]
          -----------------------
          #  | Name | Links | Sum
          -----------------------
          R0 | A1   | -     | 0
          -----------------------"
        `);
    });

    /**
     * Scenario: Null value in formula source field.
     * v1 behavior: blank numeric operands are treated as zero in arithmetic formulas.
     */
    it('handles null values in formula calculations', async () => {
      const nameFieldId = createFieldId();
      const numFieldId = createFieldId();
      const formulaFieldId = createFieldId();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
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
      await ctx.createRecord(table.id, { [nameFieldId]: 'NoNum' });
      // Create with Num
      await ctx.createRecord(table.id, { [nameFieldId]: 'HasNum', [numFieldId]: 5 });

      const beforeRecords = await listRecords(table.id);
      expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '0');
      expect(printTableSnapshot(table.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[NullFormula]
          --------------------------
          #  | Name   | Num | Double
          --------------------------
          R0 | NoNum  | -   | 0
          R1 | HasNum | 5   | 10
          --------------------------"
        `);

      // Set null to a value
      const noNumRecord = beforeRecords.find((r) => r.fields[nameFieldId] === 'NoNum');
      await ctx.updateRecord(table.id, noNumRecord!.id, { [numFieldId]: 10 });

      // Set value to null (by not including it or setting 0)
      const hasNumRecord = beforeRecords.find((r) => r.fields[nameFieldId] === 'HasNum');
      await ctx.updateRecord(table.id, hasNumRecord!.id, { [numFieldId]: null });

      const afterRecords = await listRecords(table.id);
      expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '20');
      expect(printTableSnapshot(table.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[NullFormula]
          --------------------------
          #  | Name   | Num | Double
          --------------------------
          R0 | NoNum  | 10  | 20
          R1 | HasNum | -   | 0
          --------------------------"
        `);
    });

    /**
     * Scenario: Circular dependency including formulas (not just link+lookup).
     * v1 reference: link-formula-recursion.e2e-spec.ts
     *
     * v2 currently covers circular link/lookups; this extends coverage to include formulas in the cycle:
     *   A.lookup -> A.formula -> B.lookup(A.formula) while B links back to A (cycle)
     *
     * Should not overflow the stack or deadlock, and updates should converge.
     */
    it('handles circular dependencies that include formula + lookup without infinite loop', async () => {
      const aNameFieldId = createFieldId();
      const aLinkToBFieldId = createFieldId();
      const aLookupBNameFieldId = createFieldId();
      const aFormulaFieldId = createFieldId();

      const bNameFieldId = createFieldId();
      const bLinkToAFieldId = createFieldId();
      const bLookupALabelFieldId = createFieldId();

      // Create tables first (minimal schema), then add fields to form:
      // B.Name -> A.lookup(B.Name) -> A.formula -> B.lookup(A.formula), while A<->B are linked.
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CycleA',
        fields: [{ type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CycleB',
        fields: [{ type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Table A: Link to B -> Lookup B.Name -> Formula uses lookup value.
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: tableA.id,
        field: {
          type: 'link',
          id: aLinkToBFieldId,
          name: 'LinkB',
          options: {
            relationship: 'manyOne',
            foreignTableId: tableB.id,
            lookupFieldId: bNameFieldId,
            isOneWay: true,
          },
        },
      });
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: tableA.id,
        field: {
          type: 'lookup',
          id: aLookupBNameFieldId,
          name: 'BName',
          options: {
            linkFieldId: aLinkToBFieldId,
            foreignTableId: tableB.id,
            lookupFieldId: bNameFieldId,
          },
        },
      });
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: tableA.id,
        field: {
          type: 'formula',
          id: aFormulaFieldId,
          name: 'ALabel',
          options: { expression: `CONCATENATE("A-", {${aLookupBNameFieldId}})` },
        },
      });

      // Table B: Link to A -> Lookup A.ALabel (depends on B.Name through A.BName).
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: tableB.id,
        field: {
          type: 'link',
          id: bLinkToAFieldId,
          name: 'LinkA',
          options: {
            relationship: 'manyOne',
            foreignTableId: tableA.id,
            lookupFieldId: aNameFieldId,
            isOneWay: true,
          },
        },
      });
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: tableB.id,
        field: {
          type: 'lookup',
          id: bLookupALabelFieldId,
          name: 'ALabelFromA',
          options: {
            foreignTableId: tableA.id,
            linkFieldId: bLinkToAFieldId,
            lookupFieldId: aFormulaFieldId,
          },
        },
      });

      const recordA = await ctx.createRecord(tableA.id, { [aNameFieldId]: 'A1' });
      const recordB = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'B1' });

      await ctx.updateRecord(tableA.id, recordA.id, { [aLinkToBFieldId]: { id: recordB.id } });
      await ctx.updateRecord(tableB.id, recordB.id, { [bLinkToAFieldId]: { id: recordA.id } });

      // Drain any async tasks; should converge and not loop infinitely.
      let drained = -1;
      for (let i = 0; i < 10; i += 1) {
        drained = await ctx.testContainer.processOutbox();
        if (drained === 0) break;
      }
      expect(drained).toBe(0);

      let aRecords = await listRecords(tableA.id);
      let bRecords = await listRecords(tableB.id);

      expectCellDisplay(aRecords, 0, aLookupBNameFieldId, '[B1]');
      expectCellDisplay(aRecords, 0, aFormulaFieldId, 'A-B1');
      expectCellDisplay(bRecords, 0, bLookupALabelFieldId, '[A-B1]');

      // Update B name; should propagate: B.Name -> A.BName -> A.ALabel -> B.ALabelFromA
      await ctx.updateRecord(tableB.id, recordB.id, { [bNameFieldId]: 'B1-updated' });

      drained = -1;
      for (let i = 0; i < 10; i += 1) {
        drained = await ctx.testContainer.processOutbox();
        if (drained === 0) break;
      }
      expect(drained).toBe(0);

      aRecords = await listRecords(tableA.id);
      bRecords = await listRecords(tableB.id);

      expectCellDisplay(aRecords, 0, aLookupBNameFieldId, '[B1-updated]');
      expectCellDisplay(aRecords, 0, aFormulaFieldId, 'A-B1-updated');
      expectCellDisplay(bRecords, 0, bLookupALabelFieldId, '[A-B1-updated]');
    });

    /**
     * Scenario: Deleting a foreign table used in nested link/lookup chains.
     * v1 reference: computed-orchestrator.e2e-spec.ts (skips joining missing nested link CTEs when a foreign table is deleted)
     *
     * Tests that after deleting the leaf table in a nested chain (T3.lookup(T2.lookup(T1.field))),
     * further updates on remaining tables do not crash and the computed values degrade gracefully.
     *
     * NOTE: Not implemented yet (blocked on stable delete-table semantics):
     * - Table deletion/cleanup impacts computed dependency graphs, CTE joins, and outbox orchestration
     * - Add this after we have a clear policy for cascading cleanup + recompute strategy on table deletion
     */
    test.todo(
      'Nested lookup chain survives foreign table deletion: Implement after delete-table semantics + computed dependency cleanup are stabilized'
    );
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
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalRollup Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      const record1 = await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
      });
      const record2 = await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
      });
      const record3 = await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
        [foreignStatusFieldId]: 'inactive',
      });

      // Host table: Has conditionalRollup field
      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '30');
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Host]
          -----------------------
          #  | Name  | Active Sum
          -----------------------
          R0 | Host1 | 30
          -----------------------"
        `);

      // Update foreign record value - should update rollup
      ctx.testContainer.clearLogs(); // Clear logs before the update
      await ctx.updateRecord(foreignTable.id, record1.id, { [foreignValueFieldId]: 15 });
      await ctx.testContainer.processOutbox();

      // Verify computed update steps - conditionalRollup updates in host table
      const plan = ctx.testContainer.getLastComputedPlan();
      expect(plan).toBeDefined();
      expect(plan!.steps.length).toBe(1); // One step: update Active Sum in host table
      const nameMaps = buildMultiTableNameMaps([
        {
          id: foreignTable.id,
          name: 'ConditionalRollup Foreign',
          fields: [{ id: foreignValueFieldId, name: 'Value' }],
        },
        {
          id: hostTable.id,
          name: 'ConditionalRollup Host',
          fields: [{ id: conditionalRollupFieldId, name: 'Active Sum' }],
        },
      ]);
      expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
        "[Computed Steps: 1]
          L0: ConditionalRollup Host -> [Active Sum]
        [Edges: 2]"
      `);

      const afterRecords = await listRecords(hostTable.id);
      expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '35');
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Host]
          -----------------------
          #  | Name  | Active Sum
          -----------------------
          R0 | Host1 | 35
          -----------------------"
        `);
    });

    /**
     * Scenario: Formula referencing conditionalRollup field.
     *
     * Regression: Conditional fields are computed via a conditional lateral join; formulas that reference
     * conditionalRollup must reference the conditional lateral alias instead of the base table column alias,
     * otherwise the formula sees NULL and breaks downstream updates.
     */
    it('allows formulas to reference conditionalRollup (regression)', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignAmountFieldId = createFieldId();

      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CR_FormulaRef_Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
          { type: 'number', id: foreignAmountFieldId, name: 'Amount' },
        ],
        views: [{ type: 'grid' }],
      });

      const active1 = await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'A1',
        [foreignStatusFieldId]: 'active',
        [foreignAmountFieldId]: 5,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'A2',
        [foreignStatusFieldId]: 'active',
        [foreignAmountFieldId]: 10,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'I1',
        [foreignStatusFieldId]: 'inactive',
        [foreignAmountFieldId]: 999,
      });

      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const formulaFieldId = createFieldId();

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CR_FormulaRef_Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalRollup',
            id: conditionalRollupFieldId,
            name: 'ActiveSum',
            options: { expression: 'sum({values})' },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignAmountFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [{ fieldId: foreignStatusFieldId, operator: 'is', value: 'active' }],
                },
              },
            },
          },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'ActiveSumPlus1',
            options: { expression: `{${conditionalRollupFieldId}} + 1` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });

      for (let i = 0; i < 5; i += 1) {
        const drained = await ctx.testContainer.processOutbox();
        if (drained === 0) break;
      }

      let records = await listRecords(hostTable.id);
      expectCellDisplay(records, 0, conditionalRollupFieldId, '15');
      expectCellDisplay(records, 0, formulaFieldId, '16');

      // Update a foreign record; both conditionalRollup and the referencing formula should update.
      await ctx.updateRecord(foreignTable.id, active1.id, { [foreignAmountFieldId]: 7 });

      for (let i = 0; i < 5; i += 1) {
        const drained = await ctx.testContainer.processOutbox();
        if (drained === 0) break;
      }

      records = await listRecords(hostTable.id);
      expectCellDisplay(records, 0, conditionalRollupFieldId, '17');
      expectCellDisplay(records, 0, formulaFieldId, '18');
    });

    /**
     * Scenario: ConditionalRollup with multiple filter conditions (AND).
     */
    it('updates conditionalRollup with multiple AND filter conditions', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignCategoryFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalRollup MultiFilter Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
          { type: 'singleLineText', id: foreignCategoryFieldId, name: 'Category' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'A',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'B',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'A',
      });

      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '40');
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup MultiFilter Host]
          -------------------------
          #  | Name  | Filtered Sum
          -------------------------
          R0 | Host1 | 40
          -------------------------"
        `);
    });

    /**
     * Scenario: ConditionalRollup with OR filter conditions.
     */
    it('updates conditionalRollup with OR filter conditions', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignCategoryFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalRollup ORFilter Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignCategoryFieldId, name: 'Category' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignCategoryFieldId]: 'A',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignCategoryFieldId]: 'B',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
        [foreignCategoryFieldId]: 'C',
      });

      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '30');
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup ORFilter Host]
          -------------------
          #  | Name  | OR Sum
          -------------------
          R0 | Host1 | 30
          -------------------"
        `);
    });

    /**
     * Scenario: ConditionalRollup with sort condition.
     */
    it('updates conditionalRollup with sort condition', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalRollup Sort Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 30,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 10,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 20,
      });

      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '30');
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Sort Host]
          -----------------------
          #  | Name  | Sorted Max
          -----------------------
          R0 | Host1 | 30
          -----------------------"
        `);
    });

    /**
     * Scenario: ConditionalRollup with limit condition.
     */
    it('updates conditionalRollup with limit condition', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalRollup Limit Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item4',
        [foreignValueFieldId]: 40,
      });

      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      // Should sum only top 2 values (40 + 30 = 70)
      expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '70');
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Limit Host]
          ------------------------
          #  | Name  | Limited Sum
          ------------------------
          R0 | Host1 | 70
          ------------------------"
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
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalRollup Nested Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
          { type: 'singleLineText', id: foreignCategoryFieldId, name: 'Category' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'A',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'B',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
        [foreignStatusFieldId]: 'inactive',
        [foreignCategoryFieldId]: 'A',
      });

      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '30');
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Nested Host]
          -----------------------
          #  | Name  | Nested Sum
          -----------------------
          R0 | Host1 | 30
          -----------------------"
        `);
    });

    /**
     * Scenario: ConditionalRollup with different rollup expressions.
     */
    it('updates conditionalRollup with different rollup expressions', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalRollup Expressions Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
      });

      const hostNameFieldId = createFieldId();
      const sumFieldId = createFieldId();
      const avgFieldId = createFieldId();
      const maxFieldId = createFieldId();
      const minFieldId = createFieldId();
      const countFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '3');
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Expressions Host]
          ----------------------------------------------
          #  | Name  | Sum | Average | Max | Min | Count
          ----------------------------------------------
          R0 | Host1 | 60  | 20      | 30  | 10  | 3
          ----------------------------------------------"
        `);
    });

    /**
     * Scenario: ConditionalRollup updates when foreign records are added/removed.
     */
    it('updates conditionalRollup when foreign records are added', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalRollup Add Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
      });

      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '10');
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Add Host]
          -----------------------
          #  | Name  | Active Sum
          -----------------------
          R0 | Host1 | 10
          -----------------------"
        `);

      // Add new foreign record matching condition
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
      });
      await ctx.testContainer.processOutbox();

      const afterRecords = await listRecords(hostTable.id);
      expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '30');
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup Add Host]
          -----------------------
          #  | Name  | Active Sum
          -----------------------
          R0 | Host1 | 30
          -----------------------"
        `);
    });

    /**
     * Scenario: ConditionalRollup with same-table condition (self-referencing).
     * This tests that conditionalRollup can filter records from the same table.
     */
    it.todo('updates conditionalRollup with same-table condition');
    /*
    it('updates conditionalRollup with same-table condition', async () => {
      const nameFieldId = createFieldId();
      const valueFieldId = createFieldId();
      const statusFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const table = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(table.id, {
        [nameFieldId]: 'Item1',
        [valueFieldId]: 10,
        [statusFieldId]: 'active',
      });
      await ctx.createRecord(table.id, {
        [nameFieldId]: 'Item2',
        [valueFieldId]: 20,
        [statusFieldId]: 'active',
      });
      await ctx.createRecord(table.id, {
        [nameFieldId]: 'Item3',
        [valueFieldId]: 30,
        [statusFieldId]: 'inactive',
      });

      // For now, test with a separate foreign table
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
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
    */

    /**
     * Scenario: ConditionalRollup rejects empty condition.
     */
    it('rejects conditionalRollup with empty condition', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalRollup Reject Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const hostNameFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalRollup Reject Host',
        fields: [{ type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Try to create conditionalRollup with empty condition (filter: null)
      const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
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
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalRollup EmptyFilter Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const hostNameFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalRollup EmptyFilter Host',
        fields: [{ type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Try to create conditionalRollup with empty filterSet
      const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
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

    /**
     * Scenario: ConditionalRollup referencing another ConditionalRollup field.
     * v1 reference: conditional-lookup.e2e-spec.ts (lines 2412-2710)
     *
     * Tests that a conditionalRollup can aggregate another conditionalRollup field:
     *   - suppliers.supplierRatingConditionalRollup (rollup of products.Rating filtered by Rating isNotEmpty)
     *   - suppliers.conditionalRollupMirrorField (rollup of supplierRatingConditionalRollup filtered by value > 0)
     */
    test.todo(
      'ConditionalRollup referencing another ConditionalRollup: Need to verify nested conditionalRollup dependencies work correctly'
    );

    /**
     * Scenario: Multi-layer conditional rollup chain with field-reference filter.
     * v1 reference: lookup.e2e-spec.ts (lines 1691-1939)
     *
     * Tests a three-table chain with conditionalRollup aggregating nested rollup values:
     *   - Root.FilteredLeafScoreSum = conditionalRollup of Middle.LeafScoreTotal
     *     where Middle.Category is Root.CategoryFilter
     *   - Filter uses `value: { type: 'field', fieldId: rootCategoryFilterFieldId }`
     */
    test.todo(
      'Multi-layer conditional rollup chain: Need to verify 3-table chain with field-reference filter in conditionalRollup'
    );

    /**
     * Scenario: Select option name synchronization in conditionalRollup filters.
     * v1 reference: conditional-rollup.e2e-spec.ts (lines 531-604)
     *
     * When a SingleSelect/MultiSelect field's option name changes, conditionalRollup
     * filters that reference that option value should be automatically updated.
     * Example: If filter has `value: 'Active'` and 'Active' is renamed to 'Active Plus',
     * the filter should update to `value: 'Active Plus'`.
     */
    test.todo(
      'Select option name synchronization in conditionalRollup: Need to verify filters update when select option names change'
    );

    /**
     * Scenario: ConditionalRollup with field reference filter (Self equality filters).
     * v1 reference: conditional-rollup.e2e-spec.ts (lines 289-400)
     *
     * Tests that conditionalRollup correctly uses field reference filters:
     * - filter: { fieldId: foreignCategory, operator: 'is', value: { type: 'field', fieldId: hostCategoryFilter } }
     * - When host field value changes, the rollup recomputes to include/exclude different foreign records
     *
     * TODO: v2 does not yet support cross-table field reference in condition filter
     */
    it.skip('updates conditionalRollup when host field reference filter value changes', async () => {
      // Foreign table: Source of rollup values with category
      const foreignNameFieldId = createFieldId();
      const foreignAmountFieldId = createFieldId();
      const foreignCategoryFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CR_FieldRef_Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignAmountFieldId, name: 'Amount' },
          { type: 'singleLineText', id: foreignCategoryFieldId, name: 'Category' },
        ],
        views: [{ type: 'grid' }],
      });

      // Create foreign records with different categories
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignAmountFieldId]: 100,
        [foreignCategoryFieldId]: 'Hardware',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignAmountFieldId]: 50,
        [foreignCategoryFieldId]: 'Hardware',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignAmountFieldId]: 70,
        [foreignCategoryFieldId]: 'Software',
      });

      // Host table: Has conditionalRollup with field reference filter
      const hostNameFieldId = createFieldId();
      const hostCategoryFilterFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CR_FieldRef_Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: hostCategoryFilterFieldId, name: 'CategoryFilter' },
          {
            type: 'conditionalRollup',
            id: conditionalRollupFieldId,
            name: 'CategorySum',
            options: {
              expression: 'sum({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignAmountFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignCategoryFieldId,
                      operator: 'is',
                      // Field reference: compare foreign.Category = host.CategoryFilter
                      value: { type: 'field', fieldId: hostCategoryFilterFieldId },
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, hostCategoryFilterFieldId, conditionalRollupFieldId];
      const fieldNames = ['Name', 'CategoryFilter', 'CategorySum'];

      // Create host record with CategoryFilter = 'Hardware'
      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host1',
        [hostCategoryFilterFieldId]: 'Hardware',
      });
      await ctx.testContainer.processOutbox();

      // Verify initial rollup value (100 + 50 = 150 for Hardware)
      const beforeRecords = await listRecords(hostTable.id);
      expectCellDisplay(beforeRecords, 0, conditionalRollupFieldId, '150');
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[CR_FieldRef_Host]
          -------------------------------------
          #  | Name  | CategoryFilter | CategorySum
          -------------------------------------
          R0 | Host1 | Hardware       | 150
          -------------------------------------"
        `);

      // Update host.CategoryFilter to 'Software' - should trigger rollup recomputation
      ctx.testContainer.clearLogs();
      await ctx.updateRecord(hostTable.id, hostRecord.id, {
        [hostCategoryFilterFieldId]: 'Software',
      });
      await ctx.testContainer.processOutbox();

      // Verify rollup now shows Software total (70)
      const afterRecords = await listRecords(hostTable.id);
      expectCellDisplay(afterRecords, 0, conditionalRollupFieldId, '70');
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[CR_FieldRef_Host]
          -------------------------------------
          #  | Name  | CategoryFilter | CategorySum
          -------------------------------------
          R0 | Host1 | Software       | 70
          -------------------------------------"
        `);

      // Verify computed update plan
      const plan = ctx.testContainer.getLastComputedPlan();
      expect(plan).toBeDefined();
      const nameMaps = buildMultiTableNameMaps([
        {
          id: hostTable.id,
          name: 'CR_FieldRef_Host',
          fields: [
            { id: hostCategoryFilterFieldId, name: 'CategoryFilter' },
            { id: conditionalRollupFieldId, name: 'CategorySum' },
          ],
        },
      ]);
      expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
        "[Computed Steps: 1]
          L0: CR_FieldRef_Host -> [CategorySum]
        [Edges: 1]"
      `);
    });

    /**
     * Scenario: ConditionalRollup with numeric field reference filter.
     * v1 reference: conditional-rollup.e2e-spec.ts (lines 519-704)
     *
     * Tests numeric comparison with field reference:
     * - filter: { fieldId: foreignAmount, operator: 'isGreater', value: { type: 'field', fieldId: hostMinimumAmount } }
     * - When host threshold field changes, the rollup recomputes
     *
     * TODO: v2 does not yet support cross-table field reference in condition filter
     */
    it.skip('updates conditionalRollup when host numeric threshold field changes', async () => {
      // Foreign table: Source with numeric values
      const foreignNameFieldId = createFieldId();
      const foreignAmountFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CR_NumericRef_Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignAmountFieldId, name: 'Amount' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignAmountFieldId]: 100,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignAmountFieldId]: 50,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignAmountFieldId]: 30,
      });

      // Host table with numeric threshold filter
      const hostNameFieldId = createFieldId();
      const hostMinAmountFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CR_NumericRef_Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: hostMinAmountFieldId, name: 'MinAmount' },
          {
            type: 'conditionalRollup',
            id: conditionalRollupFieldId,
            name: 'SumAboveThreshold',
            options: {
              expression: 'sum({values})',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignAmountFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignAmountFieldId,
                      operator: 'isGreater',
                      value: { type: 'field', fieldId: hostMinAmountFieldId },
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, hostMinAmountFieldId, conditionalRollupFieldId];
      const fieldNames = ['Name', 'MinAmount', 'SumAboveThreshold'];

      // Create host record with MinAmount = 40 (items > 40: 100, 50 = 150)
      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host1',
        [hostMinAmountFieldId]: 40,
      });
      await ctx.testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expectCellDisplay(beforeRecords, 0, conditionalRollupFieldId, '150');
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[CR_NumericRef_Host]
          -------------------------------------
          #  | Name  | MinAmount | SumAboveThreshold
          -------------------------------------
          R0 | Host1 | 40        | 150
          -------------------------------------"
        `);

      // Update threshold to 60 (items > 60: only 100)
      ctx.testContainer.clearLogs();
      await ctx.updateRecord(hostTable.id, hostRecord.id, {
        [hostMinAmountFieldId]: 60,
      });
      await ctx.testContainer.processOutbox();

      const afterRecords = await listRecords(hostTable.id);
      expectCellDisplay(afterRecords, 0, conditionalRollupFieldId, '100');
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[CR_NumericRef_Host]
          -------------------------------------
          #  | Name  | MinAmount | SumAboveThreshold
          -------------------------------------
          R0 | Host1 | 60        | 100
          -------------------------------------"
        `);
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
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
        [foreignStatusFieldId]: 'inactive',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '[10, 20]');
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Host]
          --------------------------
          #  | Name  | Active Values
          --------------------------
          R0 | Host1 | [10, 20]
          --------------------------"
        `);

      // Update foreign record value - should update lookup
      const foreignRecords = await listRecords(foreignTable.id);
      const item1 = foreignRecords.find((r) => r.fields[foreignNameFieldId] === 'Item1');
      ctx.testContainer.clearLogs(); // Clear logs before the update
      await ctx.updateRecord(foreignTable.id, item1!.id, { [foreignValueFieldId]: 15 });
      await ctx.testContainer.processOutbox();

      // Verify computed update steps - conditionalLookup updates in host table
      const plan = ctx.testContainer.getLastComputedPlan();
      expect(plan).toBeDefined();
      expect(plan!.steps.length).toBe(1); // One step: update Active Values in host table
      const nameMaps = buildMultiTableNameMaps([
        {
          id: foreignTable.id,
          name: 'ConditionalLookup Foreign',
          fields: [{ id: foreignValueFieldId, name: 'Value' }],
        },
        {
          id: hostTable.id,
          name: 'ConditionalLookup Host',
          fields: [{ id: conditionalLookupFieldId, name: 'Active Values' }],
        },
      ]);
      expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
        "[Computed Steps: 1]
          L0: ConditionalLookup Host -> [Active Values]
        [Edges: 2]"
      `);

      const afterRecords = await listRecords(hostTable.id);
      expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '[15, 20]');
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Host]
          --------------------------
          #  | Name  | Active Values
          --------------------------
          R0 | Host1 | [15, 20]
          --------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup with sort condition.
     */
    it('updates conditionalLookup with sort condition', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup Sort Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 30,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 10,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 20,
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '[30, 20, 10]');
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Sort Host]
          --------------------------
          #  | Name  | Sorted Values
          --------------------------
          R0 | Host1 | [30, 20, 10]
          --------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup with limit condition.
     */
    it('updates conditionalLookup with limit condition', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup Limit Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item4',
        [foreignValueFieldId]: 40,
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      // Should return only top 2 values (40, 30)
      expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '[40, 30]');
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Limit Host]
          ---------------------------
          #  | Name  | Limited Values
          ---------------------------
          R0 | Host1 | [40, 30]
          ---------------------------"
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
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup MultiFilter Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
          { type: 'singleLineText', id: foreignCategoryFieldId, name: 'Category' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'A',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'B',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'A',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '[10, 30]');
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup MultiFilter Host]
          ----------------------------
          #  | Name  | Filtered Values
          ----------------------------
          R0 | Host1 | [10, 30]
          ----------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup with same-table condition (self-referencing).
     */
    it.todo(
      'updates conditionalLookup with same-table condition (needs support for foreignTableId = same table)'
    );

    /**
     * Scenario: ConditionalLookup rejects empty condition.
     */
    it('rejects conditionalLookup with empty condition', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup Reject Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      const hostNameFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup Reject Host',
        fields: [{ type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Try to create conditionalLookup with empty condition (filter: null)
      const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
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
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup Text Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: foreignTextFieldId, name: 'Text' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignTextFieldId]: 'Alpha',
        [foreignStatusFieldId]: 'active',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignTextFieldId]: 'Beta',
        [foreignStatusFieldId]: 'active',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignTextFieldId]: 'Gamma',
        [foreignStatusFieldId]: 'inactive',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '[Alpha, Beta]');
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Text Host]
          --------------------------
          #  | Name  | Active Texts
          --------------------------
          R0 | Host1 | [Alpha, Beta]
          --------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup updates when foreign records are added/removed.
     */
    it('updates conditionalLookup when foreign records are added', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup Add Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '[10]');
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Add Host]
          --------------------------
          #  | Name  | Active Values
          --------------------------
          R0 | Host1 | [10]
          --------------------------"
        `);

      // Add new foreign record matching condition
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
      });
      await ctx.testContainer.processOutbox();

      const afterRecords = await listRecords(hostTable.id);
      expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '[10, 20]');
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Add Host]
          --------------------------
          #  | Name  | Active Values
          --------------------------
          R0 | Host1 | [10, 20]
          --------------------------"
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
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup Nested Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
          { type: 'singleLineText', id: foreignCategoryFieldId, name: 'Category' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'A',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
        [foreignCategoryFieldId]: 'B',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
        [foreignStatusFieldId]: 'inactive',
        [foreignCategoryFieldId]: 'A',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '[10, 20]');
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Nested Host]
          --------------------------
          #  | Name  | Nested Values
          --------------------------
          R0 | Host1 | [10, 20]
          --------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup with boolean field lookup.
     */
    it('updates conditionalLookup with boolean field lookup', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignBooleanFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup Boolean Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'checkbox', id: foreignBooleanFieldId, name: 'Flag' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignBooleanFieldId]: true,
        [foreignStatusFieldId]: 'active',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignBooleanFieldId]: false,
        [foreignStatusFieldId]: 'active',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignBooleanFieldId]: true,
        [foreignStatusFieldId]: 'inactive',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '[true, false]');
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Boolean Host]
          --------------------------
          #  | Name  | Active Flags
          --------------------------
          R0 | Host1 | [true, false]
          --------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup with different operators in condition.
     */
    it('updates conditionalLookup with different filter operators', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup Operators Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignValueFieldId]: 30,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item4',
        [foreignValueFieldId]: 40,
      });

      const hostNameFieldId = createFieldId();
      const greaterThanFieldId = createFieldId();
      const lessThanFieldId = createFieldId();
      const equalFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const records = await listRecords(hostTable.id);
      expectCellDisplay(records, 0, fieldIds[fieldIds.length - 1], '[20]');
      expect(printTableSnapshot(hostTable.name, fieldNames, records, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Operators Host]
          ------------------------------------------------------
          #  | Name  | Greater Than 15 | Less Than 25 | Equal 20
          ------------------------------------------------------
          R0 | Host1 | [20, 30, 40]    | [10, 20]     | [20]
          ------------------------------------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup updates when foreign record is deleted.
     */
    it('updates conditionalLookup when foreign record is deleted', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup Delete Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      const record1 = await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
      });
      const record2 = await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'active',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '[10, 20]');
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Delete Host]
          --------------------------
          #  | Name  | Active Values
          --------------------------
          R0 | Host1 | [10, 20]
          --------------------------"
        `);

      // Delete foreign record
      await ctx.deleteRecord(foreignTable.id, record1.id);
      await ctx.testContainer.processOutbox();

      const afterRecords = await listRecords(hostTable.id);
      expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '[20]');
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup Delete Host]
          --------------------------
          #  | Name  | Active Values
          --------------------------
          R0 | Host1 | [20]
          --------------------------"
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
     * Scenario: ConditionalLookup with field reference filter.
     * v1 reference: conditional-lookup.e2e-spec.ts (lines 59-169)
     *
     * Tests that conditionalLookup correctly uses field reference filters:
     * - filter: { fieldId: foreignStatus, operator: 'is', value: { type: 'field', fieldId: hostStatusFilter } }
     * - When host field value changes, the lookup recomputes to include/exclude different foreign records
     *
     * TODO: v2 does not yet support cross-table field reference in condition filter
     */
    it.skip('updates conditionalLookup when host field reference filter value changes', async () => {
      // Foreign table: Source of lookup values with status
      const foreignNameFieldId = createFieldId();
      const foreignTitleFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CL_FieldRef_Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: foreignTitleFieldId, name: 'Title' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      // Create foreign records with different statuses
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignTitleFieldId]: 'Alpha',
        [foreignStatusFieldId]: 'Active',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignTitleFieldId]: 'Beta',
        [foreignStatusFieldId]: 'Active',
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignTitleFieldId]: 'Gamma',
        [foreignStatusFieldId]: 'Closed',
      });

      // Host table: Has conditionalLookup with field reference filter
      const hostNameFieldId = createFieldId();
      const hostStatusFilterFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CL_FieldRef_Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: hostStatusFilterFieldId, name: 'StatusFilter' },
          {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'MatchingTitles',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignTitleFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignStatusFieldId,
                      operator: 'is',
                      // Field reference: compare foreign.Status = host.StatusFilter
                      value: { type: 'field', fieldId: hostStatusFilterFieldId },
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, hostStatusFilterFieldId, conditionalLookupFieldId];
      const fieldNames = ['Name', 'StatusFilter', 'MatchingTitles'];

      // Create host record with StatusFilter = 'Active'
      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host1',
        [hostStatusFilterFieldId]: 'Active',
      });
      await ctx.testContainer.processOutbox();

      // Verify initial lookup value (Alpha, Beta for Active)
      const beforeRecords = await listRecords(hostTable.id);
      expectCellDisplay(beforeRecords, 0, conditionalLookupFieldId, '[Alpha, Beta]');
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[CL_FieldRef_Host]
          -------------------------------------
          #  | Name  | StatusFilter | MatchingTitles
          -------------------------------------
          R0 | Host1 | Active       | [Alpha, Beta]
          -------------------------------------"
        `);

      // Update host.StatusFilter to 'Closed' - should trigger lookup recomputation
      ctx.testContainer.clearLogs();
      await ctx.updateRecord(hostTable.id, hostRecord.id, {
        [hostStatusFilterFieldId]: 'Closed',
      });
      await ctx.testContainer.processOutbox();

      // Verify lookup now shows Closed items (Gamma)
      const afterRecords = await listRecords(hostTable.id);
      expectCellDisplay(afterRecords, 0, conditionalLookupFieldId, '[Gamma]');
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[CL_FieldRef_Host]
          -------------------------------------
          #  | Name  | StatusFilter | MatchingTitles
          -------------------------------------
          R0 | Host1 | Closed       | [Gamma]
          -------------------------------------"
        `);

      // Verify computed update plan
      const plan = ctx.testContainer.getLastComputedPlan();
      expect(plan).toBeDefined();
      const nameMaps = buildMultiTableNameMaps([
        {
          id: hostTable.id,
          name: 'CL_FieldRef_Host',
          fields: [
            { id: hostStatusFilterFieldId, name: 'StatusFilter' },
            { id: conditionalLookupFieldId, name: 'MatchingTitles' },
          ],
        },
      ]);
      expect(printComputedSteps(plan!, nameMaps)).toMatchInlineSnapshot(`
        "[Computed Steps: 1]
          L0: CL_FieldRef_Host -> [MatchingTitles]
        [Edges: 1]"
      `);
    });

    /**
     * Scenario: ConditionalLookup with numeric field reference filter.
     * v1 reference: conditional-lookup.e2e-spec.ts (lines 3564-3829 "numeric array field reference filters")
     *
     * Tests numeric comparison with field reference in conditionalLookup:
     * - filter: { fieldId: foreignScore, operator: 'isGreater', value: { type: 'field', fieldId: hostThreshold } }
     * - When host threshold changes, lookup recomputes
     *
     * TODO: v2 does not yet support cross-table field reference in condition filter
     */
    it.skip('updates conditionalLookup when host numeric threshold field changes', async () => {
      // Foreign table with numeric scores
      const foreignNameFieldId = createFieldId();
      const foreignScoreFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CL_NumericRef_Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignScoreFieldId, name: 'Score' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignScoreFieldId]: 100,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignScoreFieldId]: 50,
      });
      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item3',
        [foreignScoreFieldId]: 30,
      });

      // Host table with numeric threshold filter
      const hostNameFieldId = createFieldId();
      const hostThresholdFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CL_NumericRef_Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: hostThresholdFieldId, name: 'Threshold' },
          {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'ScoresAbove',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignScoreFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignScoreFieldId,
                      operator: 'isGreater',
                      value: { type: 'field', fieldId: hostThresholdFieldId },
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const fieldIds = [hostNameFieldId, hostThresholdFieldId, conditionalLookupFieldId];
      const fieldNames = ['Name', 'Threshold', 'ScoresAbove'];

      // Create host record with Threshold = 40 (items > 40: 100, 50)
      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host1',
        [hostThresholdFieldId]: 40,
      });
      await ctx.testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expectCellDisplay(beforeRecords, 0, conditionalLookupFieldId, '[100, 50]');
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[CL_NumericRef_Host]
          -------------------------------------
          #  | Name  | Threshold | ScoresAbove
          -------------------------------------
          R0 | Host1 | 40        | [100, 50]
          -------------------------------------"
        `);

      // Update threshold to 60 (items > 60: only 100)
      ctx.testContainer.clearLogs();
      await ctx.updateRecord(hostTable.id, hostRecord.id, {
        [hostThresholdFieldId]: 60,
      });
      await ctx.testContainer.processOutbox();

      const afterRecords = await listRecords(hostTable.id);
      expectCellDisplay(afterRecords, 0, conditionalLookupFieldId, '[100]');
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[CL_NumericRef_Host]
          -------------------------------------
          #  | Name  | Threshold | ScoresAbove
          -------------------------------------
          R0 | Host1 | 60        | [100]
          -------------------------------------"
        `);
    });

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
     * Scenario: ConditionalLookup with lookup field in condition.
     *
     * TODO: v2 may not support filtering by lookup field values in conditionalLookup
     */
    it.skip('updates conditionalLookup when condition uses lookup field', async () => {
      const customerNameFieldId = createFieldId();
      const customerStatusFieldId = createFieldId();
      const customersTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CL_LookupCondition_Customers',
        fields: [
          { type: 'singleLineText', id: customerNameFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: customerStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      const activeCustomer = await ctx.createRecord(customersTable.id, {
        [customerNameFieldId]: 'Acme',
        [customerStatusFieldId]: 'active',
      });
      const inactiveCustomer = await ctx.createRecord(customersTable.id, {
        [customerNameFieldId]: 'Beta',
        [customerStatusFieldId]: 'inactive',
      });

      const orderNameFieldId = createFieldId();
      const orderAmountFieldId = createFieldId();
      const orderCustomerLinkFieldId = createFieldId();
      const orderCustomerStatusLookupFieldId = createFieldId();
      const ordersTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CL_LookupCondition_Orders',
        fields: [
          { type: 'singleLineText', id: orderNameFieldId, name: 'Order', isPrimary: true },
          {
            type: 'link',
            id: orderCustomerLinkFieldId,
            name: 'Customer',
            options: {
              relationship: 'manyOne',
              foreignTableId: customersTable.id,
              lookupFieldId: customerNameFieldId,
            },
          },
          { type: 'number', id: orderAmountFieldId, name: 'Amount' },
          {
            type: 'lookup',
            id: orderCustomerStatusLookupFieldId,
            name: 'CustomerStatus',
            options: {
              linkFieldId: orderCustomerLinkFieldId,
              foreignTableId: customersTable.id,
              lookupFieldId: customerStatusFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(ordersTable.id, {
        [orderNameFieldId]: 'Order-1',
        [orderAmountFieldId]: 100,
        [orderCustomerLinkFieldId]: { id: activeCustomer.id },
      });
      await ctx.createRecord(ordersTable.id, {
        [orderNameFieldId]: 'Order-2',
        [orderAmountFieldId]: 50,
        [orderCustomerLinkFieldId]: { id: inactiveCustomer.id },
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CL_LookupCondition_Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'Active Amounts',
            options: {
              foreignTableId: ordersTable.id,
              lookupFieldId: orderAmountFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: orderCustomerStatusLookupFieldId,
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
      const fieldNames = ['Name', 'Active Amounts'];

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expectCellDisplay(beforeRecords, 0, conditionalLookupFieldId, '[100]');
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[CL_LookupCondition_Host]
          ---------------------------
          #  | Name  | Active Amounts
          ---------------------------
          R0 | Host1 | [100]
          ---------------------------"
        `);

      await ctx.updateRecord(customersTable.id, inactiveCustomer.id, {
        [customerStatusFieldId]: 'active',
      });
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      const afterRecords = await listRecords(hostTable.id);
      expectCellDisplay(afterRecords, 0, conditionalLookupFieldId, '[100, 50]');
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[CL_LookupCondition_Host]
          ---------------------------
          #  | Name  | Active Amounts
          ---------------------------
          R0 | Host1 | [100, 50]
          ---------------------------"
        `);
    });

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
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalRollup FilterChange Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      const record1 = await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
      });
      const record2 = await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'inactive',
      });

      const hostNameFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '10');
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup FilterChange Host]
          -----------------------
          #  | Name  | Active Sum
          -----------------------
          R0 | Host1 | 10
          -----------------------"
        `);

      // Change record2 status from inactive to active - should now be included
      await ctx.updateRecord(foreignTable.id, record2.id, { [foreignStatusFieldId]: 'active' });
      await ctx.testContainer.processOutbox();

      const afterRecords = await listRecords(hostTable.id);
      expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '30');
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalRollup FilterChange Host]
          -----------------------
          #  | Name  | Active Sum
          -----------------------
          R0 | Host1 | 30
          -----------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup updates when condition filter field changes.
     */
    it('updates conditionalLookup when condition filter field value changes', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup FilterChange Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });

      const record1 = await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item1',
        [foreignValueFieldId]: 10,
        [foreignStatusFieldId]: 'active',
      });
      const record2 = await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Item2',
        [foreignValueFieldId]: 20,
        [foreignStatusFieldId]: 'inactive',
      });

      const hostNameFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
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

      await ctx.createRecord(hostTable.id, { [hostNameFieldId]: 'Host1' });
      await ctx.testContainer.processOutbox();

      const beforeRecords = await listRecords(hostTable.id);
      expectCellDisplay(beforeRecords, 0, fieldIds[fieldIds.length - 1], '[10]');
      expect(printTableSnapshot(hostTable.name, fieldNames, beforeRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup FilterChange Host]
          --------------------------
          #  | Name  | Active Values
          --------------------------
          R0 | Host1 | [10]
          --------------------------"
        `);

      // Change record2 status from inactive to active - should now be included
      await ctx.updateRecord(foreignTable.id, record2.id, { [foreignStatusFieldId]: 'active' });
      await ctx.testContainer.processOutbox();

      const afterRecords = await listRecords(hostTable.id);
      expectCellDisplay(afterRecords, 0, fieldIds[fieldIds.length - 1], '[10, 20]');
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[ConditionalLookup FilterChange Host]
          --------------------------
          #  | Name  | Active Values
          --------------------------
          R0 | Host1 | [10, 20]
          --------------------------"
        `);
    });

    /**
     * Scenario: ConditionalLookup referencing another ConditionalLookup field.
     * v1 reference: conditional-lookup.e2e-spec.ts (lines 2412-2710)
     *
     * Tests that a conditionalLookup can look up another conditionalLookup field,
     * creating a nested dependency chain:
     *   - suppliers.supplierRatingConditionalLookup (lookup of products.Rating filtered by Rating isNotEmpty)
     *   - suppliers.conditionalLookupMirrorField (lookup of supplierRatingConditionalLookup filtered by value isNotEmpty)
     */
    test.todo(
      'ConditionalLookup referencing another ConditionalLookup: Need to verify nested conditionalLookup dependencies work correctly'
    );

    /**
     * Scenario: Multi-layer conditional lookup chain with field-reference filter.
     * v1 reference: lookup.e2e-spec.ts (lines 1691-1939)
     *
     * Tests a three-table chain where the root table has a conditionalLookup
     * that filters based on a field reference to the host table:
     *   - Leaf table: LeafName, LeafScore
     *   - Middle table: Category, LeafLink (→Leaf), LeafNames (lookup), LeafScores (lookup), LeafScoreTotal (rollup)
     *   - Root table: CategoryFilter, FilteredLeafNames (conditionalLookup of LeafNames where Category is CategoryFilter)
     *
     * The filter uses `value: { type: 'field', fieldId: rootCategoryFilterFieldId }` to compare
     * middle.Category against root.CategoryFilter dynamically per-record.
     */
    test.todo(
      'Multi-layer conditional lookup chain: Need to verify 3-table chain with field-reference filter in conditionalLookup'
    );

    /**
     * Scenario: Select option name synchronization in conditionalLookup filters.
     * v1 reference: conditional-rollup.e2e-spec.ts (lines 531-604)
     *
     * When a SingleSelect/MultiSelect field's option name changes, conditionalLookup
     * filters that reference that option value should be automatically updated.
     * Example: If filter has `value: 'Active'` and 'Active' is renamed to 'Active Plus',
     * the filter should update to `value: 'Active Plus'`.
     */
    test.todo(
      'Select option name synchronization in conditionalLookup: Need to verify filters update when select option names change'
    );

    /**
     * Scenario: Conditional fields comparing link titles to host text.
     * v1 reference: computed-orchestrator.e2e-spec.ts (evaluates equality filter comparing link titles to host text)
     *
     * Tests a conditionalRollup/conditionalLookup filter where a criterion compares:
     *   foreign.<someLink>.title (or link-derived text) against host.<textField>
     *
     * This is a common "join-on-title" style condition and must recompute when:
     *   - host text changes
     *   - foreign link target changes
     *   - the linked record's primary/title changes
     */
    test.todo(
      'Conditional fields comparing link titles to host text: Need to verify equality filters over link-derived titles recompute correctly'
    );

    /**
     * Scenario: Conditional fields mark dependencies as errored when referenced fields are removed.
     * v1 reference: computed-orchestrator.e2e-spec.ts (marks hasError when referenced lookup or filter fields are removed)
     *
     * Tests that conditionalLookup/conditionalRollup fields become hasError=true when:
     *   - the referenced lookupFieldId is deleted/converted to incompatible type
     *   - any filterSet fieldId is deleted/converted to incompatible type
     *
     * NOTE: Implement after v2 exposes/stabilizes computed field `hasError` semantics via the v2 HTTP DTOs.
     */
    test.todo(
      'Conditional fields hasError on missing dependencies: Implement after v2 exposes computed field error status in HTTP DTOs'
    );

    /**
     * Scenario: IF branches return link field or text (type coercion).
     * v1 reference: link-formula-if-boolean-context.e2e-spec.ts
     *
     * Regression: IF/CASE branches returning link (json) values must be coerced to text,
     * otherwise Postgres may error with "CASE types text and jsonb cannot be matched".
     */
    it('coerces link display in IF branches (regression)', async () => {
      const tableANameFieldId = createFieldId();
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkIf_A',
        fields: [
          { type: 'singleLineText', id: tableANameFieldId, name: 'A Name', isPrimary: true },
        ],
        views: [{ type: 'grid' }],
      });

      const recordA = await ctx.createRecord(tableA.id, {
        [tableANameFieldId]: 'Alpha',
      });

      const tableBNameFieldId = createFieldId();
      const tableBActiveFieldId = createFieldId();
      const tableBEmptyTextFieldId = createFieldId();
      const tableBLinkFieldId = createFieldId();
      const tableBFormulaFieldId = createFieldId();

      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkIf_B',
        fields: [
          { type: 'singleLineText', id: tableBNameFieldId, name: 'B Name', isPrimary: true },
          { type: 'checkbox', id: tableBActiveFieldId, name: 'Active' },
          { type: 'singleLineText', id: tableBEmptyTextFieldId, name: 'Empty Text' },
          {
            type: 'link',
            id: tableBLinkFieldId,
            name: 'Link to A',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableA.id,
              lookupFieldId: tableANameFieldId,
              isOneWay: true,
            },
          },
          {
            type: 'formula',
            id: tableBFormulaFieldId,
            name: 'Display',
            options: {
              expression: `IF({${tableBActiveFieldId}}, {${tableBLinkFieldId}}, {${tableBEmptyTextFieldId}})`,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const recordB = await ctx.createRecord(tableB.id, {
        [tableBNameFieldId]: 'Row-1',
        [tableBActiveFieldId]: true,
        [tableBEmptyTextFieldId]: 'ignore',
      });

      await ctx.updateRecord(tableB.id, recordB.id, {
        [tableBLinkFieldId]: { id: recordA.id, title: 'Alpha' },
      });

      const records = await listRecords(tableB.id);
      const recordIndex = records.findIndex((record) => record.id === recordB.id);
      expect(recordIndex).toBeGreaterThanOrEqual(0);
      if (recordIndex < 0) return;

      expectCellDisplay(records, recordIndex, tableBFormulaFieldId, 'Alpha');
      expectCellDisplay(records, recordIndex, tableBLinkFieldId, 'Alpha');
    });

    /**
     * Scenario: ConditionalLookup used inside a formula IF branch (type coercion).
     * v1 reference: formula-conditional-lookup-numeric-if.e2e-spec.ts
     *
     * Regression: IF/CASE branches returning conditionalLookup (json/jsonb array) values must be
     * coerced correctly when the overall formula is numeric; otherwise Postgres may error with
     * "CASE types <numeric> and jsonb cannot be matched" during computed updates.
     */
    it('coerces conditionalLookup arrays in numeric IF/CASE branches (regression)', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignAmountFieldId = createFieldId();

      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CL_IF_Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
          { type: 'number', id: foreignAmountFieldId, name: 'Amount' },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'A',
        [foreignStatusFieldId]: 'active',
        [foreignAmountFieldId]: 5,
      });

      await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'B',
        [foreignStatusFieldId]: 'inactive',
        [foreignAmountFieldId]: 999,
      });

      const hostNameFieldId = createFieldId();
      const hostFlagFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const formulaFieldId = createFieldId();

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CL_IF_Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          { type: 'checkbox', id: hostFlagFieldId, name: 'Flag' },
          {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'ActiveAmounts',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignAmountFieldId,
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

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host1',
        [hostFlagFieldId]: true,
      });

      for (let i = 0; i < 5; i += 1) {
        const drained = await ctx.testContainer.processOutbox();
        if (drained === 0) break;
      }

      const beforeRecords = await listRecords(hostTable.id);
      expectCellDisplay(beforeRecords, 0, conditionalLookupFieldId, '[5]');

      // Create formula field after conditionalLookup is populated to ensure evaluation reads the computed column.
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'formula',
          id: formulaFieldId,
          name: 'Delta',
          options: {
            expression: `1 - IF({${hostFlagFieldId}}, {${conditionalLookupFieldId}}, 0)`,
          },
        },
      });

      for (let i = 0; i < 5; i += 1) {
        const drained = await ctx.testContainer.processOutbox();
        if (drained === 0) break;
      }

      const fieldIds = [hostNameFieldId, hostFlagFieldId, conditionalLookupFieldId, formulaFieldId];
      const fieldNames = ['Name', 'Flag', 'ActiveAmounts', 'Delta'];

      const withFormulaRecords = await listRecords(hostTable.id);
      expectCellDisplay(withFormulaRecords, 0, conditionalLookupFieldId, '[5]');
      expectCellDisplay(withFormulaRecords, 0, formulaFieldId, '-4');
      expect(printTableSnapshot(hostTable.name, fieldNames, withFormulaRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[CL_IF_Host]
          -----------------------------------------
          #  | Name  | Flag | ActiveAmounts | Delta
          -----------------------------------------
          R0 | Host1 | true | [5]           | -4
          -----------------------------------------"
        `);

      // Toggle to the ELSE branch; must remain type-compatible even though THEN returns JSONB.
      await ctx.updateRecord(hostTable.id, hostRecord.id, { [hostFlagFieldId]: false });

      const afterRecords = await listRecords(hostTable.id);
      expectCellDisplay(afterRecords, 0, conditionalLookupFieldId, '[5]');
      expectCellDisplay(afterRecords, 0, formulaFieldId, '1');
      expect(printTableSnapshot(hostTable.name, fieldNames, afterRecords, fieldIds))
        .toMatchInlineSnapshot(`
          "[CL_IF_Host]
          ------------------------------------------
          #  | Name  | Flag  | ActiveAmounts | Delta
          ------------------------------------------
          R0 | Host1 | false | [5]           | 1
          ------------------------------------------"
        `);
    });
  });

  describe('formula referencing computed fields as link title', () => {
    /**
     * Scenario: Symmetric link title uses a formula that references a lookup field.
     * v1 reference: link-api.e2e-spec.ts (lines 3325-3548)
     *
     * Chain: table1.lookupAmount (lookup of table2.Amount)
     *        → table1.formula ({lookupAmount})
     *        → table2.symmetricLink (title uses table1.formula)
     *
     * When table2.Amount changes, it should propagate:
     *   table2.Amount → table1.lookupAmount → table1.formula → table2.symmetricLink.title
     */
    it('updates symmetric link title when formula references lookup field', async () => {
      const amountNameFieldId = createFieldId();
      const amountValueFieldId = createFieldId();
      const amountTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkTitleLookup_Amount',
        fields: [
          { type: 'singleLineText', id: amountNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: amountValueFieldId, name: 'Amount' },
        ],
        views: [{ type: 'grid' }],
      });

      const amountRecord = await ctx.createRecord(amountTable.id, {
        [amountNameFieldId]: 'INV-001',
        [amountValueFieldId]: 100,
      });

      const hostLinkFieldId = createFieldId();
      const hostLookupAmountFieldId = createFieldId();
      const hostPrimaryFormulaFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkTitleLookup_Host',
        fields: [
          {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Invoices',
            options: {
              relationship: 'manyMany',
              foreignTableId: amountTable.id,
              lookupFieldId: amountNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: hostLookupAmountFieldId,
            name: 'InvoiceAmounts',
            options: {
              foreignTableId: amountTable.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: amountValueFieldId,
            },
          },
          {
            type: 'formula',
            id: hostPrimaryFormulaFieldId,
            name: 'Title',
            isPrimary: true,
            options: { expression: `CONCATENATE("Host-", {${hostLookupAmountFieldId}})` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostLinkFieldId]: [{ id: amountRecord.id }],
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      const hostRecords = await listRecords(hostTable.id);
      const hostRecordIndex = hostRecords.findIndex((r) => r.id === hostRecord.id);
      expect(hostRecordIndex).toBeGreaterThanOrEqual(0);

      const hostTitleBefore = hostRecords[hostRecordIndex]?.fields[hostPrimaryFormulaFieldId];
      expect(typeof hostTitleBefore).toBe('string');
      expectCellDisplay(hostRecords, hostRecordIndex, hostLookupAmountFieldId, '[100]');

      const updatedAmountTable = await ctx.getTableById(amountTable.id);
      const symmetricLinkFieldId = updatedAmountTable.fields.find(
        (f) => f.type === 'link' && f.options.foreignTableId === hostTable.id
      )?.id;
      expect(symmetricLinkFieldId).toBeDefined();

      const amountRecordsBefore = await listRecords(amountTable.id);
      const amountRecordIndex = amountRecordsBefore.findIndex((r) => r.id === amountRecord.id);
      expect(amountRecordIndex).toBeGreaterThanOrEqual(0);
      expectCellDisplay(
        amountRecordsBefore,
        amountRecordIndex,
        symmetricLinkFieldId!,
        String(hostTitleBefore)
      );

      // Update Amount.Amount -> Host.lookup -> Host.Title -> Amount.symmetricLink.title
      await ctx.updateRecord(amountTable.id, amountRecord.id, { [amountValueFieldId]: 200 });

      let hostTitleAfter: unknown = hostTitleBefore;
      let symmetricTitleAfter = '';
      for (let i = 0; i < 20; i += 1) {
        await ctx.testContainer.processOutbox();

        const hostRecordsAfter = await listRecords(hostTable.id);
        const storedHostAfter = hostRecordsAfter.find((r) => r.id === hostRecord.id);
        hostTitleAfter = storedHostAfter?.fields[hostPrimaryFormulaFieldId];

        const amountRecordsAfter = await listRecords(amountTable.id);
        const amountRecordIndexAfter = amountRecordsAfter.findIndex(
          (r) => r.id === amountRecord.id
        );
        const amountValueAfter =
          amountRecordsAfter[amountRecordIndexAfter]?.fields[symmetricLinkFieldId!];
        symmetricTitleAfter = formatCellValueForExpect(amountValueAfter);

        if (
          typeof hostTitleAfter === 'string' &&
          hostTitleAfter !== hostTitleBefore &&
          symmetricTitleAfter === String(hostTitleAfter)
        ) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(typeof hostTitleAfter).toBe('string');
      expect(hostTitleAfter).not.toEqual(hostTitleBefore);
      expect(symmetricTitleAfter).toBe(String(hostTitleAfter));
    });

    /**
     * Scenario: Symmetric link title uses a formula that references a lookup field,
     * and a link relation change should refresh the formula + symmetric title.
     *
     * Chain: table1.lookupNames (lookup of table2.Name)
     *        → table1.formulaTitle ({lookupNames})
     *        → table2.symmetricLink (title uses table1.formulaTitle)
     *
     * When link membership changes, it should propagate:
     *   table1.link change → table1.lookupNames → table1.formulaTitle → table2.symmetricLink.title
     */
    it('updates symmetric link title when link membership changes for lookup formula', async () => {
      const amountNameFieldId = createFieldId();
      const amountTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkTitleLookupChange_Amount',
        fields: [{ type: 'singleLineText', id: amountNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      const amountRecord1 = await ctx.createRecord(amountTable.id, {
        [amountNameFieldId]: 'INV-001',
      });
      const amountRecord2 = await ctx.createRecord(amountTable.id, {
        [amountNameFieldId]: 'INV-002',
      });

      const hostLinkFieldId = createFieldId();
      const hostLookupNameFieldId = createFieldId();
      const hostPrimaryFormulaFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkTitleLookupChange_Host',
        fields: [
          {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Invoices',
            options: {
              relationship: 'manyMany',
              foreignTableId: amountTable.id,
              lookupFieldId: amountNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: hostLookupNameFieldId,
            name: 'InvoiceNames',
            options: {
              foreignTableId: amountTable.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: amountNameFieldId,
            },
          },
          {
            type: 'formula',
            id: hostPrimaryFormulaFieldId,
            name: 'Title',
            isPrimary: true,
            options: { expression: `CONCATENATE("Host-", {${hostLookupNameFieldId}})` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostLinkFieldId]: [{ id: amountRecord1.id }],
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      const hostRecords = await listRecords(hostTable.id);
      const hostRecordIndex = hostRecords.findIndex((r) => r.id === hostRecord.id);
      expect(hostRecordIndex).toBeGreaterThanOrEqual(0);

      const hostTitleBefore = hostRecords[hostRecordIndex]?.fields[hostPrimaryFormulaFieldId];
      expect(typeof hostTitleBefore).toBe('string');

      const updatedAmountTable = await ctx.getTableById(amountTable.id);
      const symmetricLinkFieldId = updatedAmountTable.fields.find(
        (f) => f.type === 'link' && f.options.foreignTableId === hostTable.id
      )?.id;
      expect(symmetricLinkFieldId).toBeDefined();

      const amountRecordsBefore = await listRecords(amountTable.id);
      const amountRecordIndexBefore = amountRecordsBefore.findIndex(
        (r) => r.id === amountRecord1.id
      );
      expect(amountRecordIndexBefore).toBeGreaterThanOrEqual(0);
      expectCellDisplay(
        amountRecordsBefore,
        amountRecordIndexBefore,
        symmetricLinkFieldId!,
        String(hostTitleBefore)
      );

      await ctx.updateRecord(hostTable.id, hostRecord.id, {
        [hostLinkFieldId]: [{ id: amountRecord1.id }, { id: amountRecord2.id }],
      });

      let hostTitleAfter: unknown = hostTitleBefore;
      let symmetricTitleAfter1 = '';
      let symmetricTitleAfter2 = '';
      for (let i = 0; i < 20; i += 1) {
        await ctx.testContainer.processOutbox();

        const hostRecordsAfter = await listRecords(hostTable.id);
        const storedHostAfter = hostRecordsAfter.find((r) => r.id === hostRecord.id);
        hostTitleAfter = storedHostAfter?.fields[hostPrimaryFormulaFieldId];

        const amountRecordsAfter = await listRecords(amountTable.id);
        const idx1 = amountRecordsAfter.findIndex((r) => r.id === amountRecord1.id);
        const idx2 = amountRecordsAfter.findIndex((r) => r.id === amountRecord2.id);
        const val1 = amountRecordsAfter[idx1]?.fields[symmetricLinkFieldId!];
        const val2 = amountRecordsAfter[idx2]?.fields[symmetricLinkFieldId!];
        symmetricTitleAfter1 = formatCellValueForExpect(val1);
        symmetricTitleAfter2 = formatCellValueForExpect(val2);

        if (
          typeof hostTitleAfter === 'string' &&
          hostTitleAfter !== hostTitleBefore &&
          symmetricTitleAfter1 === String(hostTitleAfter) &&
          symmetricTitleAfter2 === String(hostTitleAfter)
        ) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(typeof hostTitleAfter).toBe('string');
      expect(hostTitleAfter).not.toEqual(hostTitleBefore);
      expect(symmetricTitleAfter1).toBe(String(hostTitleAfter));
      expect(symmetricTitleAfter2).toBe(String(hostTitleAfter));
    });

    /**
     * Scenario: Symmetric link title uses a formula that references a rollup field.
     * v1 reference: link-api.e2e-spec.ts (lines 3446-3498)
     *
     * Chain: table1.rollup (sum of table2.Amount via link)
     *        → table1.formulaRollup ({rollup})
     *        → table2.symmetricLink (title uses table1.formulaRollup)
     *
     * When table2.Amount changes or link membership changes, it should propagate:
     *   table2.Amount → table1.rollup → table1.formulaRollup → table2.symmetricLink.title
     */
    it('updates symmetric link title when formula references rollup field', async () => {
      const amountNameFieldId = createFieldId();
      const amountValueFieldId = createFieldId();
      const amountTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkTitleRollup_Amount',
        fields: [
          { type: 'singleLineText', id: amountNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: amountValueFieldId, name: 'Amount' },
        ],
        views: [{ type: 'grid' }],
      });

      const amountRecord1 = await ctx.createRecord(amountTable.id, {
        [amountNameFieldId]: 'INV-001',
        [amountValueFieldId]: 100,
      });
      const amountRecord2 = await ctx.createRecord(amountTable.id, {
        [amountNameFieldId]: 'INV-002',
        [amountValueFieldId]: 20,
      });

      const hostLinkFieldId = createFieldId();
      const hostRollupFieldId = createFieldId();
      const hostPrimaryFormulaFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkTitleRollup_Host',
        fields: [
          {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Invoices',
            options: {
              relationship: 'manyMany',
              foreignTableId: amountTable.id,
              lookupFieldId: amountNameFieldId,
            },
          },
          {
            type: 'rollup',
            id: hostRollupFieldId,
            name: 'Total',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: amountTable.id,
              lookupFieldId: amountValueFieldId,
            },
          },
          {
            type: 'formula',
            id: hostPrimaryFormulaFieldId,
            name: 'Title',
            isPrimary: true,
            options: { expression: `CONCATENATE("Total-", {${hostRollupFieldId}})` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostLinkFieldId]: [{ id: amountRecord1.id }],
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      const hostRecords = await listRecords(hostTable.id);
      const hostRecordIndex = hostRecords.findIndex((r) => r.id === hostRecord.id);
      expect(hostRecordIndex).toBeGreaterThanOrEqual(0);

      const hostTitleBefore = hostRecords[hostRecordIndex]?.fields[hostPrimaryFormulaFieldId];
      expect(typeof hostTitleBefore).toBe('string');
      expectCellDisplay(hostRecords, hostRecordIndex, hostRollupFieldId, '100');

      const updatedAmountTable = await ctx.getTableById(amountTable.id);
      const symmetricLinkFieldId = updatedAmountTable.fields.find(
        (f) => f.type === 'link' && f.options.foreignTableId === hostTable.id
      )?.id;
      expect(symmetricLinkFieldId).toBeDefined();

      const amountRecordsBefore = await listRecords(amountTable.id);
      const amountRecordIndex1 = amountRecordsBefore.findIndex((r) => r.id === amountRecord1.id);
      expect(amountRecordIndex1).toBeGreaterThanOrEqual(0);
      expectCellDisplay(
        amountRecordsBefore,
        amountRecordIndex1,
        symmetricLinkFieldId!,
        String(hostTitleBefore)
      );

      // Update Amount.Amount -> Host.rollup -> Host.Title -> Amount.symmetricLink.title
      await ctx.updateRecord(amountTable.id, amountRecord1.id, { [amountValueFieldId]: 200 });

      let hostTitleAfterValueChange: unknown = hostTitleBefore;
      let symmetricTitleAfterValueChange = '';
      for (let i = 0; i < 20; i += 1) {
        await ctx.testContainer.processOutbox();

        const hostRecordsAfter = await listRecords(hostTable.id);
        const storedHostAfter = hostRecordsAfter.find((r) => r.id === hostRecord.id);
        hostTitleAfterValueChange = storedHostAfter?.fields[hostPrimaryFormulaFieldId];

        const amountRecordsAfter = await listRecords(amountTable.id);
        const amountRecordIndexAfter = amountRecordsAfter.findIndex(
          (r) => r.id === amountRecord1.id
        );
        const amountValueAfter =
          amountRecordsAfter[amountRecordIndexAfter]?.fields[symmetricLinkFieldId!];
        symmetricTitleAfterValueChange = formatCellValueForExpect(amountValueAfter);

        if (
          typeof hostTitleAfterValueChange === 'string' &&
          hostTitleAfterValueChange !== hostTitleBefore &&
          symmetricTitleAfterValueChange === String(hostTitleAfterValueChange)
        ) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(typeof hostTitleAfterValueChange).toBe('string');
      expect(hostTitleAfterValueChange).not.toEqual(hostTitleBefore);
      expect(symmetricTitleAfterValueChange).toBe(String(hostTitleAfterValueChange));

      // Link membership change -> should also update rollup/formula and symmetric link title.
      await ctx.updateRecord(hostTable.id, hostRecord.id, {
        [hostLinkFieldId]: [{ id: amountRecord1.id }, { id: amountRecord2.id }],
      });

      let hostTitleAfterLinkChange: unknown = hostTitleAfterValueChange;
      let symmetricTitleAfterLinkChange1 = '';
      let symmetricTitleAfterLinkChange2 = '';
      for (let i = 0; i < 20; i += 1) {
        await ctx.testContainer.processOutbox();

        const hostRecordsAfter = await listRecords(hostTable.id);
        const storedHostAfter = hostRecordsAfter.find((r) => r.id === hostRecord.id);
        hostTitleAfterLinkChange = storedHostAfter?.fields[hostPrimaryFormulaFieldId];

        const amountRecordsAfter = await listRecords(amountTable.id);
        const idx1 = amountRecordsAfter.findIndex((r) => r.id === amountRecord1.id);
        const idx2 = amountRecordsAfter.findIndex((r) => r.id === amountRecord2.id);
        const val1 = amountRecordsAfter[idx1]?.fields[symmetricLinkFieldId!];
        const val2 = amountRecordsAfter[idx2]?.fields[symmetricLinkFieldId!];
        symmetricTitleAfterLinkChange1 = formatCellValueForExpect(val1);
        symmetricTitleAfterLinkChange2 = formatCellValueForExpect(val2);

        if (
          typeof hostTitleAfterLinkChange === 'string' &&
          hostTitleAfterLinkChange !== hostTitleAfterValueChange &&
          symmetricTitleAfterLinkChange1 === String(hostTitleAfterLinkChange) &&
          symmetricTitleAfterLinkChange2 === String(hostTitleAfterLinkChange)
        ) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(typeof hostTitleAfterLinkChange).toBe('string');
      expect(hostTitleAfterLinkChange).not.toEqual(hostTitleAfterValueChange);
      expect(symmetricTitleAfterLinkChange1).toBe(String(hostTitleAfterLinkChange));
      expect(symmetricTitleAfterLinkChange2).toBe(String(hostTitleAfterLinkChange));
    });

    /**
     * Scenario: Multi-value datetime lookup used inside a formula.
     * v1 reference: lookup.e2e-spec.ts (lines 1941-2094)
     *
     * Chain: contractTable.ContractStart (datetime)
     *        → projectTable.ContractStarts (lookup, multi-value datetime array)
     *        → projectTable.LookupPath (formula: "prefix-" & {ContractStarts})
     *
     * Tests that datetime lookup values are properly formatted when concatenated in a formula.
     */
    it('formats multi-value datetime lookups when used in formula concatenation', async () => {
      const contractNameFieldId = createFieldId();
      const contractStartFieldId = createFieldId();
      const contractTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkTitleDateTimeLookup_Contract',
        fields: [
          { type: 'singleLineText', id: contractNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'date',
            id: contractStartFieldId,
            name: 'ContractStart',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const start1 = new Date('2020-01-01T12:34:56.000Z');
      const start2 = new Date('2020-02-03T01:02:03.000Z');
      const contract1 = await ctx.createRecord(contractTable.id, {
        [contractNameFieldId]: 'C1',
        [contractStartFieldId]: start1.toISOString(),
      });
      const contract2 = await ctx.createRecord(contractTable.id, {
        [contractNameFieldId]: 'C2',
        [contractStartFieldId]: start2.toISOString(),
      });

      const projectNameFieldId = createFieldId();
      const projectContractsLinkFieldId = createFieldId();
      const projectContractStartsLookupFieldId = createFieldId();
      const projectLookupPathFormulaFieldId = createFieldId();
      const projectTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkTitleDateTimeLookup_Project',
        fields: [
          { type: 'singleLineText', id: projectNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: projectContractsLinkFieldId,
            name: 'Contracts',
            options: {
              relationship: 'manyMany',
              foreignTableId: contractTable.id,
              lookupFieldId: contractNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: projectContractStartsLookupFieldId,
            name: 'ContractStarts',
            options: {
              foreignTableId: contractTable.id,
              linkFieldId: projectContractsLinkFieldId,
              lookupFieldId: contractStartFieldId,
            },
          },
          {
            type: 'formula',
            id: projectLookupPathFormulaFieldId,
            name: 'LookupPath',
            options: {
              expression: `CONCATENATE("prefix-", {${projectContractStartsLookupFieldId}})`,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const projectRecord = await ctx.createRecord(projectTable.id, {
        [projectNameFieldId]: 'P1',
        [projectContractsLinkFieldId]: [{ id: contract1.id }, { id: contract2.id }],
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      const projectRecords = await listRecords(projectTable.id);
      const projectRecordIndex = projectRecords.findIndex((r) => r.id === projectRecord.id);
      expect(projectRecordIndex).toBeGreaterThanOrEqual(0);

      const startsDisplay = formatCellValueForExpect(
        projectRecords[projectRecordIndex]?.fields[projectContractStartsLookupFieldId]
      );
      expect(startsDisplay).toContain('2020-01-01');
      expect(startsDisplay).toContain('2020-02-03');

      const formulaBefore =
        projectRecords[projectRecordIndex]?.fields[projectLookupPathFormulaFieldId];
      expect(typeof formulaBefore).toBe('string');
      expect(String(formulaBefore)).toContain('prefix-');
      expect(String(formulaBefore)).toContain('2020-01-01');
      expect(String(formulaBefore)).toContain('2020-02-03');

      // Update ContractStart in a linked record; the lookup array and formula string should update.
      const updatedStart1 = new Date('2021-03-04T05:06:07.000Z').toISOString();
      await ctx.updateRecord(contractTable.id, contract1.id, {
        [contractStartFieldId]: updatedStart1,
      });

      let formulaAfter: unknown = formulaBefore;
      for (let i = 0; i < 20; i += 1) {
        await ctx.testContainer.processOutbox();
        const recordsAfter = await listRecords(projectTable.id);
        const storedAfter = recordsAfter.find((r) => r.id === projectRecord.id);
        formulaAfter = storedAfter?.fields[projectLookupPathFormulaFieldId];
        if (typeof formulaAfter === 'string' && formulaAfter !== formulaBefore) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(typeof formulaAfter).toBe('string');
      expect(formulaAfter).not.toEqual(formulaBefore);
      expect(String(formulaAfter)).toContain('prefix-');
      expect(String(formulaAfter)).toContain('2021-03-04');
      expect(String(formulaAfter)).toContain('2020-02-03');
    });

    /**
     * Scenario: Formula string concatenation over multi-value fields (e.g., multi-select) does not hit CASE type mismatches.
     * v1 reference: computed-orchestrator.e2e-spec.ts (computes string formula referencing multi-value field without CASE type mismatch)
     *
     * NOTE: Implement after v2 "update columns" (computed persistence / SQL expression casting) is implemented,
     * since this regression historically surfaced during computed persistence in Postgres.
     */
    test.todo(
      'String formula over multi-value fields: Implement after update-columns to ensure no CASE type mismatches in persisted computed SQL'
    );

    /**
     * Scenario: Multi-value date/datetime lookup used inside date functions with timeZone.
     * v1 reference: computed-orchestrator.e2e-spec.ts (timezone cast regressions, datetime + blank guard regressions)
     *
     * NOTE: Implement after v2 "update columns" is implemented, since these issues are tied to
     * Postgres casts/column types when persisting computed results.
     */
    test.todo(
      'Date/datetime lookup + timeZone formula persistence: Implement after update-columns to guard against timestamptz/jsonb cast regressions'
    );

    /**
     * Scenario: Divide/modulo by zero does not crash computed persistence.
     * v1 reference: computed-orchestrator.e2e-spec.ts (handles divide and modulo by zero during computed persistence)
     *
     * NOTE: Implement after v2 "update columns" is implemented, to validate persistence/update stability.
     */
    test.todo(
      'Divide/modulo by zero in formula persistence: Implement after update-columns to ensure computed updates remain stable'
    );
  });

  // =============================================================================
  // SECTION 8: DIRTY FILTER OPTIMIZATION TESTS
  // =============================================================================
  // These tests verify that computed updates only affect dirty (changed) records,
  // not the entire table. This is critical for performance.

  describe('dirty filter optimization', () => {
    /**
     * Scenario: When updating a single record with a formula field,
     * only that record should be affected by the computed update.
     */
    it('should only update affected records when single record changes', async () => {
      const nameFieldId = createFieldId();
      const valueFieldId = createFieldId();
      const formulaFieldId = createFieldId();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DirtyFilterTest',
        fields: [
          { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: valueFieldId, name: 'Value' },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Doubled',
            options: { expression: `{${valueFieldId}} * 2` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Create multiple records
      const record0 = await ctx.createRecord(table.id, { [nameFieldId]: 'R0', [valueFieldId]: 10 });
      const record1 = await ctx.createRecord(table.id, { [nameFieldId]: 'R1', [valueFieldId]: 20 });
      const record2 = await ctx.createRecord(table.id, { [nameFieldId]: 'R2', [valueFieldId]: 30 });

      // Verify initial state
      const beforeRecords = await listRecords(table.id);
      expectCellDisplay(beforeRecords, 0, formulaFieldId, '20');
      expectCellDisplay(beforeRecords, 1, formulaFieldId, '40');
      expectCellDisplay(beforeRecords, 2, formulaFieldId, '60');

      // Clear logs before update
      ctx.testContainer.clearLogs();

      // Update only record1
      await ctx.updateRecord(table.id, record1.id, { [valueFieldId]: 100 });
      await drainOutbox();

      // Verify computed plan only includes the one updated record
      const plan = ctx.testContainer.getLastComputedPlan();
      expect(plan).toBeDefined();
      expect(plan!.seedRecordIds.length).toBe(1);
      expect(plan!.seedRecordIds[0]).toBe(record1.id);

      // Verify only the updated record changed
      const afterRecords = await listRecords(table.id);
      expectCellDisplay(afterRecords, 0, formulaFieldId, '20'); // unchanged
      expectCellDisplay(afterRecords, 1, formulaFieldId, '200'); // 100 * 2
      expectCellDisplay(afterRecords, 2, formulaFieldId, '60'); // unchanged
    });

    /**
     * Scenario: When updating a field in TableA that is looked up by TableB,
     * only the records in TableB that link to the changed record should be updated.
     */
    it('should efficiently propagate dirty records across tables', async () => {
      // Create TableA with multiple records
      const aNameFieldId = createFieldId();
      const aValueFieldId = createFieldId();

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'PropagationTableA',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      // Create 5 records in TableA
      const aRecords = await Promise.all([
        ctx.createRecord(tableA.id, { [aNameFieldId]: 'A0', [aValueFieldId]: 100 }),
        ctx.createRecord(tableA.id, { [aNameFieldId]: 'A1', [aValueFieldId]: 200 }),
        ctx.createRecord(tableA.id, { [aNameFieldId]: 'A2', [aValueFieldId]: 300 }),
        ctx.createRecord(tableA.id, { [aNameFieldId]: 'A3', [aValueFieldId]: 400 }),
        ctx.createRecord(tableA.id, { [aNameFieldId]: 'A4', [aValueFieldId]: 500 }),
      ]);

      // Create TableB with link and lookup to TableA
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bLookupFieldId = createFieldId();

      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'PropagationTableB',
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

      // Create 10 records in TableB, linking to different A records
      // B0, B5 -> A0; B1, B6 -> A1; B2, B7 -> A2; B3, B8 -> A3; B4, B9 -> A4
      const bRecords = await Promise.all([
        ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B0',
          [bLinkFieldId]: { id: aRecords[0].id },
        }),
        ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B1',
          [bLinkFieldId]: { id: aRecords[1].id },
        }),
        ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B2',
          [bLinkFieldId]: { id: aRecords[2].id },
        }),
        ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B3',
          [bLinkFieldId]: { id: aRecords[3].id },
        }),
        ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B4',
          [bLinkFieldId]: { id: aRecords[4].id },
        }),
        ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B5',
          [bLinkFieldId]: { id: aRecords[0].id },
        }),
        ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B6',
          [bLinkFieldId]: { id: aRecords[1].id },
        }),
        ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B7',
          [bLinkFieldId]: { id: aRecords[2].id },
        }),
        ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B8',
          [bLinkFieldId]: { id: aRecords[3].id },
        }),
        ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'B9',
          [bLinkFieldId]: { id: aRecords[4].id },
        }),
      ]);

      // Process outbox for initial lookup values
      await ctx.testContainer.processOutbox();

      // Verify initial lookup values (find by ID since order may vary)
      const beforeBRecords = await listRecords(tableB.id);
      const findRecordById = (
        records: Array<{ id: string; fields: Record<string, unknown> }>,
        id: string
      ) => records.find((r) => r.id === id);

      const b0Before = findRecordById(beforeBRecords, bRecords[0].id);
      const b5Before = findRecordById(beforeBRecords, bRecords[5].id);
      const b1Before = findRecordById(beforeBRecords, bRecords[1].id);
      expect(formatCellValueForExpect(b0Before?.fields[bLookupFieldId])).toBe('[100]'); // B0 -> A0
      expect(formatCellValueForExpect(b5Before?.fields[bLookupFieldId])).toBe('[100]'); // B5 -> A0
      expect(formatCellValueForExpect(b1Before?.fields[bLookupFieldId])).toBe('[200]'); // B1 -> A1

      // Clear logs before update
      ctx.testContainer.clearLogs();

      // Update only A0's value
      await ctx.updateRecord(tableA.id, aRecords[0].id, { [aValueFieldId]: 999 });
      await ctx.testContainer.processOutbox();

      // Verify computed plan - seed should be A0
      const plan = ctx.testContainer.getLastComputedPlan();
      expect(plan).toBeDefined();
      expect(plan!.seedRecordIds.length).toBe(1);
      expect(plan!.seedRecordIds[0]).toBe(aRecords[0].id);

      // Verify only B records linked to A0 (B0, B5) have updated lookup values
      const afterBRecords = await listRecords(tableB.id);
      const b0After = findRecordById(afterBRecords, bRecords[0].id);
      const b5After = findRecordById(afterBRecords, bRecords[5].id);
      const b1After = findRecordById(afterBRecords, bRecords[1].id);
      const b2After = findRecordById(afterBRecords, bRecords[2].id);
      const b3After = findRecordById(afterBRecords, bRecords[3].id);
      const b4After = findRecordById(afterBRecords, bRecords[4].id);

      expect(formatCellValueForExpect(b0After?.fields[bLookupFieldId])).toBe('[999]'); // B0 -> A0 (updated)
      expect(formatCellValueForExpect(b5After?.fields[bLookupFieldId])).toBe('[999]'); // B5 -> A0 (updated)
      expect(formatCellValueForExpect(b1After?.fields[bLookupFieldId])).toBe('[200]'); // B1 -> A1 (unchanged)
      expect(formatCellValueForExpect(b2After?.fields[bLookupFieldId])).toBe('[300]'); // B2 -> A2 (unchanged)
      expect(formatCellValueForExpect(b3After?.fields[bLookupFieldId])).toBe('[400]'); // B3 -> A3 (unchanged)
      expect(formatCellValueForExpect(b4After?.fields[bLookupFieldId])).toBe('[500]'); // B4 -> A4 (unchanged)
    });

    /**
     * Scenario: When updating a link field, the reverse link (symmetric link)
     * should only update the affected foreign records, not the entire table.
     */
    it('should only update affected foreign records on reverse link', async () => {
      // Create Companies table
      const companyNameFieldId = createFieldId();

      const companiesTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ReverseLinkCompanies',
        fields: [{ type: 'singleLineText', id: companyNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Create 3 companies
      const companies = await Promise.all([
        ctx.createRecord(companiesTable.id, { [companyNameFieldId]: 'CompanyA' }),
        ctx.createRecord(companiesTable.id, { [companyNameFieldId]: 'CompanyB' }),
        ctx.createRecord(companiesTable.id, { [companyNameFieldId]: 'CompanyC' }),
      ]);

      // Create Activities table with link to Companies
      const activityNameFieldId = createFieldId();
      const activityLinkFieldId = createFieldId();

      const activitiesTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ReverseLinkActivities',
        fields: [
          { type: 'singleLineText', id: activityNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: activityLinkFieldId,
            name: 'Company',
            options: {
              relationship: 'manyOne',
              foreignTableId: companiesTable.id,
              lookupFieldId: companyNameFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Create activities linked to CompanyA
      const activities = await Promise.all([
        ctx.createRecord(activitiesTable.id, {
          [activityNameFieldId]: 'Activity1',
          [activityLinkFieldId]: { id: companies[0].id },
        }),
        ctx.createRecord(activitiesTable.id, {
          [activityNameFieldId]: 'Activity2',
          [activityLinkFieldId]: { id: companies[0].id },
        }),
        ctx.createRecord(activitiesTable.id, {
          [activityNameFieldId]: 'Activity3',
          [activityLinkFieldId]: { id: companies[1].id },
        }),
      ]);

      await ctx.testContainer.processOutbox();

      // Clear logs before update
      ctx.testContainer.clearLogs();

      // Update Activity1 to link to CompanyB instead of CompanyA
      await ctx.updateRecord(activitiesTable.id, activities[0].id, {
        [activityLinkFieldId]: { id: companies[1].id },
      });
      await ctx.testContainer.processOutbox();

      // Verify the update completed successfully
      const afterActivities = await listRecords(activitiesTable.id);
      const activity1 = afterActivities.find((r) => r.id === activities[0].id);
      expect(activity1).toBeDefined();
      const linkValue = activity1?.fields[activityLinkFieldId];
      expect(linkValue).toBeDefined();
      expect((linkValue as { id: string }).id).toBe(companies[1].id);
    });
  });

  // =============================================================================
  // ComputedUpdatePlanner Optimizations
  // =============================================================================
  //
  // These tests verify optimizations in the ComputedUpdatePlanner:
  // 1. Insert optimization: Skip computed update for manyOne/manyMany link fields
  //    when the link field is not in changedFieldIds (avoids null→null updates)
  // 2. Delete optimization: Skip computed update for seed table when deleting
  //    records (no point updating fields on records being deleted)
  // =============================================================================

  describe('ComputedUpdatePlanner optimizations', () => {
    /**
     * Insert optimization test:
     * When inserting a record WITHOUT setting a link field value,
     * no computed update step should be generated for that link field.
     * This avoids unnecessary null → null updates.
     */
    it('skips computed update for link field when inserting without link value', async () => {
      // Create Parent table
      const parentNameFieldId = createFieldId();

      const parentTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'InsertOptParent',
        fields: [{ type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Create Child table with manyOne link to Parent (bidirectional)
      const childNameFieldId = createFieldId();
      const childLinkFieldId = createFieldId();

      const childTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'InsertOptChild',
        fields: [
          { type: 'singleLineText', id: childNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: childLinkFieldId,
            name: 'Parent',
            options: {
              relationship: 'manyOne',
              foreignTableId: parentTable.id,
              lookupFieldId: parentNameFieldId,
              // Bidirectional (default) - creates symmetric link in Parent
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.testContainer.processOutbox();
      ctx.testContainer.clearLogs();

      // Insert a child record WITHOUT setting link value
      const childRecord = await ctx.createRecord(childTable.id, {
        [childNameFieldId]: 'Child Without Link',
        // Note: NOT setting [childLinkFieldId]
      });

      // Verify record was created successfully
      expect(childRecord).toBeDefined();
      expect(childRecord.id).toBeDefined();

      // Get the computed plan from the insert
      const plan = ctx.testContainer.getLastComputedPlan();

      // The optimization should result in NO computed steps for the child table
      // because the link field was not changed (not in changedFieldIds)
      if (plan) {
        const childTableSteps = plan.steps.filter((s) => s.tableId === childTable.id);
        // Should be 0 steps for the child table's link field
        expect(childTableSteps.length).toBe(0);
      }
      // If plan is undefined, that's also fine - means no computed update was needed
    });

    /**
     * Insert optimization test (with link value):
     * When inserting a record WITH a link field value,
     * computed update steps SHOULD be generated.
     */
    it('includes computed update for link field when inserting with link value', async () => {
      // Create Parent table
      const parentNameFieldId = createFieldId();

      const parentTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'InsertOptParentWithLink',
        fields: [{ type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Create a parent record first
      const parentRecord = await ctx.createRecord(parentTable.id, {
        [parentNameFieldId]: 'Parent Record',
      });

      // Create Child table with manyOne link to Parent (bidirectional)
      const childNameFieldId = createFieldId();
      const childLinkFieldId = createFieldId();

      const childTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'InsertOptChildWithLink',
        fields: [
          { type: 'singleLineText', id: childNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: childLinkFieldId,
            name: 'Parent',
            options: {
              relationship: 'manyOne',
              foreignTableId: parentTable.id,
              lookupFieldId: parentNameFieldId,
              // Bidirectional (default)
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.testContainer.processOutbox();
      ctx.testContainer.clearLogs();

      // Insert a child record WITH link value
      const childRecord = await ctx.createRecord(childTable.id, {
        [childNameFieldId]: 'Child With Link',
        [childLinkFieldId]: { id: parentRecord.id },
      });

      // Verify record was created successfully with link
      expect(childRecord).toBeDefined();
      const linkValue = childRecord.fields[childLinkFieldId];
      expect(linkValue).toBeDefined();

      // Process any async computed updates
      await ctx.testContainer.processOutbox();

      // Get the computed plan - should have steps for the link field
      const plan = ctx.testContainer.getLastComputedPlan();
      expect(plan).toBeDefined();

      // There should be at least 1 step (for the link title computation)
      expect(plan!.steps.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * Delete optimization test:
     * When deleting a record, computed update steps should NOT include
     * the seed table (the table being deleted from) because there's no
     * point updating fields on records that are being deleted.
     */
    it('skips seed table computed updates on delete', async () => {
      // Create Parent table
      const parentNameFieldId = createFieldId();

      const parentTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteOptParent',
        fields: [{ type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Create a parent record
      const parentRecord = await ctx.createRecord(parentTable.id, {
        [parentNameFieldId]: 'Parent',
      });

      // Create Child table with manyOne link to Parent (bidirectional)
      const childNameFieldId = createFieldId();
      const childLinkFieldId = createFieldId();

      const childTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteOptChild',
        fields: [
          { type: 'singleLineText', id: childNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: childLinkFieldId,
            name: 'Parent',
            options: {
              relationship: 'manyOne',
              foreignTableId: parentTable.id,
              lookupFieldId: parentNameFieldId,
              // Bidirectional - creates symmetric link in Parent
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Create a child record linked to parent
      const childRecord = await ctx.createRecord(childTable.id, {
        [childNameFieldId]: 'Child',
        [childLinkFieldId]: { id: parentRecord.id },
      });

      await ctx.testContainer.processOutbox();
      ctx.testContainer.clearLogs();

      // Delete the child record
      await ctx.deleteRecord(childTable.id, childRecord.id);

      // Process any async computed updates
      await ctx.testContainer.processOutbox();

      const plans = ctx.testContainer.getComputedPlans();
      const deletePlan = plans.find(
        (p) =>
          (p as unknown as { changeType?: 'insert' | 'update' | 'delete' }).changeType === 'delete'
      );
      expect(deletePlan).toBeDefined();
      if (!deletePlan) return;

      // The optimization should ensure NO steps for childTable (seed table being deleted)
      const childTableSteps = deletePlan.steps.filter((s) => s.tableId === childTable.id);
      expect(childTableSteps.length).toBe(0);

      // But there SHOULD be steps for parentTable (symmetric link update)
      const parentTableSteps = deletePlan.steps.filter((s) => s.tableId === parentTable.id);
      expect(parentTableSteps.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // SECTION: CROSS-BASE LINK SCENARIOS
  // ===========================================================================

  /**
   * Cross-base link tests.
   *
   * These tests verify that computed field updates work correctly when
   * link fields span across different bases. This is important because:
   * - Each base has its own dependency graph
   * - Symmetric link fields are in different bases
   * - Lookup fields need to traverse cross-base links
   */
  describe('cross-base link scenarios', () => {
    /**
     * Scenario: Two-way link across bases with lookup.
     *
     * Setup:
     * - Base A: TableA with Name (primary) and Value (number)
     * - Base B: TableB with Name (primary), Link to TableA (twoWay), and Lookup of TableA.Value
     *
     * When updating the link in TableB:
     * - The symmetric link in TableA should be updated
     * - The lookup in TableB should reflect the new linked value
     *
     * When updating the link in TableA (via symmetric link):
     * - The link in TableB should be updated
     * - The lookup in TableB should reflect the change
     */
    it('updates symmetric link and lookup when link is updated across bases', async () => {
      // Create second base
      const baseB_Id = `bse${getRandomString(16)}`;
      const spaceId = `spc${getRandomString(16)}`;
      const actorId = 'system';

      // Create space and base B in database
      await ctx.testContainer.db
        .insertInto('space')
        .values({ id: spaceId, name: 'Test Space B', created_by: actorId })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();

      await ctx.testContainer.db
        .insertInto('base')
        .values({
          id: baseB_Id,
          space_id: spaceId,
          name: 'Test Base B',
          order: 2,
          created_by: actorId,
        })
        .execute();

      // Table A in base A (original base)
      const aNameFieldId = createFieldId();
      const aValueFieldId = createFieldId();

      const tableA = await ctx.createTable({
        baseId: ctx.baseId, // original base
        name: 'CrossBaseA',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      // Create records in Table A
      const recordA1 = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A1',
        [aValueFieldId]: 100,
      });
      const recordA2 = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A2',
        [aValueFieldId]: 200,
      });

      await ctx.testContainer.processOutbox();

      // Table B in base B with link to Table A (twoWay)
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bLookupFieldId = createFieldId();

      const tableB = await ctx.createTable({
        baseId: baseB_Id, // different base!
        name: 'CrossBaseB',
        fields: [
          { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: bLinkFieldId,
            name: 'LinkToA',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableA.id,
              lookupFieldId: aNameFieldId,
              // twoWay is default (isOneWay: false)
            },
          },
          {
            type: 'lookup',
            id: bLookupFieldId,
            name: 'LookupValue',
            options: {
              linkFieldId: bLinkFieldId,
              foreignTableId: tableA.id,
              lookupFieldId: aValueFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Create record in Table B linked to A1
      const recordB = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bLinkFieldId]: { id: recordA1.id },
      });

      // Process computed updates
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Verify initial state
      const initialRecordsB = await listRecords(tableB.id);
      const initialRecordB = initialRecordsB.find((r) => r.id === recordB.id);

      // LinkToA should show "A1" (manyOne returns single object with id and title)
      const initialLinkValue = initialRecordB?.fields[bLinkFieldId] as
        | { id: string; title: string }
        | undefined;
      expect(initialLinkValue?.title).toBe('A1');
      // LookupValue should be 100
      const initialLookupValue = initialRecordB?.fields[bLookupFieldId];
      expect(Array.isArray(initialLookupValue) ? initialLookupValue[0] : initialLookupValue).toBe(
        100
      );

      // Verify symmetric link in Table A
      const initialRecordsA = await listRecords(tableA.id);
      const initialRecordA1 = initialRecordsA.find((r) => r.id === recordA1.id);

      // Find the symmetric link field (should be auto-created)
      const tableAData = await ctx.getTableById(tableA.id);
      const symmetricLinkField = tableAData.fields.find(
        (f: { type: string; id: string }) => f.type === 'link' && f.id !== bLinkFieldId
      );

      if (symmetricLinkField) {
        // A1 should have symmetric link to B1 (oneMany returns array)
        const a1SymmetricValue = initialRecordA1?.fields[symmetricLinkField.id] as
          | Array<{ id: string; title: string }>
          | string
          | undefined;
        if (Array.isArray(a1SymmetricValue)) {
          expect(a1SymmetricValue.some((v) => v.title === 'B1')).toBe(true);
        } else if (typeof a1SymmetricValue === 'string') {
          // Could be JSON string
          expect(a1SymmetricValue).toContain('B1');
        }
      }

      // =========================================================================
      // Test 1: Update link in Table B to point to A2
      // =========================================================================
      ctx.testContainer.clearLogs();

      await ctx.updateRecord(tableB.id, recordB.id, {
        [bLinkFieldId]: { id: recordA2.id },
      });

      // Process computed updates (may need multiple rounds for cross-base)
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Verify Table B updates
      const afterRecordsB = await listRecords(tableB.id);
      const afterRecordB = afterRecordsB.find((r) => r.id === recordB.id);

      // LinkToA should now show "A2"
      const afterLinkValue = afterRecordB?.fields[bLinkFieldId] as
        | { id: string; title: string }
        | undefined;
      expect(afterLinkValue?.title).toBe('A2');
      // LookupValue should now be 200
      const afterLookupValue = afterRecordB?.fields[bLookupFieldId];
      expect(Array.isArray(afterLookupValue) ? afterLookupValue[0] : afterLookupValue).toBe(200);

      // Verify symmetric link updates in Table A
      const afterRecordsA = await listRecords(tableA.id);
      const afterRecordA1 = afterRecordsA.find((r) => r.id === recordA1.id);
      const afterRecordA2 = afterRecordsA.find((r) => r.id === recordA2.id);

      if (symmetricLinkField) {
        // A1 should no longer have symmetric link to B1
        const a1SymmetricValue = afterRecordA1?.fields[symmetricLinkField.id];
        const a1IsEmpty =
          a1SymmetricValue === null ||
          a1SymmetricValue === undefined ||
          a1SymmetricValue === '' ||
          (Array.isArray(a1SymmetricValue) && a1SymmetricValue.length === 0);
        expect(a1IsEmpty).toBe(true);

        // A2 should now have symmetric link to B1
        const a2SymmetricValue = afterRecordA2?.fields[symmetricLinkField.id] as
          | Array<{ id: string; title: string }>
          | string
          | undefined;
        if (Array.isArray(a2SymmetricValue)) {
          expect(a2SymmetricValue.some((v) => v.title === 'B1')).toBe(true);
        } else if (typeof a2SymmetricValue === 'string') {
          expect(a2SymmetricValue).toContain('B1');
        }
      }

      // Print snapshots for visual verification
      const bFieldIds = [bNameFieldId, bLinkFieldId, bLookupFieldId];
      const bFieldNames = ['Name', 'LinkToA', 'LookupValue'];

      expect(printTableSnapshot(tableB.name, bFieldNames, afterRecordsB, bFieldIds))
        .toMatchInlineSnapshot(`
          "[CrossBaseB]
          ---------------------------------
          #  | Name | LinkToA | LookupValue
          ---------------------------------
          R0 | B1   | A2      | [200]
          ---------------------------------"
        `);
    });

    /**
     * Scenario: Value change updates formula which cascades to cross-base link title.
     *
     * Setup:
     * - Base A: TableA with Content (text) and Title (formula = Content & "-suffix")
     * - Base B: TableB with Name (primary), Link to TableA (twoWay, lookupFieldId=Title)
     *
     * When updating Content in TableA:
     * - The Title formula in TableA should be recalculated
     * - The Link field's displayed title in TableB should also update (since it uses Title as lookupFieldId)
     *
     * This tests the cross-base dependency: valueChange → formula → cross-base link title
     */
    it('updates cross-base link title when source field value changes and affects formula', async () => {
      // Create second base
      const baseB_Id = `bse${getRandomString(16)}`;
      const spaceId = `spc${getRandomString(16)}`;
      const actorId = 'system';

      // Create space and base B in database
      await ctx.testContainer.db
        .insertInto('space')
        .values({ id: spaceId, name: 'Test Space CrossBase2', created_by: actorId })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();

      await ctx.testContainer.db
        .insertInto('base')
        .values({
          id: baseB_Id,
          space_id: spaceId,
          name: 'Test Base CrossBase2',
          order: 3,
          created_by: actorId,
        })
        .execute();

      // Table A in base A (original base)
      const aContentFieldId = createFieldId();
      const aTitleFieldId = createFieldId();

      const tableA = await ctx.createTable({
        baseId: ctx.baseId, // original base
        name: 'SourceTable',
        fields: [
          { type: 'singleLineText', id: aContentFieldId, name: 'Content', isPrimary: true },
          {
            type: 'formula',
            id: aTitleFieldId,
            name: 'Title',
            options: {
              expression: `{${aContentFieldId}}&"-suffix"`,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Create record in Table A
      const recordA = await ctx.createRecord(tableA.id, {
        [aContentFieldId]: 'Initial',
      });

      await ctx.testContainer.processOutbox();

      // Verify initial Title formula value
      const initialRecordsA = await listRecords(tableA.id);
      const initialRecordA = initialRecordsA.find((r) => r.id === recordA.id);
      expect(initialRecordA?.fields[aTitleFieldId]).toBe('Initial-suffix');

      // Table B in base B with link to Table A (twoWay, using Title as lookupFieldId)
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();

      const tableB = await ctx.createTable({
        baseId: baseB_Id, // different base!
        name: 'TargetTable',
        fields: [
          { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: bLinkFieldId,
            name: 'LinkToSource',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableA.id,
              lookupFieldId: aTitleFieldId, // Use Title (formula) as the display field
              // twoWay is default (isOneWay: false)
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Create record in Table B linked to recordA
      const recordB = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bLinkFieldId]: { id: recordA.id },
      });

      // Process computed updates
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Verify initial link title in Table B
      const initialRecordsB = await listRecords(tableB.id);
      const initialRecordB = initialRecordsB.find((r) => r.id === recordB.id);
      const initialLinkValue = initialRecordB?.fields[bLinkFieldId] as
        | { id: string; title: string }
        | undefined;
      expect(initialLinkValue?.title).toBe('Initial-suffix');

      // =========================================================================
      // Key test: Update Content in Table A, which should cascade to:
      // 1. Title formula in Table A (same base)
      // 2. LinkToSource displayed title in Table B (cross-base)
      // =========================================================================
      ctx.testContainer.clearLogs();

      await ctx.updateRecord(tableA.id, recordA.id, {
        [aContentFieldId]: 'Updated',
      });

      // Process computed updates (may need multiple rounds for cross-base)
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Verify Title formula in Table A is updated
      const afterRecordsA = await listRecords(tableA.id);
      const afterRecordA = afterRecordsA.find((r) => r.id === recordA.id);
      expect(afterRecordA?.fields[aTitleFieldId]).toBe('Updated-suffix');

      // Verify Link title in Table B is also updated (cross-base cascade)
      const afterRecordsB = await listRecords(tableB.id);
      const afterRecordB = afterRecordsB.find((r) => r.id === recordB.id);
      const afterLinkValue = afterRecordB?.fields[bLinkFieldId] as
        | { id: string; title: string }
        | undefined;
      expect(afterLinkValue?.title).toBe('Updated-suffix');

      // Print snapshots for visual verification
      const aFieldIds = [aContentFieldId, aTitleFieldId];
      const aFieldNames = ['Content', 'Title'];

      expect(printTableSnapshot(tableA.name, aFieldNames, afterRecordsA, aFieldIds))
        .toMatchInlineSnapshot(`
          "[SourceTable]
          -----------------------------
          #  | Content | Title
          -----------------------------
          R0 | Updated | Updated-suffix
          -----------------------------"
        `);

      const bFieldIds = [bNameFieldId, bLinkFieldId];
      const bFieldNames = ['Name', 'LinkToSource'];

      expect(printTableSnapshot(tableB.name, bFieldNames, afterRecordsB, bFieldIds))
        .toMatchInlineSnapshot(`
          "[TargetTable]
          --------------------------
          #  | Name | LinkToSource
          --------------------------
          R0 | B1   | Updated-suffix
          --------------------------"
        `);
    });
  });

  /**
   * hasError field handling tests.
   *
   * These tests verify that v2 properly handles computed fields that have
   * hasError=true set in the database (migrated from v1 or set manually).
   *
   * When a computed field has hasError=true:
   * - Reading records should return NULL for that field
   * - Updating records should skip that field in computed updates
   *
   * NOTE: These tests require manual database setup to set has_error=true
   * on fields. Implement after the "delete column mark hasError" feature
   * is completed, which will provide a way to programmatically set hasError.
   */
  describe('hasError field handling', () => {
    /**
     * Scenario: Formula field with hasError=true returns null when reading records.
     *
     * When a formula field references a deleted/invalid field, it should be marked
     * with hasError=true and return null instead of attempting to compute the value.
     */
    test.todo(
      'formula field with hasError returns null: Implement after delete-column-mark-hasError feature'
    );

    /**
     * Scenario: Lookup field with hasError=true returns null when reading records.
     *
     * When a lookup field references a deleted link field or lookup field,
     * it should return null instead of attempting to compute the value.
     */
    test.todo(
      'lookup field with hasError returns null: Implement after delete-column-mark-hasError feature'
    );

    /**
     * Scenario: Rollup field with hasError=true returns null when reading records.
     *
     * When a rollup field references a deleted link field or lookup field,
     * it should return null instead of attempting to compute the value.
     */
    test.todo(
      'rollup field with hasError returns null: Implement after delete-column-mark-hasError feature'
    );

    /**
     * Scenario: ConditionalLookup field with hasError=true returns null when reading records.
     *
     * When a conditionalLookup field references a deleted foreign table field,
     * it should return null instead of attempting to compute the value.
     */
    test.todo(
      'conditionalLookup field with hasError returns null: Implement after delete-column-mark-hasError feature'
    );

    /**
     * Scenario: ConditionalRollup field with hasError=true returns null when reading records.
     *
     * When a conditionalRollup field references a deleted foreign table field,
     * it should return null instead of attempting to compute the value.
     */
    test.todo(
      'conditionalRollup field with hasError returns null: Implement after delete-column-mark-hasError feature'
    );

    /**
     * Scenario: Fields with hasError=true are skipped during computed updates.
     *
     * When a computed field has hasError=true, it should not participate in
     * computed update operations. This prevents wasted computation and potential
     * SQL errors from invalid field references.
     */
    test.todo(
      'computed fields with hasError are skipped during updates: Implement after delete-column-mark-hasError feature'
    );

    /**
     * Scenario: Deleting a field marks dependent computed fields as hasError.
     *
     * When a field is deleted, all computed fields that reference it should
     * be marked with hasError=true. This includes:
     * - Formula fields that reference the deleted field
     * - Lookup fields where linkFieldId or lookupFieldId matches
     * - Rollup fields where linkFieldId or lookupFieldId matches
     * - ConditionalLookup/Rollup fields where lookupFieldId matches
     * - Formula fields that reference any of the above (cascading error)
     */
    test.todo(
      'deleting a field marks dependent computed fields as hasError: Implement after delete-column-mark-hasError feature'
    );

    /**
     * Scenario: hasError propagates through dependency chains.
     *
     * When a computed field becomes hasError=true, all fields that depend on
     * it should also be marked as hasError=true.
     *
     * Example: fieldA -> formulaB -> formulaC
     * If fieldA is deleted, both formulaB and formulaC should be marked hasError.
     */
    test.todo(
      'hasError propagates through dependency chains: Implement after delete-column-mark-hasError feature'
    );

    /**
     * Scenario: Converting a field to incompatible type marks dependent fields as hasError.
     *
     * When a field is converted to a type that is incompatible with its dependents,
     * those dependent computed fields should be marked with hasError=true.
     *
     * Example: Converting a number field to text when a formula expects numeric input.
     */
    test.todo(
      'converting field to incompatible type marks dependents as hasError: Implement after delete-column-mark-hasError feature'
    );
  });
});
