/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Lookup Field Matrix Tests
 *
 * Tests lookup field updates with various:
 * - Source field types (number, text, checkbox)
 * - Value transitions (nullToValue, valueToValue, valueToNull)
 * - Link relationships (oneOne, oneMany, manyOne, manyMany)
 * - Link directions (oneWay, twoWay)
 *
 * Total: ~72 test cases
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
import type {
  TestContext,
  SourceFieldType,
  ValueTransition,
  LinkRelationship,
  LinkDirection,
  LookupTestCase,
} from './shared';

// =============================================================================
// Test Configuration
// =============================================================================

const SOURCE_TYPES: SourceFieldType[] = ['number', 'singleLineText', 'checkbox'];
const TRANSITIONS: ValueTransition[] = ['nullToValue', 'valueToValue', 'valueToNull'];
const RELATIONSHIPS: LinkRelationship[] = ['oneOne', 'oneMany', 'manyOne', 'manyMany'];
const DIRECTIONS: LinkDirection[] = ['oneWay', 'twoWay'];

// Generate test cases
const generateLookupCases = (): LookupTestCase[] =>
  SOURCE_TYPES.flatMap((source) =>
    TRANSITIONS.flatMap((transition) =>
      RELATIONSHIPS.flatMap((rel) =>
        DIRECTIONS.map((dir) => ({
          source,
          transition,
          rel,
          dir,
        }))
      )
    )
  );

const LOOKUP_CASES = generateLookupCases();

// =============================================================================
// Helper Functions
// =============================================================================

const getLinkValueForRelationship = (
  recordIds: string[],
  relationship: LinkRelationship
): unknown => {
  if (recordIds.length === 0) return null;

  // For oneOne and manyOne, return single object
  if (relationship === 'oneOne' || relationship === 'manyOne') {
    return { id: recordIds[0] };
  }

  // For oneMany and manyMany, return array
  return recordIds.map((id) => ({ id }));
};

// =============================================================================
// Test Suite
// =============================================================================

describe('lookup field matrix (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  }, 120_000);
  // No afterAll dispose needed - handled by vitest.setup.ts

  beforeEach(() => {
    ctx.clearLogs();
  });

  // ===========================================================================
  // Lookup Matrix Tests
  // ===========================================================================

  describe('source type × transition × relationship × direction', () => {
    test.each(LOOKUP_CASES)(
      'lookup: $source $transition $rel $dir',
      async ({ source, transition, rel, dir }) => {
        const createFieldId = createFieldIdGenerator();
        const { initial, updated } = getFieldValues(source, transition);

        // =====================================================================
        // Create Source Table (TableA)
        // =====================================================================
        const aNameFieldId = createFieldId();
        const aSourceFieldId = createFieldId();

        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
          name: `LookupA_${source}_${rel}_${dir}`,
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            { type: source, id: aSourceFieldId, name: 'Source' },
          ],
          views: [{ type: 'grid' }],
        });

        // Create source record with initial value
        const sourceRecordData: Record<string, unknown> = {
          [aNameFieldId]: 'ItemA',
        };
        if (initial !== null) {
          sourceRecordData[aSourceFieldId] = initial;
        }
        const recordA = await ctx.createRecord(tableA.id, sourceRecordData);

        // =====================================================================
        // Create Target Table (TableB) with Link and Lookup
        // =====================================================================
        const bNameFieldId = createFieldId();
        const bLinkFieldId = createFieldId();
        const bLookupFieldId = createFieldId();

        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
          name: `LookupB_${source}_${rel}_${dir}`,
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: bLinkFieldId,
              name: 'LinkA',
              options: {
                relationship: rel,
                foreignTableId: tableA.id,
                lookupFieldId: aNameFieldId,
                isOneWay: dir === 'oneWay',
              },
            },
            {
              type: 'lookup',
              id: bLookupFieldId,
              name: 'LookupSource',
              options: {
                linkFieldId: bLinkFieldId,
                foreignTableId: tableA.id,
                lookupFieldId: aSourceFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        // Create target record and link to source
        const linkValue = getLinkValueForRelationship([recordA.id], rel);
        await ctx.createRecord(tableB.id, {
          [bNameFieldId]: 'ItemB',
          [bLinkFieldId]: linkValue,
        });

        await ctx.testContainer.processOutbox();

        const beforeRecords = await ctx.listRecords(tableB.id);
        const recordB = beforeRecords[0];
        const beforeValue = recordB.fields[bLookupFieldId];

        // Clear logs before the update we want to test
        ctx.clearLogs();

        // =====================================================================
        // Update Source Record
        // =====================================================================
        await ctx.updateRecord(tableA.id, recordA.id, { [aSourceFieldId]: updated });
        await ctx.testContainer.processOutbox();

        // Get results
        const afterRecords = await ctx.listRecords(tableB.id);
        const afterValue = afterRecords[0].fields[bLookupFieldId];

        // =====================================================================
        // Verify Results
        // =====================================================================

        // Lookup always returns array
        if (transition === 'valueToNull') {
          // After update to null, lookup should return [null] or similar
          if (Array.isArray(afterValue)) {
            expect(afterValue.every((v) => v === null)).toBe(true);
          } else {
            expect(afterValue).toBeNull();
          }
        } else {
          // Value should have changed
          expect(afterValue).not.toEqual(beforeValue);

          // Should contain the updated value
          if (Array.isArray(afterValue)) {
            expect(afterValue.length).toBeGreaterThan(0);
            expect(afterValue).toContain(updated);
          }
        }

        // Verify computed steps
        const plan = ctx.getLastComputedPlan() as {
          steps: Array<{ tableId: string; fieldIds: string[]; level: number }>;
        };
        const expectedSteps = getExpectedSteps('lookup', 1, { relationship: rel, direction: dir });
        verifySteps(plan, expectedSteps, bLookupFieldId);
      }
    );
  });

  // ===========================================================================
  // Detailed Snapshot Tests
  // ===========================================================================

  describe('snapshot tests', () => {
    test('lookup: number valueToValue manyOne twoWay - detailed', async () => {
      const createFieldId = createFieldIdGenerator();

      // Create source table
      const aNameFieldId = createFieldId();
      const aValueFieldId = createFieldId();

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LookupSnapshot_Source',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      // Create source record
      const recordA = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'ItemA',
        [aValueFieldId]: 100,
      });

      // Create target table
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bLookupFieldId = createFieldId();

      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LookupSnapshot_Target',
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
              isOneWay: false,
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

      // Create target record linked to source
      await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'ItemB',
        [bLinkFieldId]: { id: recordA.id },
      });

      await ctx.testContainer.processOutbox();

      const beforeRecords = await ctx.listRecords(tableB.id);
      expect(beforeRecords[0].fields[bLookupFieldId]).toEqual([100]);

      // Clear and update
      ctx.clearLogs();
      await ctx.updateRecord(tableA.id, recordA.id, { [aValueFieldId]: 200 });
      await ctx.testContainer.processOutbox();

      // Verify
      const afterRecords = await ctx.listRecords(tableB.id);
      expect(afterRecords[0].fields[bLookupFieldId]).toEqual([200]);

      // Verify steps
      const plan = ctx.getLastComputedPlan() as {
        steps: Array<{ tableId: string; fieldIds: string[]; level: number }>;
      };
      expect(plan.steps.length).toBe(1);

      // Snapshot
      const nameMaps = buildMultiTableNameMaps([
        {
          id: tableA.id,
          name: 'LookupSnapshot_Source',
          fields: [{ id: aValueFieldId, name: 'Value' }],
        },
        {
          id: tableB.id,
          name: 'LookupSnapshot_Target',
          fields: [{ id: bLookupFieldId, name: 'LookupVal' }],
        },
      ]);
      expect(printComputedSteps(plan as ComputedPlanLogEntry, nameMaps)).toMatchInlineSnapshot(`
        "[Computed Steps: 1]
          L0: LookupSnapshot_Target -> [LookupVal]
        [Edges: 2]"
      `);
    });

    test('lookup: manyMany with multiple records - detailed', async () => {
      const createFieldId = createFieldIdGenerator();

      // Create source table
      const aNameFieldId = createFieldId();
      const aValueFieldId = createFieldId();

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LookupManyMany_Source',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      // Create multiple source records
      const recordA1 = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A1',
        [aValueFieldId]: 10,
      });
      const recordA2 = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A2',
        [aValueFieldId]: 20,
      });

      // Create target table
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bLookupFieldId = createFieldId();

      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LookupManyMany_Target',
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
              isOneWay: false,
            },
          },
          {
            type: 'lookup',
            id: bLookupFieldId,
            name: 'LookupVals',
            options: {
              linkFieldId: bLinkFieldId,
              foreignTableId: tableA.id,
              lookupFieldId: aValueFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Create target record linked to both source records
      await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'ItemB',
        [bLinkFieldId]: [{ id: recordA1.id }, { id: recordA2.id }],
      });

      await ctx.testContainer.processOutbox();

      const beforeRecords = await ctx.listRecords(tableB.id);
      const beforeLookup = beforeRecords[0].fields[bLookupFieldId] as number[];
      expect(beforeLookup.sort((a, b) => a - b)).toEqual([10, 20]);

      // Clear and update one source record
      ctx.clearLogs();
      await ctx.updateRecord(tableA.id, recordA1.id, { [aValueFieldId]: 100 });
      await ctx.testContainer.processOutbox();

      // Verify - should now be [100, 20]
      const afterRecords = await ctx.listRecords(tableB.id);
      const afterLookup = afterRecords[0].fields[bLookupFieldId] as number[];
      expect(afterLookup.sort((a, b) => a - b)).toEqual([20, 100]);
    });
  });
});
