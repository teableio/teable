import type {
  DebugTableMeta,
  DebugTableSummary,
  DebugFieldMeta,
  DebugFieldRelationOptions,
  DebugFieldRelationReport,
} from '@teable/v2-debug-data';
import type { Effect } from 'effect';
import { Context } from 'effect';
import type { CliError } from '../errors';

/** Options for querying records via application layer */
export interface RecordQueryOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly mode?: 'computed' | 'stored';
}

/** Result of application layer record query */
export interface RecordQueryResult {
  readonly records: ReadonlyArray<RecordReadModel>;
  readonly total: number;
}

/** Single record read model from application layer */
export interface RecordReadModel {
  readonly id: string;
  readonly fields: Record<string, unknown>;
}

/** Options for querying raw records from underlying database */
export interface RawRecordQueryOptions {
  readonly limit?: number;
  readonly offset?: number;
}

/** Result of underlying database record query */
export interface RawRecordQueryResult {
  readonly dbTableName: string;
  readonly records: ReadonlyArray<RawRecord>;
  readonly total: number;
}

/** Single raw record from underlying database (includes system columns) */
export type RawRecord = Record<string, unknown>;

export interface CanarySpaceSummary {
  readonly id: string;
  readonly name: string | null;
  readonly exists: boolean;
  readonly deletedTime: string | null;
}

export interface CanaryBaseSummary {
  readonly id: string;
  readonly name: string | null;
  readonly deletedTime: string | null;
}

export interface CanaryConfigSummary {
  readonly present: boolean;
  readonly valid: boolean;
  readonly enabled: boolean;
  readonly forceV2All: boolean;
  readonly spaceIdsCount: number;
  readonly matched: boolean;
}

export interface CanaryEnvSummary {
  readonly enableCanaryFeature: boolean;
  readonly forceV2All: boolean;
}

export interface CanarySpaceCheckResult {
  readonly target: {
    readonly source: 'space-id' | 'base-id';
    readonly base: CanaryBaseSummary | null;
    readonly space: CanarySpaceSummary;
  };
  readonly isCanarySpace: boolean;
  readonly canaryReason:
    | 'env_disabled'
    | 'config_missing'
    | 'config_invalid'
    | 'config_disabled'
    | 'space_list'
    | 'space_not_listed';
  readonly effectiveUseV2: boolean;
  readonly effectiveUseV2Reason:
    | 'env_force_v2_all'
    | 'env_disabled'
    | 'config_missing'
    | 'config_invalid'
    | 'config_disabled'
    | 'config_force_v2_all'
    | 'space_list'
    | 'space_not_listed';
  readonly env: CanaryEnvSummary;
  readonly config: CanaryConfigSummary;
}

export interface UndoCaptureTriggerSummary {
  readonly present: boolean;
  readonly name: string;
  readonly enabledCode: string | null;
  readonly isEnabled: boolean;
  readonly functionSchema: string | null;
  readonly functionName: string | null;
  readonly definition: string | null;
}

export interface UndoCaptureFunctionSummary {
  readonly present: boolean;
  readonly schema: string | null;
  readonly name: string | null;
}

export interface UndoCaptureUndoLogSummary {
  readonly tableExists: boolean;
  readonly pendingRowCount: number;
  readonly pendingBatchCount: number;
  readonly latestCreatedAt: string | null;
}

export interface UndoCaptureInspectionResult {
  readonly table: {
    readonly tableId: string;
    readonly tableName: string;
    readonly dbTableName: string;
    readonly schemaName: string;
    readonly physicalTableName: string;
  };
  readonly infrastructure: {
    readonly undoLogTableExists: boolean;
    readonly captureFunctionExists: boolean;
    readonly ready: boolean;
  };
  readonly captureFunction: UndoCaptureFunctionSummary;
  readonly trigger: UndoCaptureTriggerSummary;
  readonly undoLog: UndoCaptureUndoLogSummary;
}

export class DebugData extends Context.Tag('DebugData')<
  DebugData,
  {
    readonly getTableMeta: (tableId: string) => Effect.Effect<DebugTableMeta | null, CliError>;
    readonly getTablesByBaseId: (baseId: string) => Effect.Effect<DebugTableSummary[], CliError>;
    readonly getField: (fieldId: string) => Effect.Effect<DebugFieldMeta | null, CliError>;
    readonly getFieldsByTableId: (tableId: string) => Effect.Effect<DebugFieldMeta[], CliError>;
    readonly getFieldRelationReport: (
      fieldId: string,
      options?: DebugFieldRelationOptions
    ) => Effect.Effect<DebugFieldRelationReport, CliError>;

    // Application layer record queries (via ITableRecordQueryRepository)
    readonly getRecords: (
      tableId: string,
      options?: RecordQueryOptions
    ) => Effect.Effect<RecordQueryResult, CliError>;
    readonly getRecord: (
      tableId: string,
      recordId: string,
      mode?: 'computed' | 'stored'
    ) => Effect.Effect<RecordReadModel | null, CliError>;

    // Underlying database record queries (direct PostgreSQL access)
    readonly getRawRecords: (
      tableId: string,
      options?: RawRecordQueryOptions
    ) => Effect.Effect<RawRecordQueryResult, CliError>;
    readonly getRawRecord: (
      tableId: string,
      recordId: string
    ) => Effect.Effect<RawRecord | null, CliError>;
    readonly inspectUndoCapture: (
      tableId: string
    ) => Effect.Effect<UndoCaptureInspectionResult | null, CliError>;
    readonly checkCanarySpace: (input: {
      readonly spaceId?: string;
      readonly baseId?: string;
    }) => Effect.Effect<CanarySpaceCheckResult | null, CliError>;
  }
>() {}
