import type { RecordId, TableId } from '@teable/v2-core';

import type {
  ComputedDependencyEdge,
  ComputedSeedGroup,
  ComputedUpdatePlan,
  SameTableBatch,
  UpdateStep,
} from './ComputedUpdatePlanner';

/**
 * Resource budget for a single computed-update stage transaction.
 * A value of 0 disables that dimension; staging is off when every dimension is 0.
 */
export type ComputedStageBudget = {
  maxSteps: number;
  maxFields: number;
  maxEdges: number;
};

export type ComputedStagePlanSplit = {
  /** Bounded plan to execute in the current transaction. */
  stagePlan: ComputedUpdatePlan;
  /**
   * Remainder of the plan, or null when the whole plan fits the budget.
   * Deferred steps keep their original dependency levels so a follow-up task
   * executes them in the same topological order. A step whose field list was
   * hard-split appears in both halves with disjoint field subsets.
   */
  deferred: {
    steps: ReadonlyArray<UpdateStep>;
    edges: ReadonlyArray<ComputedDependencyEdge>;
    sameTableBatches: ReadonlyArray<SameTableBatch>;
  } | null;
};

const isComputedStageBudgetEnabled = (budget: ComputedStageBudget): boolean =>
  budget.maxSteps > 0 || budget.maxFields > 0 || budget.maxEdges > 0;

/**
 * Scale the stage budget up for provably-small runs.
 *
 * The static budgets are volume-blind: a cascade touching a hundred rows is
 * sliced exactly like one touching a hundred thousand, and every slice pays the
 * full task pipeline (claim, locks, markDone, activity projection, enqueue).
 * When the plan's estimated complexity (steps + edges + seed records) and the
 * task's planned dirty volume are both small, multiply the budgets so the run
 * fits in a few slices instead of a dozen. Whole-table seeds never qualify —
 * their volume is unknown upfront. Misestimates degrade gracefully: the dirty
 * budget aborts an over-budget stage before any step commits and the worker's
 * shrink loop re-splits with fewer steps.
 */
export const resolveAdaptiveStageBudget = (
  base: ComputedStageBudget,
  run: {
    estimatedComplexity: number;
    dirtyRecordEstimate: number;
    hasSeedAllTables: boolean;
  },
  config: { smallRunComplexityThreshold: number; smallRunBudgetMultiplier: number }
): ComputedStageBudget => {
  const threshold = config.smallRunComplexityThreshold;
  const multiplier = config.smallRunBudgetMultiplier;
  if (threshold <= 0 || multiplier <= 1) return base;
  if (run.hasSeedAllTables) return base;
  if (run.estimatedComplexity <= 0 || run.estimatedComplexity > threshold) return base;
  if (run.dirtyRecordEstimate > threshold) return base;

  const scale = (value: number): number => (value > 0 ? value * multiplier : value);
  return {
    maxSteps: scale(base.maxSteps),
    maxFields: scale(base.maxFields),
    maxEdges: scale(base.maxEdges),
  };
};

/**
 * Upper bound of explicit insert seeds that may probe multiple dependency
 * levels in one abort-mode stage. Larger inserts stay clamped so import-scale
 * fanout cannot commit an incomplete upstream set into a later level.
 */
export const MAX_EXPLICIT_INSERT_SEEDS_FOR_MULTI_LEVEL_PROBE = 16;

/** Volume context for the one-level clamp decision (both optional/0 = unknown). */
export interface OneLevelClampVolumeContext {
  /** Predicted dirty rows for this task (sum of its dirtyStats). */
  readonly dirtyRecordEstimate?: number;
  /** Abort-mode stage budget the probe must fit into. */
  readonly stageMaxDirtyRecords?: number;
}

/**
 * Whether a dirty-budgeted stage must commit one dependency level before the next.
 *
 * Floor partial batches make later levels observe an incomplete upstream set, so
 * deletes, bulk inserts, whole-table seeds, and non-traversal edges stay clamped.
 * Explicit-seed updates — and small explicit-seed inserts — whose graph is already
 * a complete linkTraversal cascade can probe multiple levels in one abort-mode
 * transaction: overflow rolls back with zero writes, then the worker reclamps.
 * T6648's unrestricted first-attempt probe skipped this filter and broke
 * import/delete replan plus the JSON-formula double-compute guard — keep those
 * graphs clamped.
 */
export const shouldClampToOneDependencyLevel = (
  plan: ComputedUpdatePlan,
  volume?: OneLevelClampVolumeContext
): boolean => {
  if (plan.changeType === 'delete') return true;
  if ((plan.seedAllTableIds?.length ?? 0) > 0) return true;
  if (plan.edges.some((edge) => edge.propagationMode && edge.propagationMode !== 'linkTraversal')) {
    return true;
  }
  const explicitSeedCount = countPlanSeedRecords(plan);
  if (explicitSeedCount === 0) return true;
  if (plan.changeType === 'insert') {
    // INSERT seeds only the new host rows (seedInsertOnly in
    // ComputedFieldUpdater); extraSeedRecords are the linked foreign rows and
    // add no probe volume, so meter the gate on the seeds that actually run.
    const insertSeedCount = new Set(plan.seedRecordIds.map((id) => id.toString())).size;
    if (insertSeedCount === 0) return true;
    if (insertSeedCount > MAX_EXPLICIT_INSERT_SEEDS_FOR_MULTI_LEVEL_PROBE) return true;
    // A probe whose predicted dirty volume already exceeds the abort budget can
    // only buy a rolled-back transaction before the reclamp — keep it clamped.
    // This also covers fanout-split children: seed chunking shrinks the seed
    // count but their dirtyStats keep a proportional share of the cascade.
    const estimate = volume?.dirtyRecordEstimate ?? 0;
    const budget = volume?.stageMaxDirtyRecords ?? 0;
    return estimate > 0 && budget > 0 && estimate > budget;
  }
  return false;
};

/** Merge seed groups by table, deduplicating record ids (stable order). */
export const mergeComputedSeedGroups = (
  base: ReadonlyArray<ComputedSeedGroup>,
  incoming: ReadonlyArray<ComputedSeedGroup>
): ComputedSeedGroup[] => {
  const byTable = new Map<string, { tableId: TableId; recordIds: RecordId[] }>();
  const seenByTable = new Map<string, Set<string>>();
  for (const group of [...base, ...incoming]) {
    const tableKey = group.tableId.toString();
    let entry = byTable.get(tableKey);
    let seen = seenByTable.get(tableKey);
    if (!entry || !seen) {
      entry = { tableId: group.tableId, recordIds: [] };
      seen = new Set();
      byTable.set(tableKey, entry);
      seenByTable.set(tableKey, seen);
    }
    for (const recordId of group.recordIds) {
      const recordKey = recordId.toString();
      if (seen.has(recordKey)) continue;
      seen.add(recordKey);
      entry.recordIds.push(recordId);
    }
  }
  return [...byTable.values()].filter((group) => group.recordIds.length > 0);
};

const stepKeyOf = (step: UpdateStep): string => `${step.tableId.toString()}|${step.level}`;

const countPlanSeedRecords = (plan: ComputedUpdatePlan): number =>
  plan.seedRecordIds.length +
  plan.extraSeedRecords.reduce((sum, group) => sum + group.recordIds.length, 0);

/**
 * Field-granular target keys of a propagation edge, or null when unknown
 * (payloads serialized before propagationTargetFieldIds existed). Unknown
 * targets force table-granular partitioning for that edge.
 */
const edgeTargetFieldKeys = (edge: ComputedDependencyEdge): string[] | null => {
  if (!edge.propagationTargetFieldIds || edge.propagationTargetFieldIds.length === 0) return null;
  const keys = new Set(edge.propagationTargetFieldIds.map((fieldId) => fieldId.toString()));
  keys.add(edge.toFieldId.toString());
  return [...keys];
};

const collectStepFieldKeys = (steps: ReadonlyArray<UpdateStep>): Set<string> => {
  const keys = new Set<string>();
  for (const step of steps) {
    for (const fieldId of step.fieldIds) {
      keys.add(fieldId.toString());
    }
  }
  return keys;
};

/** Retained field keys per step key, so field-split steps filter batches correctly. */
const collectRetainedFieldsByStepKey = (
  steps: ReadonlyArray<UpdateStep>
): Map<string, Set<string>> => {
  const retained = new Map<string, Set<string>>();
  for (const step of steps) {
    const key = stepKeyOf(step);
    const fields = retained.get(key) ?? new Set<string>();
    for (const fieldId of step.fieldIds) {
      fields.add(fieldId.toString());
    }
    retained.set(key, fields);
  }
  return retained;
};

const splitSameTableBatches = (
  batches: ReadonlyArray<SameTableBatch>,
  retainedFieldsByStepKey: ReadonlyMap<string, ReadonlySet<string>>
): SameTableBatch[] => {
  const result: SameTableBatch[] = [];
  for (const batch of batches) {
    const steps: UpdateStep[] = [];
    for (const step of batch.steps) {
      const retained = retainedFieldsByStepKey.get(stepKeyOf(step));
      if (!retained) continue;
      const fieldIds = step.fieldIds.filter((fieldId) => retained.has(fieldId.toString()));
      if (fieldIds.length === 0) continue;
      steps.push(fieldIds.length === step.fieldIds.length ? step : { ...step, fieldIds });
    }
    if (steps.length === 0) continue;
    result.push({
      tableId: batch.tableId,
      steps,
      minLevel: Math.min(...steps.map((step) => step.level)),
      maxLevel: Math.max(...steps.map((step) => step.level)),
    });
  }
  return result;
};

/**
 * Split a dependency plan into a budget-bounded stage plan plus a deferred remainder.
 *
 * Steps are taken as a level-ordered prefix, so every executed field has all of its
 * upstream dependencies committed in the same stage or an earlier one. A first step
 * that alone exceeds maxFields is hard-split by fields (same-level fields are
 * mutually independent), making maxFields a true per-transaction cap. Propagation
 * edges partition by target field where the (deduplicated) target list is known;
 * edges from legacy payloads without target info partition by target table.
 */
export const splitComputedPlanForStageBudget = (
  plan: ComputedUpdatePlan,
  budget: ComputedStageBudget
): ComputedStagePlanSplit => {
  if (!isComputedStageBudgetEnabled(budget)) {
    return { stagePlan: plan, deferred: null };
  }

  const orderedSteps = [...plan.steps].sort((a, b) => a.level - b.level);

  const edgesByTargetField = new Map<string, number[]>();
  const edgesByTargetTable = new Map<string, number[]>();
  plan.edges.forEach((edge, index) => {
    const targetKeys = edgeTargetFieldKeys(edge);
    if (targetKeys) {
      for (const fieldKey of targetKeys) {
        const indices = edgesByTargetField.get(fieldKey) ?? [];
        indices.push(index);
        edgesByTargetField.set(fieldKey, indices);
      }
      return;
    }
    const tableKey = edge.toTableId.toString();
    const indices = edgesByTargetTable.get(tableKey) ?? [];
    indices.push(index);
    edgesByTargetTable.set(tableKey, indices);
  });

  const stageSteps: UpdateStep[] = [];
  const stageTableKeys = new Set<string>();
  const stageEdgeIndices = new Set<number>();
  let stageFieldCount = 0;
  let deferredLeadStep: UpdateStep | null = null;
  let consumedStepCount = 0;

  // Edges into fields/tables hosting no step at all default to the current
  // stage (subject to the hard cap below, where their overflow defers as an
  // edge-only continuation); count them against the edge budget upfront so
  // stageMaxEdges reflects the SQL that will actually execute.
  const allStepFieldKeys = collectStepFieldKeys(orderedSteps);
  const allStepTableKeys = new Set(orderedSteps.map((step) => step.tableId.toString()));
  const edgeTargetsAnyOf = (
    edge: ComputedDependencyEdge,
    fieldKeys: ReadonlySet<string>,
    tableKeys: ReadonlySet<string>
  ): boolean => {
    const targetKeys = edgeTargetFieldKeys(edge);
    if (targetKeys) return targetKeys.some((key) => fieldKeys.has(key));
    return tableKeys.has(edge.toTableId.toString());
  };
  plan.edges.forEach((edge, index) => {
    if (!edgeTargetsAnyOf(edge, allStepFieldKeys, allStepTableKeys)) stageEdgeIndices.add(index);
  });

  const collectNewEdgeIndices = (step: UpdateStep): number[] => {
    const indices: number[] = [];
    for (const fieldId of step.fieldIds) {
      for (const index of edgesByTargetField.get(fieldId.toString()) ?? []) {
        if (!stageEdgeIndices.has(index) && !indices.includes(index)) indices.push(index);
      }
    }
    if (!stageTableKeys.has(step.tableId.toString())) {
      for (const index of edgesByTargetTable.get(step.tableId.toString()) ?? []) {
        if (!stageEdgeIndices.has(index) && !indices.includes(index)) indices.push(index);
      }
    }
    return indices;
  };

  const takeStep = (step: UpdateStep, newEdgeIndices: number[]): void => {
    stageSteps.push(step);
    stageTableKeys.add(step.tableId.toString());
    stageFieldCount += step.fieldIds.length;
    for (const index of newEdgeIndices) stageEdgeIndices.add(index);
  };

  for (const step of orderedSteps) {
    const newEdgeIndices = collectNewEdgeIndices(step);
    const withinSteps = budget.maxSteps <= 0 || stageSteps.length < budget.maxSteps;
    const withinFields =
      budget.maxFields <= 0 || stageFieldCount + step.fieldIds.length <= budget.maxFields;
    const withinEdges =
      budget.maxEdges <= 0 || stageEdgeIndices.size + newEdgeIndices.length <= budget.maxEdges;

    if (withinSteps && withinFields && withinEdges) {
      takeStep(step, newEdgeIndices);
      consumedStepCount += 1;
      continue;
    }

    if (stageSteps.length > 0) break;

    // First step over budget: hard-split by fields when the field or edge budget
    // is the binding constraint; otherwise run it whole so every stage progresses.
    // Greedy in field order, so the taken set is a prefix and the remainder step
    // carries the rest at the same level. A single field's edges are irreducible.
    if (budget.maxFields > 0 || budget.maxEdges > 0) {
      const countedEdges = new Set<number>(stageEdgeIndices);
      const tableEdgeIndices = (edgesByTargetTable.get(step.tableId.toString()) ?? []).filter(
        (index) => !countedEdges.has(index)
      );
      const takenFieldIds: (typeof step.fieldIds)[number][] = [];
      for (const fieldId of step.fieldIds) {
        const newEdges = (edgesByTargetField.get(fieldId.toString()) ?? []).filter(
          (index) => !countedEdges.has(index)
        );
        // Table-granular (legacy) edges attach with the first field taken.
        const newEdgeTotal =
          newEdges.length + (takenFieldIds.length === 0 ? tableEdgeIndices.length : 0);
        const withinFieldBudget = budget.maxFields <= 0 || takenFieldIds.length < budget.maxFields;
        const withinEdgeBudget =
          budget.maxEdges <= 0 || countedEdges.size + newEdgeTotal <= budget.maxEdges;
        if (takenFieldIds.length > 0 && !(withinFieldBudget && withinEdgeBudget)) break;
        takenFieldIds.push(fieldId);
        for (const index of newEdges) countedEdges.add(index);
        if (takenFieldIds.length === 1) {
          for (const index of tableEdgeIndices) countedEdges.add(index);
        }
      }

      if (takenFieldIds.length < step.fieldIds.length) {
        const partialStep = { ...step, fieldIds: takenFieldIds };
        takeStep(partialStep, collectNewEdgeIndices(partialStep));
        deferredLeadStep = { ...step, fieldIds: step.fieldIds.slice(takenFieldIds.length) };
        consumedStepCount += 1;
        break;
      }
    }

    takeStep(step, newEdgeIndices);
    consumedStepCount += 1;
    break;
  }

  const remainingSteps = orderedSteps.slice(consumedStepCount);
  if (
    !deferredLeadStep &&
    remainingSteps.length === 0 &&
    // Even a fully-consumed plan must pass the hard edge cap below.
    (budget.maxEdges <= 0 || plan.edges.length <= budget.maxEdges)
  ) {
    return { stagePlan: plan, deferred: null };
  }

  const deferredSteps: UpdateStep[] = deferredLeadStep
    ? [deferredLeadStep, ...remainingSteps]
    : remainingSteps;

  const stageFieldKeys = collectStepFieldKeys(stageSteps);
  const deferredFieldKeys = collectStepFieldKeys(deferredSteps);
  const deferredTableKeys = new Set(deferredSteps.map((step) => step.tableId.toString()));

  // Edges into fields/tables with no step at all (e.g. delete plans that
  // filtered seed-table steps) default to the stage plan here; the hard cap
  // below may still defer their overflow as an edge-only continuation.
  const isEdgeInStage = (edge: ComputedDependencyEdge): boolean =>
    edgeTargetsAnyOf(edge, stageFieldKeys, stageTableKeys) ||
    !edgeTargetsAnyOf(edge, deferredFieldKeys, deferredTableKeys);
  const isEdgeInDeferred = (edge: ComputedDependencyEdge): boolean =>
    edgeTargetsAnyOf(edge, deferredFieldKeys, deferredTableKeys);

  let stageEdges = plan.edges.filter(isEdgeInStage);
  let deferredEdges = plan.edges.filter(isEdgeInDeferred);
  let finalStageSteps: UpdateStep[] = stageSteps;
  let finalDeferredSteps: UpdateStep[] = deferredSteps;

  // Hard edge cap over ALL stage edges — orphan edges included. Overflow edges
  // defer; edge-only continuations (a plan with edges but no steps) make that
  // safe even for orphans, since propagation alone is executable work. For an
  // overflowed FIELD edge the hosting field must not compute before all of its
  // edges have propagated, so the field itself moves to the deferred stage when
  // no retained stage field depends on it — the final chunk then computes it
  // exactly once over the accumulated dirty targets, instead of every chunk
  // recomputing the previous chunks' rows. Only when a retained stage field
  // depends on the hosting field (it must compute now) does the deferred stage
  // carry a duplicate field step, re-computing overflow targets later.
  if (budget.maxEdges > 0 && stageEdges.length > budget.maxEdges) {
    const keptEdges = stageEdges.slice(0, budget.maxEdges);
    const overflowEdges = stageEdges.slice(budget.maxEdges);
    stageEdges = keptEdges;
    const alreadyDeferred = new Set(deferredEdges);
    deferredEdges = [
      ...deferredEdges,
      ...overflowEdges.filter((edge) => !alreadyDeferred.has(edge)),
    ];

    // Hosting fields / tables of the overflow edges (orphans host nothing).
    const overflowFieldKeys = new Set<string>();
    const overflowTableKeys = new Set<string>();
    for (const edge of overflowEdges) {
      const targetKeys = edgeTargetFieldKeys(edge);
      if (targetKeys) {
        for (const key of targetKeys) overflowFieldKeys.add(key);
      } else {
        overflowTableKeys.add(edge.toTableId.toString());
      }
    }

    const affectsField = (step: UpdateStep, fieldKey: string): boolean =>
      overflowFieldKeys.has(fieldKey) || overflowTableKeys.has(step.tableId.toString());
    const moveCandidateKeys = new Set<string>();
    for (const step of stageSteps) {
      for (const fieldId of step.fieldIds) {
        const key = fieldId.toString();
        if (affectsField(step, key)) moveCandidateKeys.add(key);
      }
    }
    // A candidate may move only if no RETAINED stage field depends on it
    // (retained = stage fields minus all candidates, so co-moving chains stay
    // movable). Dependents are read off the plan's own edges.
    const retainedFieldKeys = new Set<string>();
    const retainedTableKeys = new Set<string>();
    for (const step of stageSteps) {
      let stepRetainsFields = false;
      for (const fieldId of step.fieldIds) {
        const key = fieldId.toString();
        if (moveCandidateKeys.has(key)) continue;
        retainedFieldKeys.add(key);
        stepRetainsFields = true;
      }
      if (stepRetainsFields) retainedTableKeys.add(step.tableId.toString());
    }
    const isSafeToMove = (fieldKey: string): boolean =>
      !plan.edges.some((edge) => {
        if (edge.fromFieldId.toString() !== fieldKey) return false;
        const targetKeys = edgeTargetFieldKeys(edge);
        if (targetKeys) return targetKeys.some((key) => retainedFieldKeys.has(key));
        return retainedTableKeys.has(edge.toTableId.toString());
      });

    const movedFieldKeys = new Set<string>();
    const duplicatedFieldKeys = new Set<string>();
    for (const key of moveCandidateKeys) {
      if (isSafeToMove(key)) movedFieldKeys.add(key);
      else duplicatedFieldKeys.add(key);
    }

    const trimmedStageSteps: UpdateStep[] = [];
    for (const step of stageSteps) {
      const keptFieldIds = step.fieldIds.filter(
        (fieldId) => !movedFieldKeys.has(fieldId.toString())
      );
      if (keptFieldIds.length === 0) continue;
      trimmedStageSteps.push(
        keptFieldIds.length === step.fieldIds.length ? step : { ...step, fieldIds: keptFieldIds }
      );
    }
    finalStageSteps = trimmedStageSteps;

    const deferredByStepKey = new Map(finalDeferredSteps.map((step) => [stepKeyOf(step), step]));
    const extraDeferredSteps: UpdateStep[] = [];
    for (const step of stageSteps) {
      const existingDeferred = deferredByStepKey.get(stepKeyOf(step));
      const existingFieldKeys = new Set(
        existingDeferred?.fieldIds.map((fieldId) => fieldId.toString()) ?? []
      );
      const neededFieldIds = step.fieldIds.filter((fieldId) => {
        const key = fieldId.toString();
        if (existingFieldKeys.has(key)) return false;
        return movedFieldKeys.has(key) || duplicatedFieldKeys.has(key);
      });
      if (neededFieldIds.length === 0) continue;
      if (existingDeferred) {
        deferredByStepKey.set(stepKeyOf(step), {
          ...existingDeferred,
          fieldIds: [...existingDeferred.fieldIds, ...neededFieldIds],
        });
      } else {
        extraDeferredSteps.push({ ...step, fieldIds: neededFieldIds });
      }
    }
    finalDeferredSteps = [...extraDeferredSteps, ...deferredByStepKey.values()].sort(
      (a, b) => a.level - b.level
    );
  }

  if (finalDeferredSteps.length === 0 && deferredEdges.length === 0) {
    return { stagePlan: plan, deferred: null };
  }

  const seedRecordCount = countPlanSeedRecords(plan);

  return {
    stagePlan: {
      ...plan,
      steps: finalStageSteps,
      edges: stageEdges,
      sameTableBatches: splitSameTableBatches(
        plan.sameTableBatches,
        collectRetainedFieldsByStepKey(finalStageSteps)
      ),
      estimatedComplexity: finalStageSteps.length + stageEdges.length + seedRecordCount,
    },
    deferred: {
      steps: finalDeferredSteps,
      edges: deferredEdges,
      sameTableBatches: splitSameTableBatches(
        plan.sameTableBatches,
        collectRetainedFieldsByStepKey(finalDeferredSteps)
      ),
    },
  };
};

/**
 * Build the continuation plan for the deferred remainder of a split stage.
 *
 * Seeds (original plan seeds, stage dirty records, and seed-all tables alike) are
 * narrowed to tables the deferred work can still read from: source tables of
 * deferred edges (direct dependencies on the original mutation) and tables hosting
 * deferred steps (same-table same-record chains have no cross-record edge to
 * witness them). If narrowing would leave the continuation with no seeds at all,
 * seeds are kept unnarrowed — an empty seed set would flip execution into
 * schema-update "seed everything" semantics. Must be enqueued in the same
 * transaction that commits the stage.
 */
export const buildDeferredStagePlan = (params: {
  plan: ComputedUpdatePlan;
  deferred: NonNullable<ComputedStagePlanSplit['deferred']>;
  dirtySeedGroups: ReadonlyArray<ComputedSeedGroup>;
  dirtySeedAllTableIds: ReadonlyArray<TableId>;
}): ComputedUpdatePlan => {
  const { plan, deferred } = params;

  const relevantSeedTableKeys = new Set<string>();
  for (const edge of deferred.edges) {
    relevantSeedTableKeys.add(edge.fromTableId.toString());
  }
  for (const step of deferred.steps) {
    relevantSeedTableKeys.add(step.tableId.toString());
  }

  const seedTableKey = plan.seedTableId.toString();

  const buildSeedState = (narrow: boolean) => {
    const isRelevant = (tableKey: string): boolean =>
      !narrow || relevantSeedTableKeys.has(tableKey);

    const seedAllByKey = new Map<string, TableId>();
    for (const tableId of [...(plan.seedAllTableIds ?? []), ...params.dirtySeedAllTableIds]) {
      const tableKey = tableId.toString();
      if (isRelevant(tableKey)) seedAllByKey.set(tableKey, tableId);
    }

    const seedRecordIds = isRelevant(seedTableKey) ? plan.seedRecordIds : ([] as RecordId[]);
    const seedRecordKeys = new Set(seedRecordIds.map((id) => id.toString()));

    const extraByTable = new Map<string, { tableId: TableId; recordIds: RecordId[] }>();
    const extraRecordKeys = new Map<string, Set<string>>();
    const appendExtraSeeds = (group: ComputedSeedGroup): void => {
      const tableKey = group.tableId.toString();
      if (!isRelevant(tableKey) || seedAllByKey.has(tableKey)) return;
      let entry = extraByTable.get(tableKey);
      let seen = extraRecordKeys.get(tableKey);
      if (!entry || !seen) {
        entry = { tableId: group.tableId, recordIds: [] };
        seen = new Set();
        extraByTable.set(tableKey, entry);
        extraRecordKeys.set(tableKey, seen);
      }
      for (const recordId of group.recordIds) {
        const recordKey = recordId.toString();
        if (seen.has(recordKey)) continue;
        if (tableKey === seedTableKey && seedRecordKeys.has(recordKey)) continue;
        seen.add(recordKey);
        entry.recordIds.push(recordId);
      }
    };

    for (const group of plan.extraSeedRecords) appendExtraSeeds(group);
    for (const group of params.dirtySeedGroups) appendExtraSeeds(group);

    return {
      seedRecordIds,
      extraSeedRecords: [...extraByTable.values()].filter((group) => group.recordIds.length > 0),
      seedAllTableIds: [...seedAllByKey.values()],
    };
  };

  let seedState = buildSeedState(true);
  if (
    seedState.seedRecordIds.length === 0 &&
    seedState.extraSeedRecords.length === 0 &&
    seedState.seedAllTableIds.length === 0
  ) {
    seedState = buildSeedState(false);
  }

  const { seedRecordIds, extraSeedRecords, seedAllTableIds } = seedState;
  const seedRecordCount =
    seedRecordIds.length + extraSeedRecords.reduce((sum, group) => sum + group.recordIds.length, 0);

  return {
    ...plan,
    steps: deferred.steps,
    edges: deferred.edges,
    sameTableBatches: deferred.sameTableBatches,
    seedRecordIds,
    extraSeedRecords,
    estimatedComplexity: deferred.steps.length + deferred.edges.length + seedRecordCount,
    cycleInfo: undefined,
    seedAllTableIds: seedAllTableIds.length > 0 ? seedAllTableIds : undefined,
    // A deferred continuation only exists after propagation completed; the
    // worker clears the run ledger with the stage (exclusions re-enter as seeds
    // SQL-side), so no per-stage durable state carries over here.
    seedAllCursors: undefined,
  };
};
