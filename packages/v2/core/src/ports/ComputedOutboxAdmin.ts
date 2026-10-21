import type { Result } from 'neverthrow';

import type {
  ComputedOutboxAnomalyKind,
  ComputedOutboxAnomalyList,
  ComputedOutboxClaimConcurrency,
  ComputedOutboxOverview,
  ComputedOutboxPauseList,
  ComputedOutboxPauseScope,
  ComputedOutboxPauseScopeType,
  ComputedOutboxPauseSpace,
  ComputedOutboxQueueJobScanResult,
  ComputedOutboxQueueJobState,
  ComputedOutboxTaskLineage,
  ComputedOutboxWorkerConcurrency,
  DiscardComputedOutboxAnomalyBatchResult,
  RecoverComputedOutboxAnomalyBatchResult,
  RecoverComputedOutboxAnomalyResult,
  ResumeComputedOutboxScopeResult,
} from '../domain/computed/outbox';
import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';

export type ListComputedOutboxAnomaliesFilter = {
  limit: number;
  q?: string;
  kind?: ComputedOutboxAnomalyKind;
};

export interface IComputedOutboxAdmin {
  getOverview(
    context: IExecutionContext,
    input: { force?: boolean }
  ): Promise<Result<ComputedOutboxOverview, DomainError>>;

  scanQueueJobs(
    context: IExecutionContext,
    states: ReadonlyArray<ComputedOutboxQueueJobState>
  ): Promise<Result<ComputedOutboxQueueJobScanResult, DomainError>>;

  listPauses(context: IExecutionContext): Promise<Result<ComputedOutboxPauseList, DomainError>>;

  searchPauseSpaces(
    context: IExecutionContext,
    input: { search: string; limit: number }
  ): Promise<Result<{ spaces: ComputedOutboxPauseSpace[] }, DomainError>>;

  listAnomalies(
    context: IExecutionContext,
    input: ListComputedOutboxAnomaliesFilter
  ): Promise<Result<ComputedOutboxAnomalyList, DomainError>>;

  /**
   * Resolve one task's lineage (source mutation, run chain, DAG plan) across
   * the live outbox, dead letters, and the run-history completion ledger.
   * Returns notFound when the task exists in no storage target's ledger.
   */
  getTaskLineage(
    context: IExecutionContext,
    input: { taskId: string }
  ): Promise<Result<ComputedOutboxTaskLineage, DomainError>>;

  pauseSpace(
    context: IExecutionContext,
    input: { spaceId: string; reason?: string; durationMinutes?: number; actor: string | null }
  ): Promise<Result<ComputedOutboxPauseScope, DomainError>>;

  extendPause(
    context: IExecutionContext,
    input: { targetId: string; leaseId: string; durationMinutes: number; actor: string | null }
  ): Promise<Result<ComputedOutboxPauseScope, DomainError>>;

  resumeScope(
    context: IExecutionContext,
    input: { targetId: string; scopeType: ComputedOutboxPauseScopeType; scopeId: string }
  ): Promise<Result<ResumeComputedOutboxScopeResult, DomainError>>;

  recoverAnomaly(
    context: IExecutionContext,
    input: { targetId: string; taskId: string; kind: ComputedOutboxAnomalyKind }
  ): Promise<Result<RecoverComputedOutboxAnomalyResult, DomainError>>;

  recoverAnomalyBatch(
    context: IExecutionContext,
    input: { targetId: string; baseId: string; seedTableId: string; errorSignature: string }
  ): Promise<Result<RecoverComputedOutboxAnomalyBatchResult, DomainError>>;

  discardAnomalyBatch(
    context: IExecutionContext,
    input: { targetId: string; baseId: string; seedTableId: string; errorSignature: string }
  ): Promise<Result<DiscardComputedOutboxAnomalyBatchResult, DomainError>>;

  cleanFailedJobs(context: IExecutionContext): Promise<Result<{ cleaned: number }, DomainError>>;

  setWorkerConcurrency(
    context: IExecutionContext,
    concurrency: number | null
  ): Promise<Result<ComputedOutboxWorkerConcurrency, DomainError>>;

  setClaimConcurrency(
    context: IExecutionContext,
    input: { perBase: number | null; perSeedTable: number | null }
  ): Promise<Result<ComputedOutboxClaimConcurrency, DomainError>>;
}
