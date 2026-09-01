import { BaseId, FieldId, RecordId, TableId } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import {
  resolveAdaptiveStageBudget,
  buildDeferredStagePlan,
  shouldClampToOneDependencyLevel,
  MAX_EXPLICIT_INSERT_SEEDS_FOR_MULTI_LEVEL_PROBE,
  splitComputedPlanForStageBudget,
} from '../ComputedStagePlanSplitter';
import type { ComputedStageBudget } from '../ComputedStagePlanSplitter';
import type {
  ComputedDependencyEdge,
  ComputedUpdatePlan,
  UpdateStep,
} from '../ComputedUpdatePlanner';

const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
const tableA = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
const tableB = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
const tableC = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
const fieldA1 = FieldId.create(`fld${'a'.repeat(15)}1`)._unsafeUnwrap();
const fieldA2 = FieldId.create(`fld${'a'.repeat(15)}2`)._unsafeUnwrap();
const fieldB1 = FieldId.create(`fld${'b'.repeat(15)}1`)._unsafeUnwrap();
const fieldC1 = FieldId.create(`fld${'c'.repeat(15)}1`)._unsafeUnwrap();
const recordA1 = RecordId.create(`rec${'a'.repeat(15)}1`)._unsafeUnwrap();
const recordB1 = RecordId.create(`rec${'b'.repeat(15)}1`)._unsafeUnwrap();
const recordB2 = RecordId.create(`rec${'b'.repeat(15)}2`)._unsafeUnwrap();

const edge = (
  fromTableId: TableId,
  fromFieldId: FieldId,
  toTableId: TableId,
  toFieldId: FieldId,
  order: number
): ComputedDependencyEdge => ({
  fromFieldId,
  toFieldId,
  fromTableId,
  toTableId,
  propagationMode: 'linkTraversal',
  order,
});

const steps: UpdateStep[] = [
  { tableId: tableA, fieldIds: [fieldA1, fieldA2], level: 0 },
  { tableId: tableB, fieldIds: [fieldB1], level: 1 },
  { tableId: tableC, fieldIds: [fieldC1], level: 2 },
];

const edges: ComputedDependencyEdge[] = [
  edge(tableA, fieldA1, tableB, fieldB1, 0),
  edge(tableB, fieldB1, tableC, fieldC1, 1),
];

const createPlan = (overrides: Partial<ComputedUpdatePlan> = {}): ComputedUpdatePlan => ({
  baseId,
  seedTableId: tableA,
  seedRecordIds: [recordA1],
  extraSeedRecords: [],
  beforeImageRecords: [],
  steps,
  edges,
  estimatedComplexity: 6,
  changeType: 'update',
  sameTableBatches: [
    { tableId: tableA, steps: [steps[0]], minLevel: 0, maxLevel: 0 },
    { tableId: tableB, steps: [steps[1]], minLevel: 1, maxLevel: 1 },
    { tableId: tableC, steps: [steps[2]], minLevel: 2, maxLevel: 2 },
  ],
  ...overrides,
});

const budget = (overrides: Partial<ComputedStageBudget> = {}): ComputedStageBudget => ({
  maxSteps: 0,
  maxFields: 0,
  maxEdges: 0,
  ...overrides,
});

describe('splitComputedPlanForStageBudget', () => {
  it('returns the whole plan when staging is disabled', () => {
    const plan = createPlan();
    const split = splitComputedPlanForStageBudget(plan, budget());

    expect(split.stagePlan).toBe(plan);
    expect(split.deferred).toBeNull();
  });

  it('returns the whole plan when it fits the budget', () => {
    const plan = createPlan();
    const split = splitComputedPlanForStageBudget(plan, budget({ maxSteps: 10 }));

    expect(split.stagePlan).toBe(plan);
    expect(split.deferred).toBeNull();
  });

  it('takes a level-ordered step prefix and partitions edges by target table', () => {
    const plan = createPlan();
    const split = splitComputedPlanForStageBudget(plan, budget({ maxSteps: 2 }));

    expect(split.stagePlan.steps).toEqual([steps[0], steps[1]]);
    expect(split.stagePlan.edges).toEqual([edges[0]]);
    expect(split.stagePlan.sameTableBatches.map((batch) => batch.tableId)).toEqual([
      tableA,
      tableB,
    ]);
    expect(split.deferred).not.toBeNull();
    expect(split.deferred?.steps).toEqual([steps[2]]);
    expect(split.deferred?.edges).toEqual([edges[1]]);
    expect(split.deferred?.sameTableBatches.map((batch) => batch.tableId)).toEqual([tableC]);
  });

  it('keeps an edge in both partitions when its target table spans stage and deferred steps', () => {
    const bothSteps: UpdateStep[] = [
      { tableId: tableB, fieldIds: [fieldB1], level: 0 },
      { tableId: tableB, fieldIds: [fieldC1], level: 1 },
    ];
    const sharedEdge = edge(tableA, fieldA1, tableB, fieldB1, 0);
    const plan = createPlan({ steps: bothSteps, edges: [sharedEdge], sameTableBatches: [] });

    const split = splitComputedPlanForStageBudget(plan, budget({ maxSteps: 1 }));

    expect(split.stagePlan.steps).toEqual([bothSteps[0]]);
    expect(split.stagePlan.edges).toEqual([sharedEdge]);
    expect(split.deferred?.steps).toEqual([bothSteps[1]]);
    expect(split.deferred?.edges).toEqual([sharedEdge]);
  });

  it('applies the field budget across step field counts', () => {
    const plan = createPlan();
    const split = splitComputedPlanForStageBudget(plan, budget({ maxFields: 3 }));

    expect(split.stagePlan.steps).toEqual([steps[0], steps[1]]);
    expect(split.deferred?.steps).toEqual([steps[2]]);
  });

  it('applies the edge budget by counting edges into stage tables', () => {
    const plan = createPlan();
    const split = splitComputedPlanForStageBudget(plan, budget({ maxEdges: 1 }));

    expect(split.stagePlan.steps).toEqual([steps[0], steps[1]]);
    expect(split.deferred?.steps).toEqual([steps[2]]);
  });

  it('hard-splits a first step that alone exceeds the field budget', () => {
    const plan = createPlan();
    const split = splitComputedPlanForStageBudget(plan, budget({ maxFields: 1 }));

    expect(split.stagePlan.steps).toEqual([{ tableId: tableA, fieldIds: [fieldA1], level: 0 }]);
    expect(split.deferred?.steps).toEqual([
      { tableId: tableA, fieldIds: [fieldA2], level: 0 },
      steps[1],
      steps[2],
    ]);
  });

  it('splits same-table batches by retained fields when a step is field-split', () => {
    const wideStep: UpdateStep = { tableId: tableA, fieldIds: [fieldA1, fieldA2], level: 0 };
    const plan = createPlan({
      steps: [wideStep],
      edges: [],
      sameTableBatches: [{ tableId: tableA, steps: [wideStep], minLevel: 0, maxLevel: 0 }],
    });

    const split = splitComputedPlanForStageBudget(plan, budget({ maxFields: 1 }));

    expect(split.stagePlan.sameTableBatches).toEqual([
      {
        tableId: tableA,
        steps: [{ tableId: tableA, fieldIds: [fieldA1], level: 0 }],
        minLevel: 0,
        maxLevel: 0,
      },
    ]);
    expect(split.deferred?.sameTableBatches).toEqual([
      {
        tableId: tableA,
        steps: [{ tableId: tableA, fieldIds: [fieldA2], level: 0 }],
        minLevel: 0,
        maxLevel: 0,
      },
    ]);
  });

  it('partitions edges by target field when propagation targets are known', () => {
    const bothSteps: UpdateStep[] = [
      { tableId: tableB, fieldIds: [fieldB1], level: 0 },
      { tableId: tableB, fieldIds: [fieldC1], level: 1 },
    ];
    // Same target table, but this edge only feeds the deferred field.
    const deferredOnlyEdge: ComputedDependencyEdge = {
      ...edge(tableA, fieldA1, tableB, fieldC1, 0),
      propagationTargetFieldIds: [fieldC1],
    };
    const plan = createPlan({ steps: bothSteps, edges: [deferredOnlyEdge], sameTableBatches: [] });

    const split = splitComputedPlanForStageBudget(plan, budget({ maxSteps: 1 }));

    expect(split.stagePlan.edges).toEqual([]);
    expect(split.deferred?.edges).toEqual([deferredOnlyEdge]);
  });

  it('keeps a deduplicated edge in both partitions when its targets span the split', () => {
    const bothSteps: UpdateStep[] = [
      { tableId: tableB, fieldIds: [fieldB1], level: 0 },
      { tableId: tableB, fieldIds: [fieldC1], level: 1 },
    ];
    const sharedEdge: ComputedDependencyEdge = {
      ...edge(tableA, fieldA1, tableB, fieldB1, 0),
      propagationTargetFieldIds: [fieldB1, fieldC1],
    };
    const plan = createPlan({ steps: bothSteps, edges: [sharedEdge], sameTableBatches: [] });

    const split = splitComputedPlanForStageBudget(plan, budget({ maxSteps: 1 }));

    expect(split.stagePlan.edges).toEqual([sharedEdge]);
    expect(split.deferred?.edges).toEqual([sharedEdge]);
  });

  it('field-splits the first step when its edge count exceeds the edge budget', () => {
    const fieldB2 = FieldId.create(`fld${'b'.repeat(15)}2`)._unsafeUnwrap();
    const fieldB3 = FieldId.create(`fld${'b'.repeat(15)}3`)._unsafeUnwrap();
    const wideStep: UpdateStep = {
      tableId: tableB,
      fieldIds: [fieldB1, fieldB2, fieldB3],
      level: 0,
    };
    const edgeFor = (toFieldId: FieldId, order: number): ComputedDependencyEdge => ({
      ...edge(tableA, fieldA1, tableB, toFieldId, order),
      propagationTargetFieldIds: [toFieldId],
    });
    const plan = createPlan({
      steps: [wideStep],
      edges: [edgeFor(fieldB1, 0), edgeFor(fieldB2, 1), edgeFor(fieldB3, 2)],
      sameTableBatches: [],
    });

    const split = splitComputedPlanForStageBudget(plan, budget({ maxEdges: 2 }));

    expect(split.stagePlan.steps).toEqual([
      { tableId: tableB, fieldIds: [fieldB1, fieldB2], level: 0 },
    ]);
    expect(split.stagePlan.edges).toHaveLength(2);
    expect(split.deferred?.steps).toEqual([{ tableId: tableB, fieldIds: [fieldB3], level: 0 }]);
    expect(split.deferred?.edges).toHaveLength(1);
  });

  it('chunks a single field with excess edges into edge-only stages, computing the field once', () => {
    // One target field owning 5 propagation edges under maxEdges=2: the stage
    // runs exactly 2 of them as pure propagation — the hosting field MOVES to
    // the deferred stage (nothing retained depends on it), so it computes once
    // over the accumulated dirty targets instead of once per chunk.
    const manyEdges = Array.from({ length: 5 }, (_, index) => ({
      ...edge(tableA, fieldA1, tableB, fieldB1, index),
      propagationTargetFieldIds: [fieldB1],
    }));
    const plan = createPlan({
      steps: [{ tableId: tableB, fieldIds: [fieldB1], level: 0 }],
      edges: manyEdges,
    });
    const split = splitComputedPlanForStageBudget(plan, {
      maxSteps: 0,
      maxFields: 0,
      maxEdges: 2,
    });

    expect(split.stagePlan.edges).toHaveLength(2);
    // Edge-only stage: the hosting field deferred wholesale, no duplication.
    expect(split.stagePlan.steps).toHaveLength(0);
    expect(split.deferred).not.toBeNull();
    expect(split.deferred!.edges).toHaveLength(3);
    expect(split.deferred!.steps).toHaveLength(1);
    expect(split.deferred!.steps[0].fieldIds.map((id) => id.toString())).toEqual([
      fieldB1.toString(),
    ]);
    // Stage + deferred cover every edge exactly once.
    const stageOrders = split.stagePlan.edges.map((e) => e.order).sort();
    const deferredOrders = split.deferred!.edges.map((e) => e.order).sort();
    expect([...stageOrders, ...deferredOrders].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('hard-caps orphan edges via an edge-only deferred continuation', () => {
    // 5 orphan edges (no hosting step anywhere) under maxEdges=2: exactly 2 run
    // now; the other 3 defer as a step-less, edge-only continuation instead of
    // breaking the per-transaction cap.
    const orphanFieldX = FieldId.create(`fld${'x'.repeat(15)}1`)._unsafeUnwrap();
    const orphanEdges = Array.from({ length: 5 }, (_, index) => ({
      ...edge(tableA, fieldA1, tableC, orphanFieldX, index),
      propagationTargetFieldIds: [orphanFieldX],
    }));
    const plan = createPlan({
      steps: [{ tableId: tableB, fieldIds: [fieldB1], level: 0 }],
      edges: orphanEdges,
    });
    const split = splitComputedPlanForStageBudget(plan, {
      maxSteps: 0,
      maxFields: 0,
      maxEdges: 2,
    });

    expect(split.stagePlan.edges.map((e) => e.order)).toEqual([0, 1]);
    expect(split.stagePlan.steps).toHaveLength(1);
    expect(split.deferred).not.toBeNull();
    expect(split.deferred!.edges.map((e) => e.order)).toEqual([2, 3, 4]);
    // Orphans host no step: the continuation is pure propagation.
    expect(split.deferred!.steps.map((step) => step.fieldIds.length)).toEqual([]);
  });

  it('keeps edges into tables without any step in the stage plan', () => {
    const orphanEdge = edge(tableA, fieldA1, tableA, fieldA2, 2);
    const plan = createPlan({ edges: [...edges, orphanEdge] });
    // tableA hosts a step, so this exercises a table absent from deferred steps.
    const split = splitComputedPlanForStageBudget(plan, budget({ maxSteps: 2 }));

    expect(split.stagePlan.edges).toContainEqual(orphanEdge);
    expect(split.deferred?.edges).not.toContainEqual(orphanEdge);
  });
});

describe('buildDeferredStagePlan', () => {
  it('narrows seeds to tables the deferred work reads from', () => {
    const plan = createPlan();
    const split = splitComputedPlanForStageBudget(plan, budget({ maxSteps: 2 }));

    const continuation = buildDeferredStagePlan({
      plan,
      deferred: split.deferred!,
      dirtySeedGroups: [
        { tableId: tableA, recordIds: [recordA1] },
        { tableId: tableB, recordIds: [recordB1, recordB2] },
      ],
      dirtySeedAllTableIds: [],
    });

    expect(continuation.steps).toEqual([steps[2]]);
    expect(continuation.edges).toEqual([edges[1]]);
    expect(continuation.seedTableId).toBe(tableA);
    // Deferred work only reads from tableB (edge source) and tableC (deferred step);
    // tableA's original seeds and dirty rows are no longer reachable inputs.
    expect(continuation.seedRecordIds).toEqual([]);
    expect(continuation.extraSeedRecords).toEqual([
      { tableId: tableB, recordIds: [recordB1, recordB2] },
    ]);
    expect(continuation.seedAllTableIds).toBeUndefined();
    expect(continuation.beforeImageRecords).toBe(plan.beforeImageRecords);
    expect(continuation.changeType).toBe('update');
  });

  it('keeps original seeds when a deferred edge reads from the seed table', () => {
    const directEdge: ComputedDependencyEdge = {
      ...edge(tableA, fieldA1, tableC, fieldC1, 2),
      propagationTargetFieldIds: [fieldC1],
    };
    const plan = createPlan({ edges: [...edges, directEdge] });
    const split = splitComputedPlanForStageBudget(plan, budget({ maxSteps: 2 }));

    const continuation = buildDeferredStagePlan({
      plan,
      deferred: split.deferred!,
      dirtySeedGroups: [{ tableId: tableB, recordIds: [recordB1] }],
      dirtySeedAllTableIds: [],
    });

    expect(continuation.edges).toContainEqual(directEdge);
    expect(continuation.seedRecordIds).toEqual([recordA1]);
  });

  it('keeps seeds unnarrowed when narrowing would leave the continuation seedless', () => {
    // Deferred work on tableC only, but the stage produced no dirty rows at all:
    // an empty seed set would flip execution into schema-update seed-all semantics.
    const plan = createPlan();
    const split = splitComputedPlanForStageBudget(plan, budget({ maxSteps: 2 }));

    const continuation = buildDeferredStagePlan({
      plan,
      deferred: split.deferred!,
      dirtySeedGroups: [],
      dirtySeedAllTableIds: [],
    });

    expect(continuation.seedRecordIds).toEqual([recordA1]);
  });

  it('unions seed-all tables and drops their per-record groups', () => {
    const plan = createPlan({ seedAllTableIds: [tableC] });
    const split = splitComputedPlanForStageBudget(plan, budget({ maxSteps: 2 }));

    const continuation = buildDeferredStagePlan({
      plan,
      deferred: split.deferred!,
      dirtySeedGroups: [{ tableId: tableB, recordIds: [recordB1] }],
      dirtySeedAllTableIds: [tableB],
    });

    expect(continuation.seedAllTableIds?.map((id) => id.toString()).sort()).toEqual(
      [tableB.toString(), tableC.toString()].sort()
    );
    expect(continuation.extraSeedRecords).toEqual([]);
  });

  it('merges duplicate dirty groups with existing extra seeds', () => {
    const plan = createPlan({
      extraSeedRecords: [{ tableId: tableB, recordIds: [recordB1] }],
    });
    const split = splitComputedPlanForStageBudget(plan, budget({ maxSteps: 2 }));

    const continuation = buildDeferredStagePlan({
      plan,
      deferred: split.deferred!,
      dirtySeedGroups: [{ tableId: tableB, recordIds: [recordB1, recordB2] }],
      dirtySeedAllTableIds: [],
    });

    expect(continuation.extraSeedRecords).toEqual([
      { tableId: tableB, recordIds: [recordB1, recordB2] },
    ]);
  });
});

describe('resolveAdaptiveStageBudget', () => {
  const base = { maxSteps: 10, maxFields: 32, maxEdges: 12 };
  const config = { smallRunComplexityThreshold: 512, smallRunBudgetMultiplier: 4 };

  it('scales every enabled dimension for a small run', () => {
    const scaled = resolveAdaptiveStageBudget(
      base,
      { estimatedComplexity: 102, dirtyRecordEstimate: 400, hasSeedAllTables: false },
      config
    );
    expect(scaled).toEqual({ maxSteps: 40, maxFields: 128, maxEdges: 48 });
  });

  it('keeps the base budget for large runs', () => {
    const scaled = resolveAdaptiveStageBudget(
      base,
      { estimatedComplexity: 4116, dirtyRecordEstimate: 0, hasSeedAllTables: false },
      config
    );
    expect(scaled).toEqual(base);
  });

  it('keeps the base budget when the dirty estimate is large', () => {
    const scaled = resolveAdaptiveStageBudget(
      base,
      { estimatedComplexity: 102, dirtyRecordEstimate: 5000, hasSeedAllTables: false },
      config
    );
    expect(scaled).toEqual(base);
  });

  it('never treats whole-table seeds as small', () => {
    const scaled = resolveAdaptiveStageBudget(
      base,
      { estimatedComplexity: 10, dirtyRecordEstimate: 0, hasSeedAllTables: true },
      config
    );
    expect(scaled).toEqual(base);
  });

  it('leaves disabled dimensions disabled', () => {
    const scaled = resolveAdaptiveStageBudget(
      { maxSteps: 10, maxFields: 0, maxEdges: 12 },
      { estimatedComplexity: 10, dirtyRecordEstimate: 1, hasSeedAllTables: false },
      config
    );
    expect(scaled).toEqual({ maxSteps: 40, maxFields: 0, maxEdges: 48 });
  });

  it('is inert when disabled by config', () => {
    const scaled = resolveAdaptiveStageBudget(
      base,
      { estimatedComplexity: 10, dirtyRecordEstimate: 1, hasSeedAllTables: false },
      { smallRunComplexityThreshold: 0, smallRunBudgetMultiplier: 4 }
    );
    expect(scaled).toEqual(base);
  });
});

describe('shouldClampToOneDependencyLevel', () => {
  it('lets an explicit-seed linkTraversal update probe multiple levels', () => {
    expect(shouldClampToOneDependencyLevel(createPlan())).toBe(false);
  });

  it('clamps deletes so intermediate outputs can still drive replan', () => {
    expect(shouldClampToOneDependencyLevel(createPlan({ changeType: 'delete' }))).toBe(true);
  });

  it('lets a small explicit-seed linkTraversal insert probe multiple levels', () => {
    expect(shouldClampToOneDependencyLevel(createPlan({ changeType: 'insert' }))).toBe(false);
  });

  it('clamps bulk inserts past the small-seed probe limit', () => {
    const seedRecordIds = Array.from(
      { length: MAX_EXPLICIT_INSERT_SEEDS_FOR_MULTI_LEVEL_PROBE + 1 },
      (_, index) => RecordId.create(`rec${String(index).padStart(16, '0')}`)._unsafeUnwrap()
    );
    expect(
      shouldClampToOneDependencyLevel(createPlan({ changeType: 'insert', seedRecordIds }))
    ).toBe(true);
  });

  it('ignores extra seeds when metering the insert probe limit', () => {
    // INSERT seeds only the new host rows (seedInsertOnly); linked foreign
    // rows arriving as extraSeedRecords must not defeat the small-insert probe.
    const extraSeedRecords = [
      {
        tableId: tableB,
        recordIds: Array.from(
          { length: MAX_EXPLICIT_INSERT_SEEDS_FOR_MULTI_LEVEL_PROBE + 4 },
          (_, index) => RecordId.create(`recx${String(index).padStart(15, '0')}`)._unsafeUnwrap()
        ),
      },
    ];
    expect(
      shouldClampToOneDependencyLevel(createPlan({ changeType: 'insert', extraSeedRecords }))
    ).toBe(false);
  });

  it('clamps inserts that seed nothing themselves', () => {
    const extraSeedRecords = [
      { tableId: tableB, recordIds: [RecordId.create(`recy${'0'.repeat(15)}`)._unsafeUnwrap()] },
    ];
    expect(
      shouldClampToOneDependencyLevel(
        createPlan({ changeType: 'insert', seedRecordIds: [], extraSeedRecords })
      )
    ).toBe(true);
  });

  it('clamps small inserts whose predicted dirty volume exceeds the stage budget', () => {
    const plan = createPlan({ changeType: 'insert' });
    expect(
      shouldClampToOneDependencyLevel(plan, {
        dirtyRecordEstimate: 6000,
        stageMaxDirtyRecords: 5000,
      })
    ).toBe(true);
    expect(
      shouldClampToOneDependencyLevel(plan, {
        dirtyRecordEstimate: 4000,
        stageMaxDirtyRecords: 5000,
      })
    ).toBe(false);
    // Unknown volume (0) keeps the seed-count-only behavior.
    expect(
      shouldClampToOneDependencyLevel(plan, { dirtyRecordEstimate: 0, stageMaxDirtyRecords: 5000 })
    ).toBe(false);
  });

  it('clamps whole-table seeds', () => {
    expect(shouldClampToOneDependencyLevel(createPlan({ seedAllTableIds: [tableA] }))).toBe(true);
  });

  it('clamps non-traversal edges', () => {
    const allTarget = {
      ...edges[0],
      propagationMode: 'allTargetRecords' as const,
    };
    expect(shouldClampToOneDependencyLevel(createPlan({ edges: [allTarget, edges[1]] }))).toBe(
      true
    );
  });

  it('clamps when the stage has no explicit seed records', () => {
    expect(
      shouldClampToOneDependencyLevel(createPlan({ seedRecordIds: [], extraSeedRecords: [] }))
    ).toBe(true);
  });
});
