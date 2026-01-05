import { FieldId, TableId } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import type { SameTableBatch, UpdateStep } from '../ComputedUpdatePlanner';
import type { FieldDependencyEdge } from '../FieldDependencyGraph';

// =============================================================================
// Test utilities - copied from ComputedUpdatePlanner.ts
// =============================================================================

/**
 * Build same-table batches from steps and edges.
 */
const buildSameTableBatches = (
  steps: ReadonlyArray<UpdateStep>,
  edges: ReadonlyArray<FieldDependencyEdge>
): ReadonlyArray<SameTableBatch> => {
  if (steps.length === 0) return [];

  // Build a map of cross_record dependencies for quick lookup
  const hasCrossRecordDependency = new Set<string>();
  for (const edge of edges) {
    if (edge.kind === 'cross_record') {
      hasCrossRecordDependency.add(edge.toFieldId.toString());
    }
  }

  // Group steps by table
  const stepsByTable = new Map<string, UpdateStep[]>();
  for (const step of steps) {
    const tableId = step.tableId.toString();
    if (!stepsByTable.has(tableId)) {
      stepsByTable.set(tableId, []);
    }
    stepsByTable.get(tableId)!.push(step);
  }

  const batches: SameTableBatch[] = [];

  for (const [, tableSteps] of stepsByTable) {
    const sortedSteps = [...tableSteps].sort((a, b) => a.level - b.level);

    let currentBatch: UpdateStep[] = [];
    let batchStartLevel = sortedSteps[0].level;

    for (const step of sortedSteps) {
      const hasCrossRecord = step.fieldIds.some((fieldId) =>
        hasCrossRecordDependency.has(fieldId.toString())
      );

      if (hasCrossRecord && currentBatch.length > 0) {
        batches.push({
          tableId: currentBatch[0].tableId,
          steps: currentBatch,
          minLevel: batchStartLevel,
          maxLevel: currentBatch[currentBatch.length - 1].level,
        });
        currentBatch = [step];
        batchStartLevel = step.level;
      } else {
        currentBatch.push(step);
      }
    }

    if (currentBatch.length > 0) {
      batches.push({
        tableId: currentBatch[0].tableId,
        steps: currentBatch,
        minLevel: batchStartLevel,
        maxLevel: currentBatch[currentBatch.length - 1].level,
      });
    }
  }

  batches.sort((a, b) => a.minLevel - b.minLevel);

  return batches;
};

// Fixed IDs for stable tests
const TABLE_A_ID = `tbl${'b'.repeat(16)}`;
const TABLE_B_ID = `tbl${'c'.repeat(16)}`;
const FIELD_A_ID = `fld${'d'.repeat(16)}`;
const FIELD_B_ID = `fld${'e'.repeat(16)}`;
const FIELD_C_ID = `fld${'f'.repeat(16)}`;
const FIELD_D_ID = `fld${'g'.repeat(16)}`;

const createTableId = (id: string) => TableId.create(id)._unsafeUnwrap();
const createFieldId = (id: string) => FieldId.create(id)._unsafeUnwrap();

// =============================================================================
// Tests
// =============================================================================

describe('buildSameTableBatches', () => {
  describe('basic batching', () => {
    it('returns empty array for empty steps', () => {
      const batches = buildSameTableBatches([], []);
      expect(batches).toEqual([]);
    });

    it('creates single batch for single step', () => {
      const tableId = createTableId(TABLE_A_ID);
      const fieldId = createFieldId(FIELD_A_ID);

      const steps: UpdateStep[] = [{ tableId, fieldIds: [fieldId], level: 0 }];

      const batches = buildSameTableBatches(steps, []);

      expect(batches).toHaveLength(1);
      expect(batches[0].tableId.toString()).toBe(TABLE_A_ID);
      expect(batches[0].steps).toHaveLength(1);
      expect(batches[0].minLevel).toBe(0);
      expect(batches[0].maxLevel).toBe(0);
    });

    it('batches consecutive same_record steps together', () => {
      const tableId = createTableId(TABLE_A_ID);
      const fieldA = createFieldId(FIELD_A_ID);
      const fieldB = createFieldId(FIELD_B_ID);
      const fieldC = createFieldId(FIELD_C_ID);

      const steps: UpdateStep[] = [
        { tableId, fieldIds: [fieldA], level: 0 },
        { tableId, fieldIds: [fieldB], level: 1 },
        { tableId, fieldIds: [fieldC], level: 2 },
      ];

      // All same_record edges
      const edges: FieldDependencyEdge[] = [
        {
          fromFieldId: fieldA,
          toFieldId: fieldB,
          fromTableId: tableId,
          toTableId: tableId,
          kind: 'same_record',
          semantic: 'formula_ref',
        },
        {
          fromFieldId: fieldB,
          toFieldId: fieldC,
          fromTableId: tableId,
          toTableId: tableId,
          kind: 'same_record',
          semantic: 'formula_ref',
        },
      ];

      const batches = buildSameTableBatches(steps, edges);

      expect(batches).toHaveLength(1);
      expect(batches[0].steps).toHaveLength(3);
      expect(batches[0].minLevel).toBe(0);
      expect(batches[0].maxLevel).toBe(2);
    });
  });

  describe('cross_record dependency breaks', () => {
    it('splits batch when cross_record dependency is encountered', () => {
      const tableId = createTableId(TABLE_A_ID);
      const fieldA = createFieldId(FIELD_A_ID);
      const fieldB = createFieldId(FIELD_B_ID);
      const fieldC = createFieldId(FIELD_C_ID);

      const steps: UpdateStep[] = [
        { tableId, fieldIds: [fieldA], level: 0 },
        { tableId, fieldIds: [fieldB], level: 1 },
        { tableId, fieldIds: [fieldC], level: 2 },
      ];

      // fieldB has a cross_record dependency (e.g., lookup from another table)
      const edges: FieldDependencyEdge[] = [
        {
          fromFieldId: fieldA,
          toFieldId: fieldB,
          fromTableId: tableId,
          toTableId: tableId,
          kind: 'cross_record', // This breaks the batch
          linkFieldId: createFieldId(FIELD_D_ID),
          semantic: 'lookup_source',
        },
        {
          fromFieldId: fieldB,
          toFieldId: fieldC,
          fromTableId: tableId,
          toTableId: tableId,
          kind: 'same_record',
          semantic: 'formula_ref',
        },
      ];

      const batches = buildSameTableBatches(steps, edges);

      // Should create 2 batches: [A] and [B, C]
      expect(batches).toHaveLength(2);
      expect(batches[0].steps).toHaveLength(1);
      expect(batches[0].minLevel).toBe(0);
      expect(batches[1].steps).toHaveLength(2);
      expect(batches[1].minLevel).toBe(1);
      expect(batches[1].maxLevel).toBe(2);
    });
  });

  describe('multi-table scenarios', () => {
    it('creates separate batches for different tables', () => {
      const tableAId = createTableId(TABLE_A_ID);
      const tableBId = createTableId(TABLE_B_ID);
      const fieldA = createFieldId(FIELD_A_ID);
      const fieldB = createFieldId(FIELD_B_ID);

      const steps: UpdateStep[] = [
        { tableId: tableAId, fieldIds: [fieldA], level: 0 },
        { tableId: tableBId, fieldIds: [fieldB], level: 0 },
      ];

      const batches = buildSameTableBatches(steps, []);

      expect(batches).toHaveLength(2);
      const tableIds = batches.map((b) => b.tableId.toString());
      expect(tableIds).toContain(TABLE_A_ID);
      expect(tableIds).toContain(TABLE_B_ID);
    });

    it('orders batches by minLevel across tables', () => {
      const tableAId = createTableId(TABLE_A_ID);
      const tableBId = createTableId(TABLE_B_ID);
      const fieldA = createFieldId(FIELD_A_ID);
      const fieldB = createFieldId(FIELD_B_ID);
      const fieldC = createFieldId(FIELD_C_ID);

      const steps: UpdateStep[] = [
        { tableId: tableAId, fieldIds: [fieldA], level: 0 },
        { tableId: tableBId, fieldIds: [fieldB], level: 1 },
        { tableId: tableAId, fieldIds: [fieldC], level: 2 },
      ];

      const batches = buildSameTableBatches(steps, []);

      // Table A: steps at level 0 and 2 should be in one batch
      // Table B: step at level 1 should be in another batch
      // Order by minLevel: [A (0-2), B (1)]
      expect(batches[0].minLevel).toBe(0);
      expect(batches[1].minLevel).toBe(1);
    });
  });

  describe('formula chain optimization scenario', () => {
    it('identifies optimizable formula chains', () => {
      const tableId = createTableId(TABLE_A_ID);
      const fieldA = createFieldId(FIELD_A_ID); // Base field
      const fieldB = createFieldId(FIELD_B_ID); // Formula: A + 1
      const fieldC = createFieldId(FIELD_C_ID); // Formula: B * 2
      const fieldD = createFieldId(FIELD_D_ID); // Formula: C + 3

      const steps: UpdateStep[] = [
        { tableId, fieldIds: [fieldB], level: 0 },
        { tableId, fieldIds: [fieldC], level: 1 },
        { tableId, fieldIds: [fieldD], level: 2 },
      ];

      // All same_record (formula references)
      const edges: FieldDependencyEdge[] = [
        {
          fromFieldId: fieldA,
          toFieldId: fieldB,
          fromTableId: tableId,
          toTableId: tableId,
          kind: 'same_record',
          semantic: 'formula_ref',
        },
        {
          fromFieldId: fieldB,
          toFieldId: fieldC,
          fromTableId: tableId,
          toTableId: tableId,
          kind: 'same_record',
          semantic: 'formula_ref',
        },
        {
          fromFieldId: fieldC,
          toFieldId: fieldD,
          fromTableId: tableId,
          toTableId: tableId,
          kind: 'same_record',
          semantic: 'formula_ref',
        },
      ];

      const batches = buildSameTableBatches(steps, edges);

      // Should be single batch (all formulas, same table, no cross_record)
      expect(batches).toHaveLength(1);
      expect(batches[0].steps).toHaveLength(3);
      expect(batches[0].minLevel).toBe(0);
      expect(batches[0].maxLevel).toBe(2);

      // This batch has 3 steps - good candidate for CTE optimization
      expect(batches[0].steps.length).toBeGreaterThan(1);
    });
  });
});
