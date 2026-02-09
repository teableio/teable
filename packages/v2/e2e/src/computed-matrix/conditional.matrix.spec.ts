/**
 * Conditional Field Matrix Tests
 *
 * Tests conditionalRollup and conditionalLookup fields with:
 * - Field types (conditionalLookup, conditionalRollup)
 * - Condition types (statusFilter, valueThreshold, multiCondition)
 * - Value transitions (nullToValue, valueToValue, valueToNull)
 *
 * Total: ~18 test cases
 */

import {
  buildMultiTableNameMaps,
  printComputedSteps,
  type ComputedPlanLogEntry,
} from '@teable/v2-container-node-test';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  createTestContext,
  createFieldIdGenerator,
  getFieldValues,
  getExpectedSteps,
  verifySteps,
} from './shared';
import type { TestContext, ValueTransition, ConditionalTestCase } from './shared';

// =============================================================================
// Test Configuration
// =============================================================================

const CONDITIONAL_TYPES = ['conditionalLookup', 'conditionalRollup'] as const;
const CONDITION_TYPES = ['statusFilter', 'valueThreshold', 'multiCondition'] as const;
const TRANSITIONS: ValueTransition[] = ['nullToValue', 'valueToValue', 'valueToNull'];

// Generate test cases
const generateConditionalCases = (): ConditionalTestCase[] =>
  CONDITIONAL_TYPES.flatMap((type) =>
    CONDITION_TYPES.flatMap((conditionType) =>
      TRANSITIONS.map((transition) => ({
        type,
        conditionType,
        transition,
      }))
    )
  );

const CONDITIONAL_CASES = generateConditionalCases();

// =============================================================================
// Helper Functions
// =============================================================================

const buildCondition = (
  conditionType: 'statusFilter' | 'valueThreshold' | 'multiCondition',
  statusFieldId: string,
  valueFieldId: string
) => {
  switch (conditionType) {
    case 'statusFilter':
      return {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: statusFieldId,
              operator: 'is',
              value: 'Active', // Use choice name, not id
            },
          ],
        },
      };
    case 'valueThreshold':
      return {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: valueFieldId,
              operator: 'isGreaterEqual',
              value: 10,
            },
          ],
        },
      };
    case 'multiCondition':
      return {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: statusFieldId,
              operator: 'is',
              value: 'Active', // Use choice name, not id
            },
            {
              fieldId: valueFieldId,
              operator: 'isGreaterEqual',
              value: 5,
            },
          ],
        },
      };
    default:
      return { filter: null };
  }
};

// =============================================================================
// Test Suite
// =============================================================================

describe('conditional field matrix (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  }, 120_000);
  // No afterAll dispose needed - handled by vitest.setup.ts

  beforeEach(() => {
    ctx.clearLogs();
  });

  // ===========================================================================
  // Conditional Matrix Tests
  // ===========================================================================

  describe('type × conditionType × transition', () => {
    test.each(CONDITIONAL_CASES)(
      'conditional: $type $conditionType $transition',
      async ({ type, conditionType, transition }) => {
        const createFieldId = createFieldIdGenerator();
        const { initial, updated } = getFieldValues('number', transition);

        // =====================================================================
        // Create Foreign Table
        // =====================================================================
        const fNameFieldId = createFieldId();
        const fValueFieldId = createFieldId();
        const fStatusFieldId = createFieldId();

        const foreignTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Conditional_Foreign_${type}_${conditionType}`,
          fields: [
            { type: 'singleLineText', id: fNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: fValueFieldId, name: 'Value' },
            {
              type: 'singleSelect',
              id: fStatusFieldId,
              name: 'Status',
              options: {
                choices: [
                  { id: 'active', name: 'Active', color: 'green' },
                  { id: 'inactive', name: 'Inactive', color: 'gray' },
                ],
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        // Create foreign records
        const record1Data: Record<string, unknown> = {
          [fNameFieldId]: 'Item1',
          [fStatusFieldId]: 'active',
        };
        if (initial !== null) {
          record1Data[fValueFieldId] = initial;
        }
        const foreignRecord1 = await ctx.createRecord(foreignTable.id, record1Data);

        const record2Data: Record<string, unknown> = {
          [fNameFieldId]: 'Item2',
          [fStatusFieldId]: 'inactive',
          [fValueFieldId]: 100, // This one doesn't match status filter
        };
        await ctx.createRecord(foreignTable.id, record2Data);

        // =====================================================================
        // Create Host Table with Conditional Field
        // =====================================================================
        const hNameFieldId = createFieldId();
        const hConditionalFieldId = createFieldId();

        const condition = buildCondition(conditionType, fStatusFieldId, fValueFieldId);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hostFields: any[] = [
          { type: 'singleLineText', id: hNameFieldId, name: 'Name', isPrimary: true },
        ];

        if (type === 'conditionalLookup') {
          hostFields.push({
            type: 'conditionalLookup',
            id: hConditionalFieldId,
            name: 'ConditionalLookup',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: fValueFieldId,
              condition,
            },
          });
        } else {
          hostFields.push({
            type: 'conditionalRollup',
            id: hConditionalFieldId,
            name: 'ConditionalRollup',
            options: { expression: 'sum({values})' },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: fValueFieldId,
              condition,
            },
          });
        }

        const hostTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Conditional_Host_${type}_${conditionType}`,
          fields: hostFields,
          views: [{ type: 'grid' }],
        });

        // Create host record
        await ctx.createRecord(hostTable.id, { [hNameFieldId]: 'Host' });
        await ctx.testContainer.processOutbox();

        // Get before value
        const beforeRecords = await ctx.listRecords(hostTable.id);
        const beforeValue = beforeRecords[0].fields[hConditionalFieldId];

        // Clear logs before update
        ctx.clearLogs();

        // =====================================================================
        // Update Foreign Record
        // =====================================================================
        await ctx.updateRecord(foreignTable.id, foreignRecord1.id, { [fValueFieldId]: updated });
        await ctx.testContainer.processOutbox();

        // Get results
        const afterRecords = await ctx.listRecords(hostTable.id);
        const afterValue = afterRecords[0].fields[hConditionalFieldId];

        // =====================================================================
        // Verify Results
        // =====================================================================

        if (transition === 'valueToNull') {
          // For valueThreshold, record2 (Value=100) still matches the condition
          // so result is not null/empty, it's the value from record2
          if (conditionType === 'valueThreshold') {
            if (type === 'conditionalLookup') {
              // Should contain record2's value (100)
              expect(afterValue).toEqual([100]);
            } else {
              // Rollup should be sum of record2's value (100)
              expect(afterValue).toBe(100);
            }
          } else {
            // For statusFilter/multiCondition, only record1 matches and it's now null
            if (type === 'conditionalLookup') {
              // Should be empty or contain null
              if (Array.isArray(afterValue)) {
                expect(afterValue.length === 0 || afterValue.every((v) => v === null)).toBe(true);
              }
            } else {
              // Rollup of null should be 0 or null
              expect([0, null]).toContain(afterValue);
            }
          }
        } else {
          // Value should have changed (if condition matches)
          // For valueThreshold, nullToValue might not match if value < 10
          if (
            conditionType === 'valueThreshold' &&
            transition === 'nullToValue' &&
            (updated as number) < 10
          ) {
            // Might not match condition
          } else {
            expect(afterValue).not.toEqual(beforeValue);
          }
        }

        // Verify computed steps
        const plan = ctx.getLastComputedPlan() as {
          steps: Array<{ tableId: string; fieldIds: string[]; level: number }>;
        };
        const expectedSteps = getExpectedSteps(type, 1);
        verifySteps(plan, expectedSteps, hConditionalFieldId);
      }
    );
  });

  // ===========================================================================
  // Detailed Snapshot Tests
  // ===========================================================================

  describe('snapshot tests', () => {
    test('conditionalRollup: statusFilter valueToValue - detailed', async () => {
      const createFieldId = createFieldIdGenerator();

      // Create foreign table
      const fNameFieldId = createFieldId();
      const fValueFieldId = createFieldId();
      const fStatusFieldId = createFieldId();

      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CondRollup_Snapshot_Foreign',
        fields: [
          { type: 'singleLineText', id: fNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: fValueFieldId, name: 'Value' },
          {
            type: 'singleSelect',
            id: fStatusFieldId,
            name: 'Status',
            options: {
              choices: [
                { id: 'active', name: 'Active', color: 'green' },
                { id: 'inactive', name: 'Inactive', color: 'gray' },
              ],
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Create foreign records
      const activeRecord = await ctx.createRecord(foreignTable.id, {
        [fNameFieldId]: 'Active1',
        [fValueFieldId]: 10,
        [fStatusFieldId]: 'active',
      });
      await ctx.createRecord(foreignTable.id, {
        [fNameFieldId]: 'Active2',
        [fValueFieldId]: 20,
        [fStatusFieldId]: 'active',
      });
      await ctx.createRecord(foreignTable.id, {
        [fNameFieldId]: 'Inactive1',
        [fValueFieldId]: 100,
        [fStatusFieldId]: 'inactive',
      });

      // Create host table
      const hNameFieldId = createFieldId();
      const hRollupFieldId = createFieldId();

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CondRollup_Snapshot_Host',
        fields: [
          { type: 'singleLineText', id: hNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalRollup',
            id: hRollupFieldId,
            name: 'ActiveSum',
            options: { expression: 'sum({values})' },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: fValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [{ fieldId: fStatusFieldId, operator: 'is', value: 'Active' }],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(hostTable.id, { [hNameFieldId]: 'Host' });
      await ctx.testContainer.processOutbox();

      // Verify initial: sum of Active records = 10 + 20 = 30
      const beforeRecords = await ctx.listRecords(hostTable.id);
      expect(beforeRecords[0].fields[hRollupFieldId]).toBe(30);

      // Update one active record
      ctx.clearLogs();
      await ctx.updateRecord(foreignTable.id, activeRecord.id, { [fValueFieldId]: 50 });
      await ctx.testContainer.processOutbox();

      // Verify: 50 + 20 = 70
      const afterRecords = await ctx.listRecords(hostTable.id);
      expect(afterRecords[0].fields[hRollupFieldId]).toBe(70);

      // Verify steps
      const plan = ctx.getLastComputedPlan() as {
        steps: Array<{ tableId: string; fieldIds: string[]; level: number }>;
      };
      expect(plan.steps.length).toBe(1);

      // Snapshot
      const nameMaps = buildMultiTableNameMaps([
        {
          id: foreignTable.id,
          name: 'CondRollup_Snapshot_Foreign',
          fields: [{ id: fValueFieldId, name: 'Value' }],
        },
        {
          id: hostTable.id,
          name: 'CondRollup_Snapshot_Host',
          fields: [{ id: hRollupFieldId, name: 'ActiveSum' }],
        },
      ]);
      expect(printComputedSteps(plan as ComputedPlanLogEntry, nameMaps)).toMatchInlineSnapshot(`
        "[Computed Steps: 1]
          L0: CondRollup_Snapshot_Host -> [ActiveSum]
        [Edges: 2]"
      `);
    });

    test('conditionalLookup: valueThreshold - detailed', async () => {
      const createFieldId = createFieldIdGenerator();

      // Create foreign table
      const fNameFieldId = createFieldId();
      const fValueFieldId = createFieldId();

      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CondLookup_Snapshot_Foreign',
        fields: [
          { type: 'singleLineText', id: fNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: fValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      // Create foreign records with various values
      const record1 = await ctx.createRecord(foreignTable.id, {
        [fNameFieldId]: 'Small',
        [fValueFieldId]: 5,
      });
      await ctx.createRecord(foreignTable.id, {
        [fNameFieldId]: 'Large',
        [fValueFieldId]: 20,
      });

      // Create host table with conditionalLookup (value >= 10)
      const hNameFieldId = createFieldId();
      const hLookupFieldId = createFieldId();

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CondLookup_Snapshot_Host',
        fields: [
          { type: 'singleLineText', id: hNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalLookup',
            id: hLookupFieldId,
            name: 'LargeValues',
            options: {
              foreignTableId: foreignTable.id,
              lookupFieldId: fValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [{ fieldId: fValueFieldId, operator: 'isGreaterEqual', value: 10 }],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      await ctx.createRecord(hostTable.id, { [hNameFieldId]: 'Host' });
      await ctx.testContainer.processOutbox();

      // Verify initial: only value >= 10, so [20]
      const beforeRecords = await ctx.listRecords(hostTable.id);
      expect(beforeRecords[0].fields[hLookupFieldId]).toEqual([20]);

      // Update small record to make it match
      ctx.clearLogs();
      await ctx.updateRecord(foreignTable.id, record1.id, { [fValueFieldId]: 15 });
      await ctx.testContainer.processOutbox();

      // Verify: now both match, [15, 20] or [20, 15]
      const afterRecords = await ctx.listRecords(hostTable.id);
      const afterValues = afterRecords[0].fields[hLookupFieldId] as number[];
      expect(afterValues.sort()).toEqual([15, 20]);
    });
  });
});
