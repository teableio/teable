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
  IBaseVcsSnapshot,
  ITableAccessScope,
  ITableVcsPatch,
  ITableVcsSnapshot,
  IVcsStoredChange,
  VcsChangeOpKind,
  VcsEntityType,
} from '../domain/types';

export interface IVcsHeadState {
  readonly enabled: boolean;
  readonly headRevision: number;
  /** Monotonic storage fence shared by unlocked reads and confirmation locks. */
  readonly modificationFence?: string;
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
  /** After CAS, admit this many new order columns and acquire the DDL lock without waiting. */
  readonly newViewOrderColumnCount?: number;
}

export interface IVcsPushMetadataLockTargets {
  readonly tableIds: readonly string[];
  readonly fieldIds: readonly string[];
  readonly viewIds: readonly string[];
}

/** Called with the current unrestricted schema. Undefined requests every record. */
export type SelectCheckpointRecords = (
  table: Omit<ITableVcsSnapshot, 'records'>,
  fieldColumns: Readonly<Record<string, string>>
) => Promise<readonly string[] | undefined>;

/** Select exact record IDs using the trusted checkpoint's schema and table membership. */
export type SelectHistoricalCheckpointRecords = (
  schema: IBaseVcsSnapshot
) => Result<ReadonlyMap<string, ReadonlySet<string>>, DomainError>;

/** Internal, unrestricted storage read in the transaction publishing this revision. */
export interface VcsCheckpointCapture {
  (
    ctx: IExecutionContext,
    baseId: BaseId,
    revision: number
  ): Promise<Result<IBaseVcsSnapshot, DomainError>>;
  withRecordSelection?(
    ctx: IExecutionContext,
    baseId: BaseId,
    revision: number,
    select: SelectCheckpointRecords
  ): Promise<Result<IBaseVcsSnapshot, DomainError>>;
}

export interface IVcsRevisionComparison {
  readonly patch: IBaseVcsPatch;
  readonly summary: IBaseVcsPatchSummary;
  readonly mergeBase: number | null;
  /** False only when both complete checkpoints have exclusively same-base references. */
  readonly containsForeignReferences?: boolean;
  /** Internal inputs for authorization. Equal chunks are omitted on both sides. Link
   * target rows from shared chunks carry IDs only and occur on both sides. */
  readonly projectionCandidates?: {
    readonly before: IBaseVcsSnapshot;
    readonly after: IBaseVcsSnapshot;
  };
}

export interface IBaseVcsLogRepository {
  getHead(
    ctx: IExecutionContext,
    baseId: BaseId,
    options?: { readonly requireAtomicStorage: true }
  ): Promise<Result<IVcsHeadState, DomainError>>;
  isEnabled(
    ctx: IExecutionContext,
    baseId: BaseId,
    options?: { readonly includePendingEnable: true }
  ): Promise<Result<boolean, DomainError>>;
  enable(
    ctx: IExecutionContext,
    baseId: BaseId,
    capture: VcsCheckpointCapture
  ): Promise<Result<IVcsEnableResult, DomainError>>;
  /** Full-base repository reads. The calling service enforces historical read access. */
  readHistoricalSnapshot(
    ctx: IExecutionContext,
    baseId: BaseId,
    revision: number
  ): Promise<Result<IBaseVcsSnapshot, DomainError>>;
  /** Internal read retaining all table schemas and only the requested historical records. */
  readHistoricalSelection?(
    ctx: IExecutionContext,
    baseId: BaseId,
    revision: number,
    selectRecords?: SelectHistoricalCheckpointRecords
  ): Promise<Result<IBaseVcsSnapshot, DomainError>>;
  /** Table membership from the checkpoint root without reading record objects. */
  readHistoricalTableIds(
    ctx: IExecutionContext,
    baseId: BaseId,
    revision: number
  ): Promise<Result<readonly string[], DomainError>>;
  compareHistoricalRevisions(
    ctx: IExecutionContext,
    baseId: BaseId,
    from: number,
    to: number
  ): Promise<Result<IVcsRevisionComparison, DomainError>>;
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
  /** Acquire metadata then the head fence. Call after acquiring explicit physical targets. */
  lockPushMetadata(
    ctx: IExecutionContext,
    baseId: BaseId,
    targets: IVcsPushMetadataLockTargets
  ): Promise<Result<IVcsHeadState, DomainError>>;
  /** Only a new transaction may wait on its first physical target. */
  lockPushPhysicalTargets(
    ctx: IExecutionContext,
    baseId: BaseId,
    physicalTargets: readonly IVcsPushPhysicalTableLockTarget[],
    options?: { readonly waitForFirstTarget: boolean }
  ): Promise<Result<void, DomainError>>;
  findCommitByOriginPushId(
    ctx: IExecutionContext,
    baseId: BaseId,
    originPushId: string
  ): Promise<Result<IVcsCommit | null, DomainError>>;
  appendCommit(
    ctx: IExecutionContext,
    baseId: BaseId,
    commit: IVcsCommitInput,
    capture: VcsCheckpointCapture
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

export interface IVcsHistoryTableScope extends IVcsReadableTableScope {
  readonly readableViewIds: ReadonlySet<string>;
  /** Only per-record history is granted. Use live schema and omit historical views. */
  readonly recordHistoryOnly?: true;
  /** Current per-record history grants. Missing records and fields are denied. */
  readonly historyFieldsForRecords?: (
    recordIds: string[]
  ) => Promise<ReadonlyMap<string, ReadonlySet<string>>>;
}

/** Inclusive epoch-millisecond bounds on persisted checkpoint times for record-only grants. */
export interface IVcsRecordHistoryWindow {
  readonly startMs?: number;
  readonly endMs: number;
}

export type VcsHistoryAccess =
  | { readonly kind: 'full'; readonly includesForeignBases?: true }
  | {
      readonly kind: 'scoped';
      readonly tables: readonly IVcsHistoryTableScope[];
      readonly currentBaseName?: string;
      readonly recordHistoryWindow?: IVcsRecordHistoryWindow;
    };

/** Prepared from the retained tables in the rollback transaction. Never accepted on the wire. */
export interface IVcsRollbackRestore {
  readonly tableIds: readonly string[];
  readonly tableChanges: readonly ITableVcsPatch[];
}

export interface IVcsAccessPolicy {
  /** A full grant includes deleted entities. Absence of a history policy denies history access. */
  resolveHistoryAccess?(
    ctx: IExecutionContext,
    baseId: BaseId
  ): Promise<Result<VcsHistoryAccess, DomainError>>;
  resolveReadableTables(
    ctx: IExecutionContext,
    baseId: BaseId,
    tableIds?: readonly string[]
  ): Promise<Result<readonly IVcsReadableTableScope[], DomainError>>;
  assertCanEnableVcs(ctx: IExecutionContext, baseId: BaseId): Promise<Result<void, DomainError>>;
  assertCanApplyPatch(
    ctx: IExecutionContext,
    baseId: BaseId,
    patch: IBaseVcsPatch,
    restore?: IVcsRollbackRestore
  ): Promise<Result<void, DomainError>>;
}
