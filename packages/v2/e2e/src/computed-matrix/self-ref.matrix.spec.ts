/**
 * Self-Referencing Link Matrix Tests
 *
 * Tests lookup and rollup fields on self-referencing tables:
 * - Self-reference types (selfManyOne, selfManyMany)
 * - Computed types (lookup, rollup)
 * - Value transitions (nullToValue, valueToValue, valueToNull)
 *
 * Total: ~12 test cases
 */

import {
  buildNameMaps,
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
import type { TestContext, ValueTransition, SelfRefType, SelfRefTestCase } from './shared';

// =============================================================================
// Test Configuration
// =============================================================================

const SELF_REF_TYPES: SelfRefType[] = ['selfManyOne', 'selfManyMany'];
const COMPUTED_TYPES = ['lookup', 'rollup'] as const;
const TRANSITIONS: ValueTransition[] = ['nullToValue', 'valueToValue', 'valueToNull'];

// Generate test cases
const generateSelfRefCases = (): SelfRefTestCase[] =>
  SELF_REF_TYPES.flatMap((selfRef) =>
    COMPUTED_TYPES.flatMap((computed) =>
      TRANSITIONS.map((transition) => ({
        selfRef,
        computed,
        transition,
      }))
    )
  );

const SELF_REF_CASES = generateSelfRefCases();

// =============================================================================
// Test Suite
// =============================================================================

describe('self-referencing matrix (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  }, 120_000);
  // No afterAll dispose needed - handled by vitest.setup.ts

  beforeEach(() => {
    ctx.clearLogs();
  });

  // ===========================================================================
  // Self-Reference Matrix Tests
  // ===========================================================================

  describe('selfRef × computed × transition', () => {
    test.each(SELF_REF_CASES)(
      'self-ref: $selfRef $computed $transition',
      async ({ selfRef, computed, transition }) => {
        const createFieldId = createFieldIdGenerator();
        const { initial, updated } = getFieldValues('number', transition);

        // Determine relationship based on selfRef type
        const relationship = selfRef === 'selfManyOne' ? 'manyOne' : 'manyMany';

        // =====================================================================
        // Create Self-Referencing Table
        // =====================================================================
        const nameFieldId = createFieldId();
        const valueFieldId = createFieldId();
        const linkFieldId = createFieldId();
        const computedFieldId = createFieldId();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fields: any[] = [
          { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: valueFieldId, name: 'Value' },
        ];

        // We need to create the table first, then add the link field
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: `SelfRef_${selfRef}_${computed}`,
          fields,
          views: [{ type: 'grid' }],
        });

        // Add self-referencing link field
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'link',
            id: linkFieldId,
            name: selfRef === 'selfManyOne' ? 'Parent' : 'Related',
            options: {
              relationship,
              foreignTableId: table.id,
              lookupFieldId: nameFieldId,
              isOneWay: false,
            },
          },
        });

        // Add computed field (lookup or rollup)
        if (computed === 'lookup') {
          await ctx.createField({
            baseId: ctx.baseId,
            tableId: table.id,
            field: {
              type: 'lookup',
              id: computedFieldId,
              name: selfRef === 'selfManyOne' ? 'ParentValue' : 'RelatedValues',
              options: {
                linkFieldId,
                foreignTableId: table.id,
                lookupFieldId: valueFieldId,
              },
            },
          });
        } else {
          await ctx.createField({
            baseId: ctx.baseId,
            tableId: table.id,
            field: {
              type: 'rollup',
              id: computedFieldId,
              name: 'Sum',
              options: { expression: 'sum({values})' },
              config: {
                linkFieldId,
                foreignTableId: table.id,
                lookupFieldId: valueFieldId,
              },
            },
          });
        }

        // =====================================================================
        // Create Records with Self-Reference
        // =====================================================================

        // Create parent/source record
        const parentData: Record<string, unknown> = { [nameFieldId]: 'Parent' };
        if (initial !== null) {
          parentData[valueFieldId] = initial;
        }
        const parentRecord = await ctx.createRecord(table.id, parentData);

        // Create child/target record linked to parent
        const childData: Record<string, unknown> = {
          [nameFieldId]: 'Child',
          [valueFieldId]: 5, // Child has its own value
        };

        // Link format depends on relationship
        if (relationship === 'manyOne') {
          childData[linkFieldId] = { id: parentRecord.id };
        } else {
          childData[linkFieldId] = [{ id: parentRecord.id }];
        }

        await ctx.createRecord(table.id, childData);
        await ctx.testContainer.processOutbox();

        // Get child's computed value before update
        const beforeRecords = await ctx.listRecords(table.id);
        const childRecord = beforeRecords.find((r) => r.fields[nameFieldId] === 'Child');
        const beforeValue = childRecord?.fields[computedFieldId];

        // Clear logs before update
        ctx.clearLogs();

        // =====================================================================
        // Update Parent Record
        // =====================================================================
        await ctx.updateRecord(table.id, parentRecord.id, { [valueFieldId]: updated });
        await ctx.testContainer.processOutbox();

        // Get results
        const afterRecords = await ctx.listRecords(table.id);
        const afterChild = afterRecords.find((r) => r.fields[nameFieldId] === 'Child');
        const afterValue = afterChild?.fields[computedFieldId];

        // =====================================================================
        // Verify Results
        // =====================================================================

        if (transition === 'valueToNull') {
          if (computed === 'lookup') {
            // Lookup should show null
            if (Array.isArray(afterValue)) {
              expect(afterValue.every((v) => v === null)).toBe(true);
            } else {
              expect(afterValue).toBeNull();
            }
          } else {
            // Rollup sum of null is 0 or null
            expect([0, null]).toContain(afterValue);
          }
        } else {
          // Value should have changed
          expect(afterValue).not.toEqual(beforeValue);

          if (computed === 'lookup') {
            // Lookup returns array
            expect(Array.isArray(afterValue)).toBe(true);
            if (Array.isArray(afterValue)) {
              expect(afterValue).toContain(updated);
            }
          } else {
            // Rollup returns single value
            expect(afterValue).toBe(updated);
          }
        }

        // Verify computed steps
        const plan = ctx.getLastComputedPlan() as {
          steps: Array<{ tableId: string; fieldIds: string[]; level: number }>;
        };
        // Self-referencing is complex, use range verification
        const expectedSteps = getExpectedSteps(computed, 1, {
          relationship,
          direction: 'twoWay',
        });
        verifySteps(plan, expectedSteps, computedFieldId);
      }
    );
  });

  // ===========================================================================
  // Detailed Snapshot Tests
  // ===========================================================================

  describe('snapshot tests', () => {
    test('self-ref manyOne lookup - parent name change', async () => {
      const createFieldId = createFieldIdGenerator();

      const nameFieldId = createFieldId();
      const parentLinkFieldId = createFieldId();
      const parentLookupFieldId = createFieldId();

      // Create table
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'SelfManyOne_Snapshot',
        fields: [{ type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Add self-referencing link
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
            isOneWay: false,
          },
        },
      });

      // Add lookup for parent name
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

      // Create parent
      const parent = await ctx.createRecord(table.id, { [nameFieldId]: 'Manager' });

      // Create child linked to parent
      await ctx.createRecord(table.id, {
        [nameFieldId]: 'Employee',
        [parentLinkFieldId]: { id: parent.id },
      });

      await ctx.testContainer.processOutbox();

      const beforeRecords = await ctx.listRecords(table.id);
      const employee = beforeRecords.find((r) => r.fields[nameFieldId] === 'Employee');
      expect(employee?.fields[parentLookupFieldId]).toEqual(['Manager']);

      // Update parent name
      ctx.clearLogs();
      await ctx.updateRecord(table.id, parent.id, { [nameFieldId]: 'Director' });
      await ctx.testContainer.processOutbox();

      // Verify
      const afterRecords = await ctx.listRecords(table.id);
      const afterEmployee = afterRecords.find((r) => r.fields[nameFieldId] === 'Employee');
      expect(afterEmployee?.fields[parentLookupFieldId]).toEqual(['Director']);

      // Verify steps
      const plan = ctx.getLastComputedPlan() as {
        steps: Array<{ tableId: string; fieldIds: string[]; level: number }>;
      };
      expect(plan.steps.length).toBe(1);

      // Snapshot - note: self-referencing link creates symmetric field, so we see more fields
      const nameMaps = buildNameMaps({ id: table.id, name: 'SelfManyOne_Snapshot' }, [
        { id: nameFieldId, name: 'Name' },
        { id: parentLinkFieldId, name: 'Parent' },
        { id: parentLookupFieldId, name: 'ParentName' },
      ]);
      const output = printComputedSteps(plan as ComputedPlanLogEntry, nameMaps);
      expect(output).toContain('[Computed Steps: 1]');
      expect(output).toContain('SelfManyOne_Snapshot');
      expect(output).toContain('ParentName');
    });

    test('self-ref manyMany rollup - value sum', async () => {
      const createFieldId = createFieldIdGenerator();

      const nameFieldId = createFieldId();
      const valueFieldId = createFieldId();
      const linksFieldId = createFieldId();
      const sumFieldId = createFieldId();

      // Create table
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'SelfManyMany_Snapshot',
        fields: [
          { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: valueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });

      // Add self-referencing manyMany link
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'link',
          id: linksFieldId,
          name: 'Related',
          options: {
            relationship: 'manyMany',
            foreignTableId: table.id,
            lookupFieldId: nameFieldId,
            isOneWay: false,
          },
        },
      });

      // Add rollup
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'rollup',
          id: sumFieldId,
          name: 'Sum',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId: linksFieldId,
            foreignTableId: table.id,
            lookupFieldId: valueFieldId,
          },
        },
      });

      // Create records
      const record1 = await ctx.createRecord(table.id, { [nameFieldId]: 'A', [valueFieldId]: 10 });
      const record2 = await ctx.createRecord(table.id, { [nameFieldId]: 'B', [valueFieldId]: 20 });

      // Link them
      await ctx.updateRecord(table.id, record1.id, {
        [linksFieldId]: [{ id: record2.id }],
      });
      await ctx.testContainer.processOutbox();

      const beforeRecords = await ctx.listRecords(table.id);
      const recordA = beforeRecords.find((r) => r.fields[nameFieldId] === 'A');
      expect(recordA?.fields[sumFieldId]).toBe(20); // Sum of linked record B

      // Update B's value
      ctx.clearLogs();
      await ctx.updateRecord(table.id, record2.id, { [valueFieldId]: 50 });
      await ctx.testContainer.processOutbox();

      // Verify
      const afterRecords = await ctx.listRecords(table.id);
      const afterA = afterRecords.find((r) => r.fields[nameFieldId] === 'A');
      expect(afterA?.fields[sumFieldId]).toBe(50);
    });
  });
});
