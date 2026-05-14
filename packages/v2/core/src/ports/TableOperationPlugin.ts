import type { Result } from 'neverthrow';

import type { BaseId } from '../domain/base/BaseId';
import type { DomainError } from '../domain/shared/DomainError';
import type { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from './ExecutionContext';
import type { PluginTraceContext } from './Tracer';

export const TableOperationKind = {
  create: 'create',
  createMany: 'createMany',
  duplicate: 'duplicate',
  importCsv: 'importCsv',
  rename: 'rename',
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

export type TableOperationCreatePayload = {
  readonly baseId: BaseId;
  readonly tableName: TableName;
  readonly fieldCount: number;
  readonly viewCount: number;
  readonly recordCount: number;
  readonly viewNames: ReadonlyArray<string>;
};

export type TableOperationCreateManyPayload = {
  readonly baseId: BaseId;
  readonly tables: ReadonlyArray<TableOperationCreatePayload>;
};

export type TableOperationDuplicatePayload = {
  readonly baseId: BaseId;
  readonly tableName: TableName;
  readonly includeRecords: boolean;
};

export type TableOperationImportCsvPayload = {
  readonly baseId: BaseId;
  readonly tableName: TableName;
  readonly fieldCount: number;
  readonly viewCount: number;
  readonly recordCount: number;
};

export type TableOperationRenamePayload = {
  readonly baseId: BaseId;
  readonly tableName: TableName;
};

export type ITableOperationCreateContext = ITableOperationPluginContextBase<
  'create',
  TableOperationCreatePayload
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

export type TableOperationPluginContextMap = {
  create: ITableOperationCreateContext;
  createMany: ITableOperationCreateManyContext;
  duplicate: ITableOperationDuplicateContext;
  importCsv: ITableOperationImportCsvContext;
  rename: ITableOperationRenameContext;
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
}
