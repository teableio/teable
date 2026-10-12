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

import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  createTestContext,
  createFieldIdGenerator,
  getFieldValues,
  getFormulaExpression,
  getExpectedFormulaValues,
} from './shared';
import type { TestContext, FormulaTestCase } from './shared';

// =============================================================================
// Test Configuration
// =============================================================================

const SOURCE_TYPES: FormulaTestCase['source'][] = [
  'number',
  'singleLineText',
  'checkbox',
  'rating',
];
const TRANSITIONS: FormulaTestCase['transition'][] = ['nullToValue', 'valueToValue', 'valueToNull'];
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

        // Clear logs before update
        ctx.clearLogs();

        // Update record
        await ctx.updateRecord(table.id, record.id, { [sourceFieldId]: updated });
        await ctx.drainOutbox();

        // Get results
        const afterRecords = await ctx.listRecords(table.id);

        const expectedValues = getExpectedFormulaValues(source, transition);
        for (const [level, formulaId] of formulaIds.entries()) {
          expect(afterRecords[0].fields[formulaId]).toBe(expectedValues[level]);
        }
      }
    );
  });

  // ===========================================================================
  // Detailed Value Tests (for key scenarios)
  // ===========================================================================

  describe('detailed value tests', () => {
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
    });
  });
});
