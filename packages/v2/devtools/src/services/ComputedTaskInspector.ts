import type { Effect } from 'effect';
import { Context } from 'effect';
import type { CliError } from '../errors';

export type ComputedTaskStatus = 'pending' | 'processing' | 'dead';
export type ComputedTaskTableMatch = 'seed' | 'target' | 'any';

export interface ComputedScopeInput {
  readonly baseIds?: ReadonlyArray<string>;
  readonly tableIds?: ReadonlyArray<string>;
  readonly tableMatch?: ComputedTaskTableMatch;
}

export interface ComputedQueueSummaryInput extends ComputedScopeInput {
  readonly staleHours?: number;
  readonly top?: number;
}

export interface ComputedTaskListInput extends ComputedScopeInput {
  readonly statuses?: ReadonlyArray<ComputedTaskStatus>;
  readonly staleHours?: number;
  readonly limit?: number;
  readonly offset?: number;
  readonly updatedFrom?: string;
  readonly updatedTo?: string;
}

export interface ComputedTaskDetailInput {
  readonly taskId: string;
  readonly source?: 'outbox' | 'dead-letter' | 'auto';
  readonly staleHours?: number;
}

export interface ReplayComputedQueueInput extends ComputedScopeInput {
  readonly workerId: string;
  readonly limit?: number;
  readonly top?: number;
}

export interface CliTable<Row> {
  readonly columns: ReadonlyArray<keyof Row & string>;
  readonly rows: ReadonlyArray<Row>;
}

export interface QueueStatusRow {
  status: string;
  freshness: string;
  count: number;
}

export interface QueueBaseRow {
  baseId: string;
  baseName: string;
  pending: number;
  processing: number;
  staleProcessing: number;
  dead: number;
  total: number;
}

export interface QueueTableRow {
  baseId: string;
  baseName: string;
  seedTableId: string;
  tableName: string;
  pending: number;
  processing: number;
  staleProcessing: number;
  dead: number;
  total: number;
  maxEstimatedComplexity: number;
}

export interface ComputedQueueSummaryOutput {
  readonly snapshotAt: string;
  readonly scope: {
    readonly baseIds?: ReadonlyArray<string>;
    readonly tableIds?: ReadonlyArray<string>;
    readonly tableMatch?: ComputedTaskTableMatch;
    readonly staleHours: number;
  };
  readonly totals: {
    readonly remaining: number;
    readonly pending: number;
    readonly processing: number;
    readonly staleProcessing: number;
    readonly dead: number;
  };
  readonly statusTable: CliTable<QueueStatusRow>;
  readonly baseTable: CliTable<QueueBaseRow>;
  readonly tableTable: CliTable<QueueTableRow>;
  readonly notes: ReadonlyArray<string>;
}

export interface ComputedTaskRow {
  id: string;
  source: 'outbox' | 'dead-letter';
  status: string;
  baseId: string;
  baseName: string;
  seedTableId: string;
  tableName: string;
  changeType: string;
  lockedBy: string | null;
  estimatedComplexity: number;
  runCompletedStepsBefore: number;
  runTotalSteps: number;
  stale: boolean;
  hasAllTargetRecords: boolean;
  edgeCount: number;
  updatedAt: string;
  nextRunAt: string;
  lastError: string | null;
}

export interface ComputedTaskListOutput {
  readonly snapshotAt: string;
  readonly scope: {
    readonly baseIds?: ReadonlyArray<string>;
    readonly tableIds?: ReadonlyArray<string>;
    readonly tableMatch?: ComputedTaskTableMatch;
    readonly statuses: ReadonlyArray<ComputedTaskStatus>;
    readonly staleHours: number;
    readonly limit: number;
    readonly offset: number;
    readonly updatedFrom?: string;
    readonly updatedTo?: string;
  };
  readonly total: number;
  readonly taskTable: CliTable<ComputedTaskRow>;
  readonly historyAvailable: false;
  readonly notes: ReadonlyArray<string>;
}

export interface TaskEdgeModeRow {
  mode: string;
  count: number;
}

export interface TaskTargetRow {
  targetTableId: string;
  targetTableName: string;
  edgeCount: number;
}

export interface ComputedTaskDetailOutput {
  readonly snapshotAt: string;
  readonly task: ComputedTaskRow;
  readonly summary: {
    readonly stepCount: number;
    readonly edgeCount: number;
    readonly allTargetRecordsCount: number;
    readonly dirtyStatCount: number;
  };
  readonly edgeModeTable: CliTable<TaskEdgeModeRow>;
  readonly targetTable: CliTable<TaskTargetRow>;
  readonly notes: ReadonlyArray<string>;
}

export interface ReplayComputedQueueOutput {
  readonly scope: {
    readonly baseIds?: ReadonlyArray<string>;
    readonly tableIds?: ReadonlyArray<string>;
    readonly tableMatch?: ComputedTaskTableMatch;
    readonly workerId: string;
    readonly limit: number | null;
  };
  readonly processed: number;
  readonly initialRemaining: number;
  readonly finalRemaining: number;
  readonly elapsedMs: number;
  readonly remainingByBaseTable: CliTable<{
    readonly baseId: string;
    readonly baseName: string;
    readonly remaining: number;
  }>;
}

export class ComputedTaskInspector extends Context.Tag('ComputedTaskInspector')<
  ComputedTaskInspector,
  {
    readonly getQueueSummary: (
      input: ComputedQueueSummaryInput
    ) => Effect.Effect<ComputedQueueSummaryOutput, CliError>;
    readonly listTasks: (
      input: ComputedTaskListInput
    ) => Effect.Effect<ComputedTaskListOutput, CliError>;
    readonly getTaskDetail: (
      input: ComputedTaskDetailInput
    ) => Effect.Effect<ComputedTaskDetailOutput, CliError>;
    readonly replayQueue: (
      input: ReplayComputedQueueInput
    ) => Effect.Effect<ReplayComputedQueueOutput, CliError>;
  }
>() {}
