import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type {
  SchemaOperationPhase,
  SchemaOperationStatus,
  SchemaOperationType,
} from '../../ports/SchemaOperationRepository';
import type {
  ITableRepository,
  TableProvisionOperationOptions,
  TableProvisionState,
} from '../../ports/TableRepository';
import type { IUnitOfWork } from '../../ports/UnitOfWork';
import { setTableProvisionState, setTablesProvisionState } from './TableProvisionStateService';

export type TableSchemaOperationPayload = Record<string, unknown>;

export type TableSchemaOperationOptions = {
  type: SchemaOperationType;
  phase?: SchemaOperationPhase;
  payload?: TableSchemaOperationPayload;
  operationId?: string;
  idempotencyKey?: string;
  status?: SchemaOperationStatus;
  result?: unknown;
  lastError?: string | null;
  maxAttempts?: number;
  nextRunAt?: Date;
};

export type BeginTableSchemaOperationOptions = TableSchemaOperationOptions & {
  state?: Extract<TableProvisionState, 'pending' | 'deleting'>;
};

export type FailTableSchemaOperationOptions = Omit<TableSchemaOperationOptions, 'lastError'> & {
  lastError: string;
};

const tablePayload = (
  table: Table,
  payload?: TableSchemaOperationPayload
): TableSchemaOperationPayload => ({
  ...(payload ?? {}),
  tableId: table.id().toString(),
});

const tablesPayload = (
  tables: ReadonlyArray<Table>,
  payload?: TableSchemaOperationPayload
): TableSchemaOperationPayload => ({
  ...(payload ?? {}),
  tableIds: tables.map((table) => table.id().toString()),
});

const operationOptions = (
  options: TableSchemaOperationOptions,
  payload: TableSchemaOperationPayload | undefined,
  defaultPhase: SchemaOperationPhase
): TableProvisionOperationOptions => ({
  operationId: options.operationId,
  idempotencyKey: options.idempotencyKey,
  operationType: options.type,
  phase: options.phase ?? defaultPhase,
  status: options.status,
  payload,
  result: options.result,
  lastError: options.lastError,
  maxAttempts: options.maxAttempts,
  nextRunAt: options.nextRunAt,
});

export const beginTableSchemaOperation = async (
  unitOfWork: IUnitOfWork,
  tableRepository: ITableRepository,
  context: IExecutionContext,
  table: Table,
  options: BeginTableSchemaOperationOptions
): Promise<Result<void, DomainError>> =>
  setTableProvisionState(
    unitOfWork,
    tableRepository,
    context,
    table,
    options.state ?? 'pending',
    operationOptions(options, tablePayload(table, options.payload), 'metadata_pending')
  );

export const beginTablesSchemaOperation = async (
  unitOfWork: IUnitOfWork,
  tableRepository: ITableRepository,
  context: IExecutionContext,
  tables: ReadonlyArray<Table>,
  options: BeginTableSchemaOperationOptions
): Promise<Result<void, DomainError>> =>
  setTablesProvisionState(
    unitOfWork,
    tableRepository,
    context,
    tables,
    options.state ?? 'pending',
    operationOptions(options, tablesPayload(tables, options.payload), 'metadata_pending')
  );

export const completeTableSchemaOperation = async (
  unitOfWork: IUnitOfWork,
  tableRepository: ITableRepository,
  context: IExecutionContext,
  table: Table,
  options: TableSchemaOperationOptions
): Promise<Result<void, DomainError>> =>
  setTableProvisionState(
    unitOfWork,
    tableRepository,
    context,
    table,
    'ready',
    operationOptions(
      options,
      options.payload === undefined ? undefined : tablePayload(table, options.payload),
      'ready'
    )
  );

export const completeTablesSchemaOperation = async (
  unitOfWork: IUnitOfWork,
  tableRepository: ITableRepository,
  context: IExecutionContext,
  tables: ReadonlyArray<Table>,
  options: TableSchemaOperationOptions
): Promise<Result<void, DomainError>> =>
  setTablesProvisionState(
    unitOfWork,
    tableRepository,
    context,
    tables,
    'ready',
    operationOptions(
      options,
      options.payload === undefined ? undefined : tablesPayload(tables, options.payload),
      'ready'
    )
  );

export const failTableSchemaOperation = async (
  unitOfWork: IUnitOfWork,
  tableRepository: ITableRepository,
  context: IExecutionContext,
  table: Table,
  options: FailTableSchemaOperationOptions
): Promise<Result<void, DomainError>> =>
  setTableProvisionState(
    unitOfWork,
    tableRepository,
    context,
    table,
    'error',
    operationOptions(
      options,
      options.payload === undefined ? undefined : tablePayload(table, options.payload),
      'error'
    )
  );

export const failTablesSchemaOperation = async (
  unitOfWork: IUnitOfWork,
  tableRepository: ITableRepository,
  context: IExecutionContext,
  tables: ReadonlyArray<Table>,
  options: FailTableSchemaOperationOptions
): Promise<Result<void, DomainError>> =>
  setTablesProvisionState(
    unitOfWork,
    tableRepository,
    context,
    tables,
    'error',
    operationOptions(
      options,
      options.payload === undefined ? undefined : tablesPayload(tables, options.payload),
      'error'
    )
  );
