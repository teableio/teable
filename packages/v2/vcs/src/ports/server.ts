import type {
  BaseId,
  DomainError,
  IExecutionContext,
  RecordQueryPluginScope,
  Table,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';

import type { IVcsPullCursor } from '../domain/cursor';

export type { IVcsPullCursor } from '../domain/cursor';
import type {
  IBaseVcsPatch,
  IBaseVcsPatchSummary,
  ITableAccessScope,
  IVcsStoredChange,
  VcsChangeOpKind,
  VcsEntityType,
} from '../domain/types';

export interface IVcsHeadState {
  readonly enabled: boolean;
  readonly headRevision: number;
  readonly minRetainedSeq: number;
  readonly minRetainedXid: string;
}

export interface IVcsEnableResult {
  readonly enabledAtRevision: number;
}

export interface IVcsChangeRowInput {
  readonly tableId: string;
  readonly entityType: VcsEntityType;
  readonly entityId: string;
  readonly fieldId?: string | null;
  readonly opKind: VcsChangeOpKind;
  readonly actorId?: string | null;
  readonly beforeValue?: unknown;
  readonly afterValue?: unknown;
}

export interface IVcsChangePage {
  readonly cursor: IVcsPullCursor;
  readonly encodedCursor: string;
  readonly headRevision: number;
  readonly originPushIds: readonly string[];
  readonly requiresFullSync: boolean;
  readonly hasMore?: boolean;
  readonly changes: readonly IVcsStoredChange[];
}

export interface IVcsCommitInput {
  readonly expectedHeadRevision: number;
  readonly commitId?: string;
  readonly originPushId: string;
  readonly actorId: string;
  readonly message?: string;
  /** Reserved for future commit DAG support. */
  readonly parents?: readonly number[];
  readonly summary: IBaseVcsPatchSummary;
}

export interface IVcsCommit {
  readonly commitId: string;
  readonly baseId: string;
  readonly revision: number;
  readonly parentRevision: number;
  readonly parents: readonly number[];
  readonly seqUpto: number;
  readonly originPushId?: string | null;
  readonly actorId: string;
  readonly message?: string | null;
  readonly summary: IBaseVcsPatchSummary;
  readonly createdAt: string;
}

export interface IVcsPushPhysicalTableLockTarget {
  readonly dbTableName: string;
  readonly recordIds?: readonly string[];
  readonly keyColumn?: string;
}

export interface IVcsPushMetadataLockTargets {
  readonly tableIds: readonly string[];
  readonly fieldIds: readonly string[];
  readonly viewIds: readonly string[];
}

export interface IBaseVcsLogRepository {
  getHead(ctx: IExecutionContext, baseId: BaseId): Promise<Result<IVcsHeadState, DomainError>>;
  isEnabled(ctx: IExecutionContext, baseId: BaseId): Promise<Result<boolean, DomainError>>;
  enable(ctx: IExecutionContext, baseId: BaseId): Promise<Result<IVcsEnableResult, DomainError>>;
  appendChanges(
    ctx: IExecutionContext,
    baseId: BaseId,
    changes: readonly IVcsChangeRowInput[],
    options?: { readonly originPushId?: string; readonly bumpHeadRevision?: boolean }
  ): Promise<Result<void, DomainError>>;
  capturePullCursor(
    ctx: IExecutionContext,
    baseId: BaseId,
    options?: { readonly tableIds?: readonly string[] }
  ): Promise<Result<IVcsPullCursor, DomainError>>;
  listChangesSince(
    ctx: IExecutionContext,
    baseId: BaseId,
    cursor: IVcsPullCursor,
    limit: number,
    options?: { readonly tableIds?: readonly string[] }
  ): Promise<Result<IVcsChangePage, DomainError>>;
  lockPushMetadata(
    ctx: IExecutionContext,
    baseId: BaseId,
    targets: IVcsPushMetadataLockTargets
  ): Promise<Result<IVcsHeadState, DomainError>>;
  lockPushPhysicalTargets(
    ctx: IExecutionContext,
    baseId: BaseId,
    physicalTargets: readonly IVcsPushPhysicalTableLockTarget[]
  ): Promise<Result<void, DomainError>>;
  findCommitByOriginPushId(
    ctx: IExecutionContext,
    baseId: BaseId,
    originPushId: string
  ): Promise<Result<IVcsCommit | null, DomainError>>;
  appendCommit(
    ctx: IExecutionContext,
    baseId: BaseId,
    commit: IVcsCommitInput
  ): Promise<Result<IVcsCommit, DomainError>>;
}

export interface IVcsReadableTableScope {
  readonly table: Table;
  readonly tableId: string;
  readonly readableFieldIds?: readonly string[];
  readonly isRowFiltered?: boolean;
  readonly queryScope?: RecordQueryPluginScope;
  readonly tableAccessScope?: ITableAccessScope;
}

export interface IVcsAccessPolicy {
  resolveReadableTables(
    ctx: IExecutionContext,
    baseId: BaseId,
    tableIds?: readonly string[]
  ): Promise<Result<readonly IVcsReadableTableScope[], DomainError>>;
  assertCanEnableVcs(ctx: IExecutionContext, baseId: BaseId): Promise<Result<void, DomainError>>;
  assertCanApplyPatch(
    ctx: IExecutionContext,
    baseId: BaseId,
    patch: IBaseVcsPatch
  ): Promise<Result<void, DomainError>>;
}
