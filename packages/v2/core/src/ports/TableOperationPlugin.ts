import type { Result } from 'neverthrow';

import type { BaseId } from '../domain/base/BaseId';
import type { DomainError } from '../domain/shared/DomainError';
import type { Table } from '../domain/table/Table';
import type { TableName } from '../domain/table/TableName';
import type { TablePropertiesPatch } from '../domain/table/TableProperties';
import type { IExecutionContext } from './ExecutionContext';
import type { PluginTraceContext } from './Tracer';

export const TableOperationKind = {
  read: 'read',
  create: 'create',
  createMany: 'createMany',
  duplicate: 'duplicate',
  importCsv: 'importCsv',
  rename: 'rename',
  delete: 'delete',
  restore: 'restore',
  updateProperties: 'updateProperties',
} as const;

export type TableOperationKind = (typeof TableOperationKind)[keyof typeof TableOperationKind];

export type TableOperationPluginEnforce = 'pre' | 'post';

type TableOperationPluginHookResult<T> = Result<T, DomainError> | Promise<Result<T, DomainError>>;

interface ITableOperationPluginContextBase<TKind extends TableOperationKind, TPayload> {
  readonly kind: TKind;
  readonly executionContext: IExecutionContext;
  readonly payload: TPayload;
  readonly trace?: PluginTraceContext;
  readonly isTransactionBound: boolean;
}

export type TableOperationReadPayload = {
  readonly baseId: BaseId;
  readonly table: Table;
};

export type TableOperationCreatePayload = {
  readonly baseId: BaseId;
  readonly tableName: TableName;
  readonly table?: Table;
  readonly fieldCount: number;
  readonly viewCount: number;
  readonly recordCount: number;
  readonly viewNames: ReadonlyArray<string>;
};

/**
 * Which command creates the tables. `createTables` builds them from the caller's own field
 * definitions; the other two copy tables that already exist (a base, or a `.tea` archive).
 */
export const TableOperationCreateManySource = {
  createTables: 'createTables',
  duplicateBase: 'duplicateBase',
  importDotTea: 'importDotTea',
} as const;
export type TableOperationCreateManySource =
  (typeof TableOperationCreateManySource)[keyof typeof TableOperationCreateManySource];

export type TableOperationCreateManyPayload = {
  readonly baseId: BaseId;
  readonly source: TableOperationCreateManySource;
  readonly tables: ReadonlyArray<TableOperationCreatePayload>;
};

export type TableOperationDuplicatePayload = {
  readonly baseId: BaseId;
  readonly tableName: TableName;
  readonly table?: Table;
  readonly sourceTable: Table;
  readonly includeRecords: boolean;
};

export type TableOperationImportCsvPayload = {
  readonly baseId: BaseId;
  readonly tableName: TableName;
  readonly table?: Table;
  readonly fieldCount: number;
  readonly viewCount: number;
  /** Undefined while a streamed import's total is not yet known. */
  readonly recordCount: number | undefined;
};

export type TableOperationRenamePayload = {
  readonly baseId: BaseId;
  readonly tableName: TableName;
  readonly table: Table;
};

export type ITableOperationCreateContext = ITableOperationPluginContextBase<
  'create',
  TableOperationCreatePayload
>;
export type ITableOperationReadContext = ITableOperationPluginContextBase<
  'read',
  TableOperationReadPayload
>;
export type ITableOperationCreateManyContext = ITableOperationPluginContextBase<
  'createMany',
  TableOperationCreateManyPayload
>;
export type ITableOperationDuplicateContext = ITableOperationPluginContextBase<
  'duplicate',
  TableOperationDuplicatePayload
>;
export type ITableOperationImportCsvContext = ITableOperationPluginContextBase<
  'importCsv',
  TableOperationImportCsvPayload
>;
export type ITableOperationRenameContext = ITableOperationPluginContextBase<
  'rename',
  TableOperationRenamePayload
>;

export type TableOperationLifecyclePayload = {
  readonly baseId: BaseId;
  readonly table: Table;
};

export type TableOperationPluginContextMap = {
  read: ITableOperationReadContext;
  create: ITableOperationCreateContext;
  createMany: ITableOperationCreateManyContext;
  duplicate: ITableOperationDuplicateContext;
  importCsv: ITableOperationImportCsvContext;
  rename: ITableOperationRenameContext;
  delete: ITableOperationPluginContextBase<'delete', TableOperationLifecyclePayload & { readonly mode: 'soft' | 'permanent' }>;
  restore: ITableOperationPluginContextBase<'restore', TableOperationLifecyclePayload>;
  updateProperties: ITableOperationPluginContextBase<'updateProperties', TableOperationLifecyclePayload & { readonly patch: TablePropertiesPatch }>;
};

export type TableOperationPluginContext = TableOperationPluginContextMap[TableOperationKind];

export interface ITableOperationPlugin<TPreparedState = unknown> {
  readonly name: string;
  readonly enforce?: TableOperationPluginEnforce;

  supports(operation: TableOperationKind): boolean;

  prepare?(context: TableOperationPluginContext): TableOperationPluginHookResult<TPreparedState>;

  guard?(
    context: TableOperationPluginContext,
    preparedState: TPreparedState | undefined
  ): TableOperationPluginHookResult<void>;

  /**
   * Checks the cumulative records about to be inserted by a streamed table import.
   * Reuses prepared state without repeating table-creation or table-count guards.
   */
  guardImportRecordCount?(
    context: ITableOperationImportCsvContext,
    recordCount: number,
    preparedState: TPreparedState | undefined
  ): TableOperationPluginHookResult<void>;
}
