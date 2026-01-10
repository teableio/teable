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
  }
>() {}
