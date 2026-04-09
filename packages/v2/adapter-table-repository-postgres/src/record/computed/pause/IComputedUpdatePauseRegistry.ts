import type { DomainError, IExecutionContext } from '@teable/v2-core';
import type { Result } from 'neverthrow';

export const COMPUTED_UPDATE_PAUSE_SCOPE_TABLE = 'computed_update_pause_scope';

export const computedUpdatePauseScopeTypes = ['space', 'base', 'table'] as const;

export type ComputedUpdatePauseScopeType = (typeof computedUpdatePauseScopeTypes)[number];

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
};

export type ResumeComputedUpdateScopeParams = {
  scopeType: ComputedUpdatePauseScopeType;
  scopeId: string;
};

export type ListComputedUpdatePauseScopesParams = {
  activeOnly?: boolean;
  scopeTypes?: ReadonlyArray<ComputedUpdatePauseScopeType>;
};

export interface IComputedUpdatePauseRegistry {
  pauseScope(
    params: PauseComputedUpdateScopeParams,
    context?: IExecutionContext
  ): Promise<Result<ComputedUpdatePauseScope, DomainError>>;

  resumeScope(
    params: ResumeComputedUpdateScopeParams,
    context?: IExecutionContext
  ): Promise<Result<boolean, DomainError>>;

  listScopes(
    params?: ListComputedUpdatePauseScopesParams,
    context?: IExecutionContext
  ): Promise<Result<ReadonlyArray<ComputedUpdatePauseScope>, DomainError>>;
}
