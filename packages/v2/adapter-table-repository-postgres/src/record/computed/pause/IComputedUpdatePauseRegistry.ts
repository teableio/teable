import {
  COMPUTE_PAUSED_WRITE_BLOCKED_CODE,
  computedOutboxPauseWritePolicies,
  domainError,
  type ComputedOutboxPauseWritePolicy,
  type DomainError,
  type IExecutionContext,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export const COMPUTED_UPDATE_PAUSE_SCOPE_TABLE = 'computed_update_pause_scope';

export const computedUpdatePauseScopeTypes = ['space', 'base', 'table'] as const;

export type ComputedUpdatePauseScopeType = (typeof computedUpdatePauseScopeTypes)[number];

export const computedUpdatePauseWritePolicies = computedOutboxPauseWritePolicies;
export type ComputedUpdatePauseWritePolicy = ComputedOutboxPauseWritePolicy;

export const DEFAULT_COMPUTED_PAUSE_WRITE_POLICY: ComputedUpdatePauseWritePolicy = 'allow_bounded';

/** Pending outbox rows at which an `allow_bounded` pause auto-releases instead of 503ing writes. */
export const DEFAULT_COMPUTED_PAUSE_BACKLOG_WATERMARK = 1000;

export type ComputedUpdatePauseScope = {
  id: string;
  scopeType: ComputedUpdatePauseScopeType;
  scopeId: string;
  scopeName: string | null;
  baseId: string | null;
  baseName: string | null;
  spaceId: string | null;
  spaceName: string | null;
  pausedAt: Date;
  pausedBy: string | null;
  resumeAt: Date | null;
  reason: string | null;
  writePolicy: ComputedUpdatePauseWritePolicy;
  updatedAt: Date;
  updatedBy: string | null;
  active: boolean;
};

export type PauseComputedUpdateScopeParams = {
  scopeType: ComputedUpdatePauseScopeType;
  scopeId: string;
  resumeAt?: Date | null;
  reason?: string | null;
  actor?: string | null;
  writePolicy?: ComputedUpdatePauseWritePolicy;
};

export type ResumeComputedUpdateScopeParams = {
  scopeType: ComputedUpdatePauseScopeType;
  scopeId: string;
  actor?: string | null;
  releaseReason?: string | null;
};

export type ReleaseComputedUpdatePauseLeaseParams = {
  leaseId: string;
  actor?: string | null;
  releaseReason?: string | null;
};

export type ExtendComputedUpdatePauseLeaseParams = {
  leaseId: string;
  durationMs: number;
  actor?: string | null;
};

export type ListComputedUpdatePauseScopesParams = {
  activeOnly?: boolean;
  scopeTypes?: ReadonlyArray<ComputedUpdatePauseScopeType>;
};

export type AdmitComputedWriteParams = {
  tableId: string;
  baseId: string;
  backlogWatermark?: number;
};

export const parseComputedUpdatePauseWritePolicy = (
  value: string | null | undefined
): ComputedUpdatePauseWritePolicy =>
  value === 'block' ? 'block' : DEFAULT_COMPUTED_PAUSE_WRITE_POLICY;

export const computedPausedWriteBlockedError = (details: {
  leaseId: string;
  scopeType: ComputedUpdatePauseScopeType;
  scopeId: string;
  reason: string | null;
  retryAt: string | null;
}): DomainError =>
  domainError.conflict({
    code: COMPUTE_PAUSED_WRITE_BLOCKED_CODE,
    message:
      'Computation is paused; writes that require computed propagation are blocked until the pause resumes',
    details: {
      ...details,
      writePolicy: 'block' as const,
    },
  });

export interface IComputedUpdatePauseRegistry {
  pauseScope(
    params: PauseComputedUpdateScopeParams,
    context?: IExecutionContext
  ): Promise<Result<ComputedUpdatePauseScope, DomainError>>;

  resumeScope(
    params: ResumeComputedUpdateScopeParams,
    context?: IExecutionContext
  ): Promise<Result<boolean, DomainError>>;

  releaseLease(
    params: ReleaseComputedUpdatePauseLeaseParams,
    context?: IExecutionContext
  ): Promise<Result<boolean, DomainError>>;

  extendLease(
    params: ExtendComputedUpdatePauseLeaseParams,
    context?: IExecutionContext
  ): Promise<Result<ComputedUpdatePauseScope | null, DomainError>>;

  listScopes(
    params?: ListComputedUpdatePauseScopesParams,
    context?: IExecutionContext
  ): Promise<Result<ReadonlyArray<ComputedUpdatePauseScope>, DomainError>>;

  /**
   * User-write admission for a seed table. `block` fails with
   * COMPUTE_PAUSED_WRITE_BLOCKED. `allow_bounded` auto-releases at the backlog
   * watermark so a pause cannot grow into a generic 503.
   */
  admitComputedWrite(
    params: AdmitComputedWriteParams,
    context?: IExecutionContext
  ): Promise<Result<void, DomainError>>;
}

export const noopComputedUpdatePauseRegistry: IComputedUpdatePauseRegistry = {
  pauseScope: async () =>
    err(domainError.notImplemented({ message: 'Computed pause registry is not configured' })),
  resumeScope: async () => ok(false),
  releaseLease: async () => ok(false),
  extendLease: async () => ok(null),
  listScopes: async () => ok([]),
  admitComputedWrite: async () => ok(undefined),
};
