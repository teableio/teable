import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type {
  ComputedOutboxAnomalyList,
  ComputedOutboxClaimConcurrency,
  ComputedOutboxOverview,
  ComputedOutboxPauseList,
  ComputedOutboxPauseScope,
  ComputedOutboxPauseSpace,
  ComputedOutboxQueueJobScanResult,
  ComputedOutboxTaskLineage,
  ComputedOutboxWorkerConcurrency,
  DiscardComputedOutboxAnomalyBatchResult,
  RecoverComputedOutboxAnomalyBatchResult,
  RecoverComputedOutboxAnomalyResult,
  ResumeComputedOutboxScopeResult,
} from '../../domain/computed/outbox';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IComputedOutboxAdmin } from '../ComputedOutboxAdmin';
import type { IExecutionContext } from '../ExecutionContext';

const NOT_CONFIGURED = 'Computed outbox admin is not configured';

const emptyOverview = (): ComputedOutboxOverview => ({
  status: 'healthy',
  reasons: [],
  sampledAt: new Date(0).toISOString(),
  config: {
    provider: 'bullmq',
    producerEnabled: false,
    consumerEnabled: false,
    monitorIntervalMs: 0,
  },
  queue: {
    configured: false,
    reachable: false,
    workers: null,
    waiting: 0,
    active: 0,
    delayed: 0,
    failed: 0,
    paused: 0,
    prioritized: 0,
    completed: 0,
    completedRetentionLimit: 0,
    failedRetentionLimit: 0,
    recentCompleted: [],
    recentFailed: [],
  },
  outbox: {
    duePending: 0,
    scheduledPending: 0,
    activeProcessing: 0,
    staleProcessing: 0,
    dead: 0,
    oldestDueAgeMs: 0,
    targetCount: 0,
    unavailableTargetCount: 0,
    storage: [],
  },
  activity: { scope: 'process' },
});

export class NoopComputedOutboxAdmin implements IComputedOutboxAdmin {
  async getOverview(
    _context: IExecutionContext,
    _input: { force?: boolean }
  ): Promise<Result<ComputedOutboxOverview, DomainError>> {
    return ok(emptyOverview());
  }

  async scanQueueJobs(
    _context: IExecutionContext,
    _states: ReadonlyArray<ComputedOutboxQueueJobScanResult['jobs'][number]['state']>
  ): Promise<Result<ComputedOutboxQueueJobScanResult, DomainError>> {
    return ok({ jobs: [], scan: [] });
  }

  async listPauses(
    _context: IExecutionContext
  ): Promise<Result<ComputedOutboxPauseList, DomainError>> {
    return ok({
      sampledAt: new Date(0).toISOString(),
      total: 0,
      unavailableTargetCount: 0,
      unavailableTargets: [],
      scopes: [],
    });
  }

  async searchPauseSpaces(
    _context: IExecutionContext,
    _input: { search: string; limit: number }
  ): Promise<Result<{ spaces: ComputedOutboxPauseSpace[] }, DomainError>> {
    return ok({ spaces: [] });
  }

  async listAnomalies(
    _context: IExecutionContext,
    _input: {
      limit: number;
      q?: string;
      kind?: ComputedOutboxAnomalyList['groups'][number]['kind'];
    }
  ): Promise<Result<ComputedOutboxAnomalyList, DomainError>> {
    return ok({
      sampledAt: new Date(0).toISOString(),
      total: 0,
      groupTotal: 0,
      matchedGroupTotal: 0,
      groups: [],
      unavailableTargetCount: 0,
    });
  }

  async getTaskLineage(): Promise<Result<ComputedOutboxTaskLineage, DomainError>> {
    return err(domainError.notImplemented({ message: NOT_CONFIGURED }));
  }

  async pauseSpace(): Promise<Result<ComputedOutboxPauseScope, DomainError>> {
    return err(domainError.notImplemented({ message: NOT_CONFIGURED }));
  }

  async resumeScope(): Promise<Result<ResumeComputedOutboxScopeResult, DomainError>> {
    return err(domainError.notImplemented({ message: NOT_CONFIGURED }));
  }

  async recoverAnomaly(): Promise<Result<RecoverComputedOutboxAnomalyResult, DomainError>> {
    return err(domainError.notImplemented({ message: NOT_CONFIGURED }));
  }

  async recoverAnomalyBatch(): Promise<
    Result<RecoverComputedOutboxAnomalyBatchResult, DomainError>
  > {
    return err(domainError.notImplemented({ message: NOT_CONFIGURED }));
  }

  async discardAnomalyBatch(): Promise<
    Result<DiscardComputedOutboxAnomalyBatchResult, DomainError>
  > {
    return err(domainError.notImplemented({ message: NOT_CONFIGURED }));
  }

  async cleanFailedJobs(): Promise<Result<{ cleaned: number }, DomainError>> {
    return err(domainError.notImplemented({ message: NOT_CONFIGURED }));
  }

  async setWorkerConcurrency(): Promise<Result<ComputedOutboxWorkerConcurrency, DomainError>> {
    return err(domainError.notImplemented({ message: NOT_CONFIGURED }));
  }

  async setClaimConcurrency(): Promise<Result<ComputedOutboxClaimConcurrency, DomainError>> {
    return err(domainError.notImplemented({ message: NOT_CONFIGURED }));
  }
}
