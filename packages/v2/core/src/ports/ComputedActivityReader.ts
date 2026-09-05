import type { Result } from 'neverthrow';
import type { ComputeReliability } from '../domain/computed/ComputeReliability';

import type { FieldComputeMetaDto } from '../domain/computed/FieldComputeMeta';
import type { TableComputeMetaDto } from '../domain/computed/TableComputeMeta';
import type { DomainError } from '../domain/shared/DomainError';
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
  /** Internal scheduler signal; never serialized by the public mapper. */
  reconciliationPerformed?: boolean;
  /** SQL summary already uses the requested readable field scope. Never serialize this marker. */
  reliabilityIsAccessScoped?: boolean;
  observedAt?: string;
  observationState?: 'available' | 'syncing' | 'unavailable';
  tableId: string;
  baseId: string;
  table: TableComputeMetaDto | null;
  fields: FieldComputeMetaDto[];
  diagnostics: {
    reliability?: ComputeReliability;
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
    baseId?: string,
    options?: {
      budgetMs?: number;
      readableFieldIds?: readonly string[];
      includePauseDiagnostics?: boolean;
    }
  ): Promise<Result<TableComputeActivitySnapshot, DomainError>>;
}

export const HIGH_COMPLEXITY_THRESHOLD = 500;
