import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { FieldComputeMetaDto } from '../domain/computed/FieldComputeMeta';
import type { TableComputeMetaDto } from '../domain/computed/TableComputeMeta';
import type { IExecutionContext } from './ExecutionContext';

export type ComputeActivityAnomaly = {
  fieldId: string;
  kind: 'failed' | 'high_complexity' | 'all_target_records' | 'stale';
  message: string;
  estimatedComplexity?: number;
};

export type ComputeActivityPauseBlocker = {
  id: string;
  scopeType: 'space' | 'base' | 'table';
  scopeId: string;
  pausedAt: string;
  pausedBy: string | null;
  resumeAt: string | null;
  reason: string | null;
};

export type ComputeActivityPauseDiagnostics = {
  effective: boolean;
  blockers: ComputeActivityPauseBlocker[];
  queuedTaskCount: number;
  oldestQueuedAt: string | null;
};

export type TableComputeActivitySnapshot = {
  tableId: string;
  baseId: string;
  table: TableComputeMetaDto | null;
  fields: FieldComputeMetaDto[];
  diagnostics: {
    computeMode: 'server';
    executionState: 'running' | 'paused';
    activeFieldCount: number;
    queuedFieldCount: number;
    calculatingFieldCount: number;
    failedFieldCount: number;
    highComplexityFieldCount: number;
    anomalies: ComputeActivityAnomaly[];
    pause: ComputeActivityPauseDiagnostics;
  };
};

/**
 * Read model for projected compute activity (field/table calculating metadata).
 */
export interface IComputedActivityReader {
  getByTableId(
    context: IExecutionContext | undefined,
    tableId: string,
    baseId?: string
  ): Promise<Result<TableComputeActivitySnapshot, DomainError>>;
}

export const HIGH_COMPLEXITY_THRESHOLD = 500;
