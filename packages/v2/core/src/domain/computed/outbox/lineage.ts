import type { ComputedOutboxStorageKind } from './types';

/**
 * Lineage view over the computed-update ledger (T6908): where a task stands,
 * what source mutation triggered it, and how its run's DAG unfolds. Backed by
 * three sources — the live outbox (pending/processing), the dead-letter table,
 * and the run-history completion ledger (succeeded).
 */
export const computedOutboxLineageStates = ['pending', 'processing', 'dead', 'succeeded'] as const;
export type ComputedOutboxLineageState = (typeof computedOutboxLineageStates)[number];

export type ComputedOutboxLineageStep = {
  tableId: string;
  fieldIds: string[];
  level: number;
};

export type ComputedOutboxLineageEdge = {
  fromFieldId: string;
  toFieldId: string;
  fromTableId: string;
  toTableId: string;
  linkFieldId?: string;
  propagationMode?: string;
  /** Target field's topological level. */
  order: number;
};

export type ComputedOutboxLineageTask = {
  taskId: string;
  state: ComputedOutboxLineageState;
  baseId: string;
  seedTableId: string;
  changeType: string;
  runId: string;
  originRunIds: string[];
  stageDepth: number;
  predecessorTaskId: string | null;
  attempts: number;
  estimatedComplexity: number;
  runTotalSteps: number;
  runCompletedStepsBefore: number;
  syncMaxLevel: number | null;
  seedRecordCount: number | null;
  /** Trigger fields. Seed: changed fields. Planned leftovers: original mutation field ids. */
  sourceFieldIds: string[];
  /** Output/target fields for planned tasks; trigger fields for seed tasks. */
  affectedFieldIds: string[];
  affectedTableIds: string[];
  /** ISO timestamps. */
  sourceChangedAt: string | null;
  enqueuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  durationMs: number | null;
  lastError: string | null;
  steps: ComputedOutboxLineageStep[];
  edges: ComputedOutboxLineageEdge[];
};

export type ComputedOutboxLineageFieldRef = {
  fieldId: string;
  fieldName?: string;
  fieldType?: string;
  /** True for lookup/conditional-lookup rows; `fieldType` then holds the inner source type. */
  isLookup?: boolean;
  tableId?: string;
  /** Current field-definition dependencies (formula/lookup/rollup). */
  referencedFieldIds?: string[];
};

export type ComputedOutboxLineageTableRef = {
  tableId: string;
  tableName?: string;
};

export type ComputedOutboxLineageSummary = {
  /** Earliest source mutation across the run chain (ISO). */
  sourceChangedAt: string | null;
  /** Latest completion across the run chain (ISO); null while work is live. */
  convergedAt: string | null;
  /** convergedAt - sourceChangedAt, only when the chain has fully settled. */
  endToEndMs: number | null;
  /** True while any chain task is still pending/processing. */
  live: boolean;
  /** Trigger fields of the run, resolved from the chain's seed task. */
  sourceFieldIds: string[];
};

export type ComputedOutboxTaskLineage = {
  targetId: string;
  storage: ComputedOutboxStorageKind;
  baseId: string;
  baseName?: string;
  spaceId?: string;
  spaceName?: string;
  task: ComputedOutboxLineageTask;
  /**
   * Every ledger entry sharing the task's run lineage (run_id or
   * origin_run_ids overlap) on the same storage target, ordered by stage
   * progress. The union of the chain's steps/edges is the run's DAG.
   */
  runChain: ComputedOutboxLineageTask[];
  /** Name resolution for every field referenced by the chain. */
  fields: ComputedOutboxLineageFieldRef[];
  /** Name resolution for every table referenced by the chain. */
  tables: ComputedOutboxLineageTableRef[];
  summary: ComputedOutboxLineageSummary;
};
