import type { Result } from 'neverthrow';
import type { DomainError } from '../domain/errors';
import type {
  IBaseVcsAccessScope,
  IBaseVcsPatch,
  IBaseVcsSnapshot,
  IRecordVcsSnapshot,
  ITableVcsSnapshot,
  IVcsCloneRecordsChunk,
  IVcsConflict,
  IVcsEngineApplyResult,
  IVcsHeadInfo,
  IVcsIncrementalChanges,
  IVcsMergeState,
  IVcsPushRequest,
  IVcsPushResult,
  IVcsWorkingDelta,
  IVcsWorkspaceConfig,
} from '../domain/types';

export type {
  IBaseVcsAccessScope,
  IBaseVcsPatch,
  IBaseVcsSnapshot,
  IRecordVcsSnapshot,
  ITableVcsSnapshot,
  IVcsCloneRecordsChunk,
  IVcsConflict,
  IVcsEngineApplyResult,
  IVcsHeadInfo,
  IVcsIncrementalChanges,
  IVcsMergeState,
  IVcsPushRequest,
  IVcsPushResult,
  IVcsWorkingDelta,
  IVcsWorkspaceConfig,
} from '../domain/types';

export interface ICloneSnapshotOptions {
  readonly tableIds?: readonly string[];
  readonly cursor?: string;
  readonly includeRecords?: boolean;
  readonly schemaOnly?: boolean;
  readonly chunkSize?: number;
}

export interface IVcsRemoteGateway {
  getHead(baseId: string): Promise<Result<IVcsHeadInfo, DomainError>>;
  enableBaseVcs?(
    baseId: string
  ): Promise<
    Result<IVcsHeadInfo | { readonly enabled: boolean; readonly headRevision: number }, DomainError>
  >;
  cloneSnapshot(
    baseId: string,
    options?: ICloneSnapshotOptions
  ): Promise<
    Result<{ snapshot: IBaseVcsSnapshot; remoteMode: IVcsHeadInfo['remoteMode'] }, DomainError>
  >;
  checkoutRevision?(
    baseId: string,
    revision: number
  ): Promise<Result<{ snapshot: IBaseVcsSnapshot; remoteMode: 'v2-vcs' }, DomainError>>;
  cloneTableRecordsChunk?(
    baseId: string,
    tableId: string,
    options?: { readonly cursor?: string; readonly limit?: number }
  ): Promise<Result<IVcsCloneRecordsChunk, DomainError>>;
  fetchChanges(
    baseId: string,
    sinceRevision: number,
    options?: ICloneSnapshotOptions
  ): Promise<Result<IVcsIncrementalChanges, DomainError>>;
  pushPatch(request: IVcsPushRequest): Promise<Result<IVcsPushResult, DomainError>>;
}

export interface IVcsBaseRecordTableMutation {
  readonly tableId: string;
  readonly upserts?: readonly IRecordVcsSnapshot[];
  readonly deleteIds?: readonly string[];
}

export interface IVcsBaseStateMutationBatch {
  readonly revision?: number;
  readonly cursor?: string;
  readonly baseName?: string;
  readonly accessScope?: IBaseVcsAccessScope;
  readonly tablesAdded?: readonly ITableVcsSnapshot[];
  readonly tablesDeleted?: readonly string[];
  readonly tablesSchemaUpdated?: readonly ITableVcsSnapshot[];
  readonly recordChanges?: readonly IVcsBaseRecordTableMutation[];
}

export interface IVcsBaseSchemaSummary {
  readonly schemaSnapshot: IBaseVcsSnapshot;
  readonly totalRecords: number;
  readonly tableRecordCounts: Readonly<Record<string, number>>;
}

export interface IVcsStateRepository {
  readConfig(): Promise<Result<IVcsWorkspaceConfig | null, DomainError>>;
  writeConfig(config: IVcsWorkspaceConfig): Promise<Result<void, DomainError>>;
  readBaseSnapshot(): Promise<Result<IBaseVcsSnapshot | null, DomainError>>;
  writeBaseSnapshot(snapshot: IBaseVcsSnapshot): Promise<Result<void, DomainError>>;
  writePromotionSnapshot?(snapshot: IBaseVcsSnapshot): Promise<Result<void, DomainError>>;
  readBaseSchemaSnapshot?(): Promise<Result<IVcsBaseSchemaSummary | null, DomainError>>;
  writeBaseSchemaSnapshot?(schemaSnapshot: IBaseVcsSnapshot): Promise<Result<void, DomainError>>;
  readBaseRecordsByIds?(
    tableId: string,
    recordIds: readonly string[]
  ): Promise<Result<ReadonlyMap<string, IRecordVcsSnapshot>, DomainError>>;
  applyBaseStateMutations?(batch: IVcsBaseStateMutationBatch): Promise<Result<void, DomainError>>;
  readConflicts(): Promise<Result<readonly IVcsConflict[], DomainError>>;
  writeConflicts(conflicts: readonly IVcsConflict[]): Promise<Result<void, DomainError>>;
  readMergeState(): Promise<Result<IVcsMergeState | null, DomainError>>;
  writeMergeState(state: IVcsMergeState | null): Promise<Result<void, DomainError>>;
}

export interface IVcsHydrateRecordChunkResult {
  readonly deferredLinkRecords: ReadonlyArray<{
    readonly id: string;
    readonly fields: Record<string, unknown>;
  }>;
}

export interface IVcsEnginePort {
  captureSnapshot(
    baseId: string,
    options?: {
      readonly baseName?: string;
      readonly revision?: number;
    }
  ): Promise<Result<IBaseVcsSnapshot, DomainError>>;
  hydrateSnapshot(
    snapshot: IBaseVcsSnapshot,
    options?: {
      readonly skipCaptureSnapshot?: boolean;
    }
  ): Promise<Result<IVcsEngineApplyResult, DomainError>>;
  applyPatch(
    baseId: string,
    patch: IBaseVcsPatch,
    options?: {
      readonly skipCaptureSnapshot?: boolean;
    }
  ): Promise<Result<IVcsEngineApplyResult, DomainError>>;
  hydrateRecordChunk?(params: {
    readonly baseId: string;
    readonly tableId: string;
    readonly records: readonly IRecordVcsSnapshot[];
    readonly mode?: 'scalar-insert' | 'link-update';
  }): Promise<Result<IVcsHydrateRecordChunkResult, DomainError>>;
  flushComputed?(baseId: string): Promise<Result<number, DomainError>>;
  captureTableRecordsChunk?(
    baseId: string,
    tableId: string,
    options?: { readonly cursor?: string; readonly limit?: number }
  ): Promise<Result<IVcsCloneRecordsChunk, DomainError>>;
}

export interface IVcsLocalEnginePort extends IVcsEnginePort {
  hasBase(baseId: string): Promise<Result<boolean, DomainError>>;
  reset?(): Promise<Result<void, DomainError>>;
  markWorkingClean?(baseId: string): Promise<Result<void, DomainError>>;
  ensureWorkingTrackingTriggers?(baseId: string): Promise<Result<void, DomainError>>;
  captureWorkingDelta?(
    baseId: string,
    options?: { readonly baseName?: string; readonly revision?: number }
  ): Promise<Result<IVcsWorkingDelta, DomainError>>;
  withSession?<T>(
    fn: (engine: IVcsLocalEnginePort) => Promise<Result<T, DomainError>>
  ): Promise<Result<T, DomainError>>;
}
