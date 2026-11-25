import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import {
  getUnitOfWorkTransaction,
  withoutTransaction,
  type IExecutionContext,
} from '../../ports/ExecutionContext';
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
  publishActorStorageVersion?: 1;
};

export type BeginTableSchemaOperationOptions = TableSchemaOperationOptions & {
  state?: Extract<TableProvisionState, 'pending' | 'ready' | 'deleting'>;
};

export type FailTableSchemaOperationOptions = Omit<TableSchemaOperationOptions, 'lastError'> & {
  lastError: string;
};

const tablePayload = (
  table: Table,
  payload?: TableSchemaOperationPayload
): TableSchemaOperationPayload => ({
  ...payload,
  tableId: table.id().toString(),
});

const tablesPayload = (
  tables: ReadonlyArray<Table>,
  payload?: TableSchemaOperationPayload
): TableSchemaOperationPayload => ({
  ...payload,
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
  publishActorStorageVersion: options.publishActorStorageVersion,
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

const completeAfterActorStorageCommit = async (
  context: IExecutionContext,
  options: TableSchemaOperationOptions,
  complete: (context: IExecutionContext) => Promise<Result<void, DomainError>>
): Promise<Result<void, DomainError>> => {
  const dataTransaction = getUnitOfWorkTransaction(context, 'data');
  if (options.publishActorStorageVersion !== 1 || !dataTransaction || dataTransaction.committed) {
    return complete(context);
  }

  const metaTransaction = getUnitOfWorkTransaction(context, 'meta');
  // A shared transaction commits the DDL and capability atomically. Later writes in
  // the same batch need to see the ready table before the owner commits.
  if (
    metaTransaction === dataTransaction &&
    dataTransaction.pending !== false &&
    !dataTransaction.rolledBack
  ) {
    return complete(context);
  }

  const transactions =
    metaTransaction && metaTransaction !== dataTransaction && !metaTransaction.committed
      ? [dataTransaction, metaTransaction]
      : [dataTransaction];
  if (transactions.some((transaction) => transaction.rolledBack || !transaction.afterCommit)) {
    return err(
      domainError.infrastructure({
        code: 'actor_storage.publication_transaction_owner_required',
        message: 'Actor storage publication requires confirmed data and metadata commit hooks',
      })
    );
  }

  let remainingCommits = transactions.length;
  for (const transaction of transactions) {
    transaction.afterCommit!(async () => {
      remainingCommits -= 1;
      if (remainingCommits !== 0) return;
      const result = await complete(withoutTransaction(context));
      if (result.isErr()) throw new Error(result.error.message);
    });
  }
  return ok(undefined);
};

export const completeTableSchemaOperation = async (
  unitOfWork: IUnitOfWork,
  tableRepository: ITableRepository,
  context: IExecutionContext,
  table: Table,
  options: TableSchemaOperationOptions
): Promise<Result<void, DomainError>> =>
  completeAfterActorStorageCommit(context, options, (publicationContext) =>
    setTableProvisionState(
      unitOfWork,
      tableRepository,
      publicationContext,
      table,
      'ready',
      operationOptions(
        options,
        options.payload === undefined ? undefined : tablePayload(table, options.payload),
        'ready'
      )
    )
  );

export const completeTablesSchemaOperation = async (
  unitOfWork: IUnitOfWork,
  tableRepository: ITableRepository,
  context: IExecutionContext,
  tables: ReadonlyArray<Table>,
  options: TableSchemaOperationOptions
): Promise<Result<void, DomainError>> =>
  completeAfterActorStorageCommit(context, options, (publicationContext) =>
    setTablesProvisionState(
      unitOfWork,
      tableRepository,
      publicationContext,
      tables,
      'ready',
      operationOptions(
        options,
        options.payload === undefined ? undefined : tablesPayload(tables, options.payload),
        'ready'
      )
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

export const abandonTableSchemaOperation = async (
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
      {
        ...options,
        status: options.status ?? 'dead',
      },
      options.payload === undefined ? undefined : tablePayload(table, options.payload),
      'error'
    )
  );

// Mirrors the runner-side failure path (SchemaOperationRunnerService's
// retryDelayMs floor of 1s): a request-side recoverable failure left with
// nextRunAt=now is instantly claimable by the background runner, so a fast
// poll can flip it to 'running' before the caller has even read the recorded
// error. A one-second floor keeps the structured failure classification
// observable for a beat without delaying repair meaningfully.
const recoverableFailureRetryDelayMs = 1_000;

export const failRecoverableTableSchemaOperation = async (
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
    'ready',
    operationOptions(
      {
        ...options,
        status: options.status ?? 'error',
        nextRunAt: options.nextRunAt ?? new Date(Date.now() + recoverableFailureRetryDelayMs),
      },
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
