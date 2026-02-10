/**
 * Formula Field Matrix Tests
 *
 * Tests formula field updates with various:
 * - Source field types (number, text, checkbox, rating)
 * - Value transitions (nullToValue, valueToValue, valueToNull)
 * - Chain depths (1, 2, 3)
 *
 * Total: ~36 test cases
 */

import {
  buildNameMaps,
  printComputedSteps,
  type ComputedPlanLogEntry,
  type ComputedPlanSnapshotOptions,
} from '@teable/v2-container-node-test';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  createTestContext,
  createFieldIdGenerator,
  getFieldValues,
  getFormulaExpression,
  getExpectedResult,
  getExpectedSteps,
  verifyResult,
  verifySteps,
} from './shared';
import type { TestContext, SourceFieldType, ValueTransition, FormulaTestCase } from './shared';

// =============================================================================
// Test Configuration
// =============================================================================

const SOURCE_TYPES: SourceFieldType[] = ['number', 'singleLineText', 'checkbox', 'rating'];
const TRANSITIONS: ValueTransition[] = ['nullToValue', 'valueToValue', 'valueToNull'];
const DEPTHS = [1, 2, 3] as const;

// Generate test cases
const generateFormulaCases = (): FormulaTestCase[] =>
  SOURCE_TYPES.flatMap((source) =>
    TRANSITIONS.flatMap((transition) =>
      DEPTHS.map((depth) => ({
        source,
        transition,
        depth,
      }))
    )
  );

const FORMULA_CASES = generateFormulaCases();

// =============================================================================
// Test Suite
// =============================================================================

describe('formula field matrix (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  }, 120_000);

  // No afterAll dispose needed - handled by vitest.setup.ts

  beforeEach(() => {
    ctx.clearLogs();
  });

  // ===========================================================================
  // Formula Matrix Tests
  // ===========================================================================

  describe('source type × transition × depth', () => {
    test.each(FORMULA_CASES)(
      'formula: $source $transition depth=$depth',
      async ({ source, transition, depth }) => {
        const createFieldId = createFieldIdGenerator();
        const { initial, updated } = getFieldValues(source, transition);

        // Build fields
        const nameFieldId = createFieldId();
        const sourceFieldId = createFieldId();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fields: any[] = [
          { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
          { type: source, id: sourceFieldId, name: 'Source' },
        ];

        // Add formula chain
        const formulaIds: string[] = [];
        let prevFieldId = sourceFieldId;
        for (let i = 0; i < depth; i++) {
          const formulaId = createFieldId();
          formulaIds.push(formulaId);
          fields.push({
            type: 'formula',
            id: formulaId,
            name: `Formula${i + 1}`,
            options: {
              expression:
                i === 0 ? getFormulaExpression(sourceFieldId, source) : `{${prevFieldId}} + 10`,
            },
          });
          prevFieldId = formulaId;
        }

        // Create table
        const tableName = `Formula_${source}_${transition}_d${depth}`;
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: tableName,
          fields,
          views: [{ type: 'grid' }],
        });

        // Create initial record
        const recordData: Record<string, unknown> = {
          [nameFieldId]: 'Test',
        };
        if (initial !== null) {
          recordData[sourceFieldId] = initial;
        }

        await ctx.createRecord(table.id, recordData);
        const beforeRecords = await ctx.listRecords(table.id);
        const record = beforeRecords[0];
        const lastFormulaId = formulaIds[formulaIds.length - 1];
        const beforeValue = record.fields[lastFormulaId];

        // Clear logs before update
        ctx.clearLogs();

        // Update record
        await ctx.updateRecord(table.id, record.id, { [sourceFieldId]: updated });
        await ctx.drainOutbox();

        // Get results
        const afterRecords = await ctx.listRecords(table.id);
        const afterValue = afterRecords[0].fields[lastFormulaId];

        // Verify result
        const expected = getExpectedResult(source, 'formula', transition, initial, updated, depth);
        verifyResult(beforeValue, afterValue, expected);

        // Verify steps
        const plan = ctx.getLastComputedPlan() as {
          steps: Array<{ tableId: string; fieldIds: string[]; level: number }>;
        };
        const expectedSteps = getExpectedSteps('formula', depth);
        verifySteps(plan, expectedSteps, lastFormulaId);

        // For valueToValue, also verify all formula fields are in steps
        if (transition === 'valueToValue') {
          const allFieldIds = plan.steps.flatMap((s) => s.fieldIds);
          for (const fid of formulaIds) {
            expect(allFieldIds).toContain(fid);
          }
        }
      }
    );
  });

  // ===========================================================================
  // Detailed Snapshot Tests (for key scenarios)
  // ===========================================================================

  describe('snapshot tests', () => {
    test('formula: number valueToValue depth=1 - detailed', async () => {
      const createFieldId = createFieldIdGenerator();

      const nameFieldId = createFieldId();
      const valueFieldId = createFieldId();
      const doubledFieldId = createFieldId();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'FormulaSnapshot_number_d1',
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

      // Create record with initial value
      await ctx.createRecord(table.id, { [nameFieldId]: 'Test', [valueFieldId]: 5 });
      const beforeRecords = await ctx.listRecords(table.id);

      expect(beforeRecords[0].fields[doubledFieldId]).toBe(10);

      // Clear and update
      ctx.clearLogs();
      const record = beforeRecords[0];
      await ctx.updateRecord(table.id, record.id, { [valueFieldId]: 15 });
      await ctx.drainOutbox();

      // Verify
      const afterRecords = await ctx.listRecords(table.id);
      expect(afterRecords[0].fields[doubledFieldId]).toBe(30);

      // Verify steps
      const plan = ctx.getLastComputedPlan() as {
        steps: Array<{ tableId: string; fieldIds: string[]; level: number }>;
      };
      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].fieldIds).toContain(doubledFieldId);

      // Snapshot
      const nameMaps: ComputedPlanSnapshotOptions = buildNameMaps(
        { id: table.id, name: 'FormulaSnapshot_number_d1' },
        [
          { id: nameFieldId, name: 'Name' },
          { id: valueFieldId, name: 'Value' },
          { id: doubledFieldId, name: 'Doubled' },
        ]
      );
      expect(printComputedSteps(plan as ComputedPlanLogEntry, nameMaps)).toMatchInlineSnapshot(`
        "[Computed Steps: 1]
          L0: FormulaSnapshot_number_d1 -> [Doubled]"
      `);
    });

    test('formula: number valueToValue depth=3 - detailed', async () => {
      const createFieldId = createFieldIdGenerator();

      const nameFieldId = createFieldId();
      const numFieldId = createFieldId();
      const f1FieldId = createFieldId();
      const f2FieldId = createFieldId();
      const f3FieldId = createFieldId();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'FormulaSnapshot_number_d3',
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
            options: { expression: `{${f2FieldId}} + 10` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Create record
      await ctx.createRecord(table.id, { [nameFieldId]: 'Test', [numFieldId]: 5 });
      const beforeRecords = await ctx.listRecords(table.id);

      // 5 * 2 = 10, 10 + 10 = 20, 20 + 10 = 30
      expect(beforeRecords[0].fields[f1FieldId]).toBe(10);
      expect(beforeRecords[0].fields[f2FieldId]).toBe(20);
      expect(beforeRecords[0].fields[f3FieldId]).toBe(30);

      // Clear and update
      ctx.clearLogs();
      const record = beforeRecords[0];
      await ctx.updateRecord(table.id, record.id, { [numFieldId]: 10 });
      await ctx.drainOutbox();

      // Verify: 10 * 2 = 20, 20 + 10 = 30, 30 + 10 = 40
      const afterRecords = await ctx.listRecords(table.id);
      expect(afterRecords[0].fields[f1FieldId]).toBe(20);
      expect(afterRecords[0].fields[f2FieldId]).toBe(30);
      expect(afterRecords[0].fields[f3FieldId]).toBe(40);

      // Verify steps - should be batched into 1 step (CTE optimization)
      const plan = ctx.getLastComputedPlan() as {
        steps: Array<{ tableId: string; fieldIds: string[]; level: number }>;
      };
      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].fieldIds).toEqual([f1FieldId, f2FieldId, f3FieldId]);

      // Snapshot
      const nameMaps: ComputedPlanSnapshotOptions = buildNameMaps(
        { id: table.id, name: 'FormulaSnapshot_number_d3' },
        [
          { id: nameFieldId, name: 'Name' },
          { id: numFieldId, name: 'Num' },
          { id: f1FieldId, name: 'F1' },
          { id: f2FieldId, name: 'F2' },
          { id: f3FieldId, name: 'F3' },
        ]
      );
      expect(printComputedSteps(plan as ComputedPlanLogEntry, nameMaps)).toMatchInlineSnapshot(`
        "[Computed Steps: 1]
          L0: FormulaSnapshot_number_d3 -> [F1, F2, F3]"
      `);
    });

    test('formula: checkbox valueToValue depth=1 - detailed', async () => {
      const createFieldId = createFieldIdGenerator();

      const nameFieldId = createFieldId();
      const checkFieldId = createFieldId();
      const labelFieldId = createFieldId();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'FormulaSnapshot_checkbox_d1',
        fields: [
          { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
          { type: 'checkbox', id: checkFieldId, name: 'Check' },
          {
            type: 'formula',
            id: labelFieldId,
            name: 'Label',
            options: { expression: `IF({${checkFieldId}}, "Yes", "No")` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Create record with true
      await ctx.createRecord(table.id, { [nameFieldId]: 'Test', [checkFieldId]: true });
      const beforeRecords = await ctx.listRecords(table.id);

      expect(beforeRecords[0].fields[labelFieldId]).toBe('Yes');

      // Clear and update to false
      ctx.clearLogs();
      const record = beforeRecords[0];
      await ctx.updateRecord(table.id, record.id, { [checkFieldId]: false });
      await ctx.drainOutbox();

      // Verify
      const afterRecords = await ctx.listRecords(table.id);
      expect(afterRecords[0].fields[labelFieldId]).toBe('No');

      // Verify steps
      const plan = ctx.getLastComputedPlan() as {
        steps: Array<{ tableId: string; fieldIds: string[]; level: number }>;
      };
      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].fieldIds).toContain(labelFieldId);
    });
  });
});
