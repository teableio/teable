/**
 * Link Operation Matrix Tests
 *
 * Tests how link operations affect computed fields:
 * - Operations (linkAdd, linkRemove, linkReplace, linkClear)
 * - Relationships (manyMany, manyOne, oneMany, oneOne)
 *
 * Total: ~16 test cases
 */

import { buildMultiTableNameMaps, printComputedSteps } from '@teable/v2-container-node-test';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createTestContext, createFieldIdGenerator } from './shared';
import type { TestContext, LinkRelationship, LinkOpTestCase } from './shared';

// =============================================================================
// Test Configuration
// =============================================================================

const LINK_OPERATIONS = ['linkAdd', 'linkRemove', 'linkReplace', 'linkClear'] as const;
const RELATIONSHIPS: LinkRelationship[] = ['manyMany', 'manyOne', 'oneMany', 'oneOne'];

// Generate test cases
const generateLinkOpCases = (): LinkOpTestCase[] =>
  LINK_OPERATIONS.flatMap((operation) =>
    RELATIONSHIPS.map((rel) => ({
      operation,
      rel,
    }))
  );

const LINK_OP_CASES = generateLinkOpCases();

// =============================================================================
// Test Suite
// =============================================================================

describe('link operation matrix (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  }, 120_000);
  // No afterAll dispose needed - handled by vitest.setup.ts

  beforeEach(() => {
    ctx.clearLogs();
  });

  // ===========================================================================
  // Link Operation Matrix Tests
  // ===========================================================================

  describe('operation × relationship', () => {
    test.each(LINK_OP_CASES)('link-op: $operation $rel', async ({ operation, rel }) => {
      const createFieldId = createFieldIdGenerator();

      // =====================================================================
      // Create Source Table (TableA)
      // =====================================================================
      const aNameFieldId = createFieldId();
      const aValueFieldId = createFieldId();

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: `LinkOpA_${operation}_${rel}`,
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

      // =====================================================================
      // Create Target Table (TableB) with Link and Rollup
      // =====================================================================
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bRollupFieldId = createFieldId();

      // For oneOne and manyOne, rollup doesn't make much sense
      // but we test it anyway for consistency
      const isMultiLink = rel === 'manyMany' || rel === 'oneMany';

      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: `LinkOpB_${operation}_${rel}`,
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

      // Set up initial link state based on operation
      let initialLinkValue: unknown;
      if (operation === 'linkAdd') {
        // Start with one link, will add another
        initialLinkValue = isMultiLink ? [{ id: recordA1.id }] : { id: recordA1.id };
      } else if (operation === 'linkRemove') {
        // Start with two links, will remove one
        initialLinkValue = isMultiLink
          ? [{ id: recordA1.id }, { id: recordA2.id }]
          : { id: recordA1.id };
      } else if (operation === 'linkReplace') {
        // Start with one link, will replace with another
        initialLinkValue = isMultiLink ? [{ id: recordA1.id }] : { id: recordA1.id };
      } else {
        // linkClear: start with links, will clear all
        initialLinkValue = isMultiLink
          ? [{ id: recordA1.id }, { id: recordA2.id }]
          : { id: recordA1.id };
      }

      const recordB = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'ItemB',
        [bLinkFieldId]: initialLinkValue,
      });

      await ctx.testContainer.processOutbox();

      // Get before value
      const beforeRecords = await ctx.listRecords(tableB.id);
      const beforeSum = beforeRecords[0].fields[bRollupFieldId];

      // Clear logs before operation
      ctx.clearLogs();

      // =====================================================================
      // Perform Link Operation
      // =====================================================================
      let newLinkValue: unknown;

      switch (operation) {
        case 'linkAdd':
          // Add A2 to existing links
          if (isMultiLink) {
            newLinkValue = [{ id: recordA1.id }, { id: recordA2.id }];
          } else {
            // For single link, adding means replacing
            newLinkValue = { id: recordA2.id };
          }
          break;

        case 'linkRemove':
          // Remove A2 from links (or clear for single link)
          if (isMultiLink) {
            newLinkValue = [{ id: recordA1.id }];
          } else {
            newLinkValue = null;
          }
          break;

        case 'linkReplace':
          // Replace A1 with A3
          if (isMultiLink) {
            newLinkValue = [{ id: recordA3.id }];
          } else {
            newLinkValue = { id: recordA3.id };
          }
          break;

        case 'linkClear':
          // Clear all links
          newLinkValue = isMultiLink ? [] : null;
          break;
      }

      await ctx.updateRecord(tableB.id, recordB.id, { [bLinkFieldId]: newLinkValue });
      await ctx.testContainer.processOutbox();

      // Get results
      const afterRecords = await ctx.listRecords(tableB.id);
      const afterSum = afterRecords[0].fields[bRollupFieldId];

      // =====================================================================
      // Verify Results
      // =====================================================================

      switch (operation) {
        case 'linkAdd':
          if (isMultiLink) {
            // Sum should increase: 10 -> 10+20=30
            expect(afterSum).toBe(30);
          } else {
            // Single link replaced: 10 -> 20
            expect(afterSum).toBe(20);
          }
          break;

        case 'linkRemove':
          if (isMultiLink) {
            // Sum should decrease: 10+20=30 -> 10
            expect(afterSum).toBe(10);
          } else {
            // Cleared: 10 -> 0 or null
            expect([0, null]).toContain(afterSum);
          }
          break;

        case 'linkReplace':
          // Replaced with A3: -> 30
          expect(afterSum).toBe(30);
          break;

        case 'linkClear':
          // All cleared: -> 0 or null
          expect([0, null]).toContain(afterSum);
          break;
      }

      // Value should have changed from before
      expect(afterSum).not.toBe(beforeSum);
    });
  });

  // ===========================================================================
  // Detailed Tests for Symmetric Link Effects
  // ===========================================================================

  describe('symmetric link effects', () => {
    test('twoWay link: adding link updates both sides', async () => {
      const createFieldId = createFieldIdGenerator();

      // Create Table A
      const aNameFieldId = createFieldId();
      const aValueFieldId = createFieldId();

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'SymLink_A',
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

      // Create Table B with twoWay link
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bRollupFieldId = createFieldId();

      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'SymLink_B',
        fields: [
          { type: 'singleLineText', id: bNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: bLinkFieldId,
            name: 'LinkA',
            options: {
              relationship: 'manyMany',
              foreignTableId: tableA.id,
              lookupFieldId: aNameFieldId,
              isOneWay: false, // twoWay
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

      // Create B without link initially
      const recordB = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'ItemB' });
      await ctx.testContainer.processOutbox();

      // Get symmetric link field ID from tableA
      const updatedTableA = await ctx.getTableById(tableA.id);
      const symLinkFieldId = updatedTableA.fields.find(
        (f) =>
          f.type === 'link' &&
          (f.options as { foreignTableId?: string })?.foreignTableId === tableB.id
      )?.id;

      // Verify no link initially - rollup sum returns 0 for empty links (SQL aggregate behavior)
      const beforeBRecords = await ctx.listRecords(tableB.id);
      expect(beforeBRecords[0].fields[bRollupFieldId]).toBe(0);

      // Add link from B to A
      ctx.clearLogs();
      await ctx.updateRecord(tableB.id, recordB.id, { [bLinkFieldId]: [{ id: recordA.id }] });
      await ctx.testContainer.processOutbox();

      // Verify B's rollup updated
      const afterBRecords = await ctx.listRecords(tableB.id);
      expect(afterBRecords[0].fields[bRollupFieldId]).toBe(100);

      // Verify A's symmetric link updated
      if (symLinkFieldId) {
        const afterARecords = await ctx.listRecords(tableA.id);
        const symLink = afterARecords[0].fields[symLinkFieldId];
        expect(Array.isArray(symLink)).toBe(true);
        if (Array.isArray(symLink)) {
          expect(symLink.length).toBe(1);
        }
      }
    });

    test('deleting record updates symmetric links and computed fields', async () => {
      const createFieldId = createFieldIdGenerator();

      // Create Table A
      const aNameFieldId = createFieldId();
      const aValueFieldId = createFieldId();

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteLink_A',
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

      // Create Table B with link and rollup
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bRollupFieldId = createFieldId();

      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteLink_B',
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

      // Create B linked to both A records
      await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'ItemB',
        [bLinkFieldId]: [{ id: recordA1.id }, { id: recordA2.id }],
      });
      await ctx.testContainer.processOutbox();

      // Verify initial sum: 10 + 20 = 30
      const beforeRecords = await ctx.listRecords(tableB.id);
      expect(beforeRecords[0].fields[bRollupFieldId]).toBe(30);

      // Delete A1
      ctx.clearLogs();
      await ctx.deleteRecord(tableA.id, recordA1.id);
      await ctx.testContainer.processOutbox();

      // Verify sum updated: only A2 = 20
      const afterRecords = await ctx.listRecords(tableB.id);
      expect(afterRecords[0].fields[bRollupFieldId]).toBe(20);
    });
  });

  // ===========================================================================
  // Snapshot Tests
  // ===========================================================================

  describe('snapshot tests', () => {
    test('link operation snapshot: manyMany add', async () => {
      const createFieldId = createFieldIdGenerator();

      // Create A
      const aNameFieldId = createFieldId();
      const aValueFieldId = createFieldId();
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkOp_Snapshot_A',
        fields: [
          { type: 'singleLineText', id: aNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: aValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });
      const recordA1 = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A1',
        [aValueFieldId]: 100,
      });
      const recordA2 = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A2',
        [aValueFieldId]: 200,
      });

      // Create B
      const bNameFieldId = createFieldId();
      const bLinkFieldId = createFieldId();
      const bRollupFieldId = createFieldId();
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkOp_Snapshot_B',
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
              isOneWay: true,
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

      const recordB = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B',
        [bLinkFieldId]: [{ id: recordA1.id }],
      });
      await ctx.testContainer.processOutbox();

      expect((await ctx.listRecords(tableB.id))[0].fields[bRollupFieldId]).toBe(100);

      // Add second link
      ctx.clearLogs();
      await ctx.updateRecord(tableB.id, recordB.id, {
        [bLinkFieldId]: [{ id: recordA1.id }, { id: recordA2.id }],
      });
      await ctx.testContainer.processOutbox();

      expect((await ctx.listRecords(tableB.id))[0].fields[bRollupFieldId]).toBe(300);

      // Verify steps
      const plan = ctx.getLastComputedPlan() as {
        steps: Array<{ tableId: string; fieldIds: string[]; level: number }>;
      };

      const nameMaps = buildMultiTableNameMaps([
        { id: tableA.id, name: 'LinkOp_Snapshot_A', fields: [] },
        { id: tableB.id, name: 'LinkOp_Snapshot_B', fields: [{ id: bRollupFieldId, name: 'Sum' }] },
      ]);

      // Should have rollup step
      const rollupStep = plan.steps.find((s) => s.fieldIds.includes(bRollupFieldId));
      expect(rollupStep).toBeDefined();
    });
  });
});
