/**
 * Rollup Field Matrix Tests
 *
 * Tests rollup field updates with various:
 * - Source field types (number, rating)
 * - Value transitions (nullToValue, valueToValue, valueToNull)
 * - Link relationships (manyMany, oneMany)
 * - Link directions (oneWay, twoWay)
 * - Rollup expressions (sum, count, avg)
 *
 * Total: ~48 test cases
 */

import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createTestContext, createFieldIdGenerator, getFieldValues } from './shared';
import type {
  TestContext,
  ValueTransition,
  LinkRelationship,
  LinkDirection,
  RollupTestCase,
} from './shared';

// =============================================================================
// Test Configuration
// =============================================================================

// Rollup works best with numeric types
const SOURCE_TYPES: RollupTestCase['source'][] = ['number', 'rating'];
const TRANSITIONS: ValueTransition[] = ['nullToValue', 'valueToValue', 'valueToNull'];
// Rollup makes most sense with manyMany and oneMany (aggregating multiple records)
const RELATIONSHIPS: LinkRelationship[] = ['manyMany', 'oneMany'];
const DIRECTIONS: LinkDirection[] = ['oneWay', 'twoWay'];
const EXPRESSIONS = ['sum({values})', 'count({values})', 'average({values})'] as const;

// Generate test cases
const generateRollupCases = (): RollupTestCase[] =>
  SOURCE_TYPES.flatMap((source) =>
    TRANSITIONS.flatMap((transition) =>
      RELATIONSHIPS.flatMap((rel) =>
        DIRECTIONS.flatMap((dir) =>
          EXPRESSIONS.map((expression) => ({
            source,
            transition,
            rel,
            dir,
            expression,
          }))
        )
      )
    )
  );

const ROLLUP_CASES = generateRollupCases();

// =============================================================================
// Test Suite
// =============================================================================

describe('rollup field matrix (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  }, 120_000);
  // No afterAll dispose needed - handled by vitest.setup.ts

  beforeEach(() => {
    ctx.clearLogs();
  });

  // ===========================================================================
  // Rollup Matrix Tests
  // ===========================================================================

  describe('source type × transition × relationship × direction × expression', () => {
    test.each(ROLLUP_CASES)(
      'rollup: $source $transition $rel $dir $expression',
      async ({ source, transition, rel, dir, expression }) => {
        const createFieldId = createFieldIdGenerator();
        const { initial, updated } = getFieldValues(source, transition);

        // =====================================================================
        // Create Source Table (TableA)
        // =====================================================================
        const aNameFieldId = createFieldId();
        const aSourceFieldId = createFieldId();

        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
          name: `RollupA_${source}_${rel}_${dir}`,
          fields: [
            { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
            { type: source, id: aSourceFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        // Create multiple source records
        const record1Data: Record<string, unknown> = { [aNameFieldId]: 'A1' };
        const record2Data: Record<string, unknown> = { [aNameFieldId]: 'A2' };
        if (initial !== null) {
          record1Data[aSourceFieldId] = initial;
          record2Data[aSourceFieldId] = initial;
        }

        const recordA1 = await ctx.createRecord(tableA.id, record1Data);
        const recordA2 = await ctx.createRecord(tableA.id, record2Data);

        // =====================================================================
        // Create Target Table (TableB) with Link and Rollup
        // =====================================================================
        const bNameFieldId = createFieldId();
        const bLinkFieldId = createFieldId();
        const bRollupFieldId = createFieldId();

        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
          name: `RollupB_${source}_${rel}_${dir}`,
          fields: [
            { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: bLinkFieldId,
              name: 'Links',
              options: {
                relationship: rel,
                foreignTableId: tableA.id,
                lookupFieldId: aNameFieldId,
                isOneWay: dir === 'oneWay',
              },
            },
            {
              type: 'rollup',
              id: bRollupFieldId,
              name: 'Rollup',
              options: { expression },
              config: {
                linkFieldId: bLinkFieldId,
                foreignTableId: tableA.id,
                lookupFieldId: aSourceFieldId,
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

        // Clear logs before update
        ctx.clearLogs();

        // =====================================================================
        // Update One Source Record
        // =====================================================================
        await ctx.updateRecord(tableA.id, recordA1.id, { [aSourceFieldId]: updated });
        await ctx.testContainer.processOutbox();

        // Get results
        const afterRecords = await ctx.listRecords(tableB.id);
        const afterValue = afterRecords[0].fields[bRollupFieldId];

        // =====================================================================
        // Verify Results
        // =====================================================================

        // A1 was updated; A2 retains the initial value. Numeric aggregates omit nulls.
        const values = [updated, initial].filter(
          (value): value is number => typeof value === 'number'
        );
        const sum = values.reduce((total, value) => total + value, 0);
        const expectedValues = {
          'sum({values})': sum,
          'count({values})': values.length,
          'average({values})': values.length === 0 ? 0 : sum / values.length,
        };
        expect(afterValue).toBe(expectedValues[expression]);
      }
    );
  });

  // ===========================================================================
  // Detailed Value Tests
  // ===========================================================================

  describe('detailed value tests', () => {
    test('rollup: number sum manyMany twoWay - detailed', async () => {
      const createFieldId = createFieldIdGenerator();

      // Create source table
      const aNameFieldId = createFieldId();
      const aValueFieldId = createFieldId();

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'RollupSnapshot_Source',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      // Create source records
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
      const bRollupFieldId = createFieldId();

      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'RollupSnapshot_Target',
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
            type: 'rollup',
            id: bRollupFieldId,
            name: 'Sum',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: bLinkFieldId,
              foreignTableId: tableA.id,
              lookupFieldId: aValueFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Create target record linked to both
      await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'ItemB',
        [bLinkFieldId]: [{ id: recordA1.id }, { id: recordA2.id }],
      });

      await ctx.testContainer.processOutbox();

      const beforeRecords = await ctx.listRecords(tableB.id);
      expect(beforeRecords[0].fields[bRollupFieldId]).toBe(30); // 10 + 20

      // Clear and update
      ctx.clearLogs();
      await ctx.updateRecord(tableA.id, recordA1.id, { [aValueFieldId]: 50 });
      await ctx.testContainer.processOutbox();

      // Verify: 50 + 20 = 70
      const afterRecords = await ctx.listRecords(tableB.id);
      expect(afterRecords[0].fields[bRollupFieldId]).toBe(70);
    });

    test('rollup: adding/removing linked records', async () => {
      const createFieldId = createFieldIdGenerator();

      // Create source table
      const aNameFieldId = createFieldId();
      const aValueFieldId = createFieldId();

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'RollupAddRemove_Source',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      // Create source records
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

      // Create target table
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bRollupFieldId = createFieldId();

      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'RollupAddRemove_Target',
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
            type: 'rollup',
            id: bRollupFieldId,
            name: 'Sum',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: bLinkFieldId,
              foreignTableId: tableA.id,
              lookupFieldId: aValueFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Create target record with 2 links
      const recordB = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'ItemB',
        [bLinkFieldId]: [{ id: recordA1.id }, { id: recordA2.id }],
      });

      await ctx.testContainer.processOutbox();

      const beforeRecords = await ctx.listRecords(tableB.id);
      expect(beforeRecords[0].fields[bRollupFieldId]).toBe(30); // 10 + 20

      // Add a third link
      ctx.clearLogs();
      await ctx.updateRecord(tableB.id, recordB.id, {
        [bLinkFieldId]: [{ id: recordA1.id }, { id: recordA2.id }, { id: recordA3.id }],
      });
      await ctx.testContainer.processOutbox();

      const afterAddRecords = await ctx.listRecords(tableB.id);
      expect(afterAddRecords[0].fields[bRollupFieldId]).toBe(60); // 10 + 20 + 30

      // Remove one link
      ctx.clearLogs();
      await ctx.updateRecord(tableB.id, recordB.id, {
        [bLinkFieldId]: [{ id: recordA2.id }, { id: recordA3.id }],
      });
      await ctx.testContainer.processOutbox();

      const afterRemoveRecords = await ctx.listRecords(tableB.id);
      expect(afterRemoveRecords[0].fields[bRollupFieldId]).toBe(50); // 20 + 30
    });
  });
});
