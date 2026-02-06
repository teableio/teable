/**
 * Cross-Table Chain Matrix Tests
 *
 * Tests multi-level cross-table dependency chains:
 * - A -> B.lookup -> C.lookup (depth=2)
 * - A -> B.lookup -> C.lookup -> D.lookup (depth=3)
 * - Mixed chains: A.formula -> B.lookup -> B.formula
 *
 * Total: ~9 test cases
 */

import { buildMultiTableNameMaps, printComputedSteps } from '@teable/v2-container-node-test';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createTestContext, createFieldIdGenerator, getFieldValues } from './shared';
import type { TestContext, ValueTransition, ChainTestCase } from './shared';

// =============================================================================
// Test Configuration
// =============================================================================

const CHAIN_DEPTHS = [2, 3] as const;
const TRANSITIONS: ValueTransition[] = ['nullToValue', 'valueToValue', 'valueToNull'];

// Generate test cases
const generateChainCases = (): ChainTestCase[] =>
  CHAIN_DEPTHS.flatMap((depth) =>
    TRANSITIONS.map((transition) => ({
      depth,
      transition,
    }))
  );

const CHAIN_CASES = generateChainCases();

// =============================================================================
// Test Suite
// =============================================================================

describe('cross-table chain matrix (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  }, 120_000);
  // No afterAll dispose needed - handled by vitest.setup.ts

  beforeEach(() => {
    ctx.clearLogs();
  });

  // ===========================================================================
  // Chain Depth Matrix Tests
  // ===========================================================================

  describe('chain depth × transition', () => {
    test.each(CHAIN_CASES)('chain: depth=$depth $transition', async ({ depth, transition }) => {
      const createFieldId = createFieldIdGenerator();
      const { initial, updated } = getFieldValues('number', transition);

      // =====================================================================
      // Create Table A (Source)
      // =====================================================================
      const aNameFieldId = createFieldId();
      const aValueFieldId = createFieldId();

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: `ChainA_d${depth}`,
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      // Create source record
      const recordAData: Record<string, unknown> = { [aNameFieldId]: 'ItemA' };
      if (initial !== null) {
        recordAData[aValueFieldId] = initial;
      }
      const recordA = await ctx.createRecord(tableA.id, recordAData);

      // =====================================================================
      // Create Table B (First Level Lookup)
      // =====================================================================
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bLookupFieldId = createFieldId();

      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: `ChainB_d${depth}`,
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
              isOneWay: true,
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

      // Create B record linked to A
      const recordB = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'ItemB',
        [bLinkFieldId]: { id: recordA.id },
      });

      await ctx.testContainer.processOutbox();

      // =====================================================================
      // Create Table C (Second Level Lookup)
      // =====================================================================
      const cNameFieldId = createFieldId();
      const cLinkFieldId = createFieldId();
      const cLookupFieldId = createFieldId();

      const tableC = await ctx.createTable({
        baseId: ctx.baseId,
        name: `ChainC_d${depth}`,
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
              isOneWay: true,
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

      // Create C record linked to B
      const recordC = await ctx.createRecord(tableC.id, {
        [cNameFieldId]: 'ItemC',
        [cLinkFieldId]: { id: recordB.id },
      });

      await ctx.testContainer.processOutbox();

      // Final table/field to check
      let finalTableId = tableC.id;
      let finalFieldId = cLookupFieldId;

      // =====================================================================
      // Create Table D if depth=3 (Third Level Lookup)
      // =====================================================================
      if (depth === 3) {
        const dNameFieldId = createFieldId();
        const dLinkFieldId = createFieldId();
        const dLookupFieldId = createFieldId();

        const tableD = await ctx.createTable({
          baseId: ctx.baseId,
          name: `ChainD_d${depth}`,
          fields: [
            { type: 'singleLineText', id: dNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: dLinkFieldId,
              name: 'LinkC',
              options: {
                relationship: 'manyOne',
                foreignTableId: tableC.id,
                lookupFieldId: cNameFieldId,
                isOneWay: true,
              },
            },
            {
              type: 'lookup',
              id: dLookupFieldId,
              name: 'LookupC',
              options: {
                linkFieldId: dLinkFieldId,
                foreignTableId: tableC.id,
                lookupFieldId: cLookupFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        // Create D record linked to C
        await ctx.createRecord(tableD.id, {
          [dNameFieldId]: 'ItemD',
          [dLinkFieldId]: { id: recordC.id },
        });

        await ctx.testContainer.processOutbox();

        finalTableId = tableD.id;
        finalFieldId = dLookupFieldId;
      }

      // Get before value
      const beforeRecords = await ctx.listRecords(finalTableId);
      const beforeValue = beforeRecords[0].fields[finalFieldId];

      // Clear logs before update
      ctx.clearLogs();

      // =====================================================================
      // Update Source Record (A)
      // =====================================================================
      await ctx.updateRecord(tableA.id, recordA.id, { [aValueFieldId]: updated });

      // Process outbox multiple times for chain propagation
      for (let i = 0; i < depth + 1; i++) {
        await ctx.testContainer.processOutbox();
      }

      // Get results from final table
      const afterRecords = await ctx.listRecords(finalTableId);
      const afterValue = afterRecords[0].fields[finalFieldId];

      // =====================================================================
      // Verify Results
      // =====================================================================

      if (transition === 'valueToNull') {
        // Should be null or array of nulls
        if (Array.isArray(afterValue)) {
          expect(
            afterValue.every((v) => v === null || (Array.isArray(v) && v.every((x) => x === null)))
          ).toBe(true);
        } else {
          expect(afterValue).toBeNull();
        }
      } else {
        // Value should have changed
        expect(afterValue).not.toEqual(beforeValue);
      }
    });
  });

  // ===========================================================================
  // Mixed Chain Tests
  // ===========================================================================

  describe('mixed chain scenarios', () => {
    test('mixed: A.number -> A.formula -> B.lookup', async () => {
      const createFieldId = createFieldIdGenerator();

      // Create Table A with number and formula
      const aNameFieldId = createFieldId();
      const aValueFieldId = createFieldId();
      const aFormulaFieldId = createFieldId();

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'MixedChainA',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aValueFieldId, name: 'Value' },
          {
            type: 'formula',
            id: aFormulaFieldId,
            name: 'Doubled',
            options: { expression: `{${aValueFieldId}} * 2` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Create A record
      const recordA = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'ItemA',
        [aValueFieldId]: 10,
      });

      // Create Table B that looks up A's formula
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bLookupFieldId = createFieldId();

      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'MixedChainB',
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
              isOneWay: true,
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
        ],
        views: [{ type: 'grid' }],
      });

      // Create B record linked to A
      await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'ItemB',
        [bLinkFieldId]: { id: recordA.id },
      });

      await ctx.testContainer.processOutbox();

      // Verify initial: A.Value=10, A.Doubled=20, B.LookupDoubled=[20]
      const beforeARecords = await ctx.listRecords(tableA.id);
      expect(beforeARecords[0].fields[aFormulaFieldId]).toBe(20);

      const beforeBRecords = await ctx.listRecords(tableB.id);
      expect(beforeBRecords[0].fields[bLookupFieldId]).toEqual([20]);

      // Update A.Value
      ctx.clearLogs();
      await ctx.updateRecord(tableA.id, recordA.id, { [aValueFieldId]: 25 });
      await ctx.testContainer.processOutbox();

      // Verify: A.Value=25, A.Doubled=50, B.LookupDoubled=[50]
      const afterARecords = await ctx.listRecords(tableA.id);
      expect(afterARecords[0].fields[aFormulaFieldId]).toBe(50);

      const afterBRecords = await ctx.listRecords(tableB.id);
      expect(afterBRecords[0].fields[bLookupFieldId]).toEqual([50]);
    });

    test('mixed: A.number -> B.lookup -> B.formula', async () => {
      const createFieldId = createFieldIdGenerator();

      // Create Table A
      const aNameFieldId = createFieldId();
      const aValueFieldId = createFieldId();

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'MixedChain2A',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      // Create A record
      const recordA = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'ItemA',
        [aValueFieldId]: 10,
      });

      // Create Table B with lookup and formula based on lookup
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bLookupFieldId = createFieldId();
      const bFormulaFieldId = createFieldId();

      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'MixedChain2B',
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
              isOneWay: true,
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
          {
            type: 'formula',
            id: bFormulaFieldId,
            name: 'Processed',
            options: { expression: `SUM({${bLookupFieldId}}) * 3` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Create B record linked to A
      await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'ItemB',
        [bLinkFieldId]: { id: recordA.id },
      });

      await ctx.testContainer.processOutbox();

      // Verify initial: A.Value=10, B.LookupVal=[10], B.Processed=30
      const beforeBRecords = await ctx.listRecords(tableB.id);
      expect(beforeBRecords[0].fields[bLookupFieldId]).toEqual([10]);
      expect(beforeBRecords[0].fields[bFormulaFieldId]).toBe(30);

      // Update A.Value
      ctx.clearLogs();
      await ctx.updateRecord(tableA.id, recordA.id, { [aValueFieldId]: 20 });
      await ctx.testContainer.processOutbox();

      // Verify: A.Value=20, B.LookupVal=[20], B.Processed=60
      const afterBRecords = await ctx.listRecords(tableB.id);
      expect(afterBRecords[0].fields[bLookupFieldId]).toEqual([20]);
      expect(afterBRecords[0].fields[bFormulaFieldId]).toBe(60);
    });
  });

  // ===========================================================================
  // Snapshot Test
  // ===========================================================================

  describe('snapshot tests', () => {
    test('chain depth=2 snapshot', async () => {
      const createFieldId = createFieldIdGenerator();

      // Create A
      const aNameFieldId = createFieldId();
      const aValueFieldId = createFieldId();
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ChainSnapshot_A',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });
      const recordA = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A',
        [aValueFieldId]: 100,
      });

      // Create B
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bLookupFieldId = createFieldId();
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ChainSnapshot_B',
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
              isOneWay: true,
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
        [bNameFieldId]: 'B',
        [bLinkFieldId]: { id: recordA.id },
      });
      await ctx.testContainer.processOutbox();

      // Create C
      const cNameFieldId = createFieldId();
      const cLinkFieldId = createFieldId();
      const cLookupFieldId = createFieldId();
      const tableC = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ChainSnapshot_C',
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
              isOneWay: true,
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
      await ctx.createRecord(tableC.id, {
        [cNameFieldId]: 'C',
        [cLinkFieldId]: { id: recordB.id },
      });
      await ctx.testContainer.processOutbox();

      // Verify chain
      const cRecords = await ctx.listRecords(tableC.id);
      expect(cRecords[0].fields[cLookupFieldId]).toEqual([100]);

      // Update A
      ctx.clearLogs();
      await ctx.updateRecord(tableA.id, recordA.id, { [aValueFieldId]: 200 });
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Verify
      const afterCRecords = await ctx.listRecords(tableC.id);
      expect(afterCRecords[0].fields[cLookupFieldId]).toEqual([200]);
    });
  });
});
