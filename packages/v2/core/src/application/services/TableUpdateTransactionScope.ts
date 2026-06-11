import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import {
  getUnitOfWorkTransaction,
  type IExecutionContext,
  type IUnitOfWorkTransaction,
} from '../../ports/ExecutionContext';

export type TableUpdateDeferredTask = () => Promise<Result<void, DomainError>>;

type TableUpdateTransactionState = {
  depth: number;
  deferredTasks: TableUpdateDeferredTask[];
  latestTablesById: Map<string, Table>;
};

const stateByTransaction = new WeakMap<IUnitOfWorkTransaction, TableUpdateTransactionState>();

const getOrCreateState = (transaction: IUnitOfWorkTransaction): TableUpdateTransactionState => {
  const existing = stateByTransaction.get(transaction);
  if (existing) {
    return existing;
  }

  const created: TableUpdateTransactionState = {
    depth: 0,
    deferredTasks: [],
    latestTablesById: new Map(),
  };
  stateByTransaction.set(transaction, created);
  return created;
};

const resolveScopeAnchorTransaction = (
  context: IExecutionContext
): IUnitOfWorkTransaction | undefined => {
  return getUnitOfWorkTransaction(context, 'meta') ?? context.transaction;
};

export const enterTableUpdateTransactionScope = (context: IExecutionContext): void => {
  const transaction = resolveScopeAnchorTransaction(context);
  if (!transaction) {
    return;
  }

  const state = getOrCreateState(transaction);
  state.depth += 1;
};

export const scheduleTableUpdateDeferredTask = (
  context: IExecutionContext,
  task: TableUpdateDeferredTask
): void => {
  const transaction = resolveScopeAnchorTransaction(context);
  if (!transaction) {
    throw new Error('Table update deferred tasks require an active transaction');
  }

  const state = getOrCreateState(transaction);
  state.deferredTasks.push(task);
};

export const recordLatestTableInTransactionScope = (
  context: IExecutionContext,
  table: Table
): void => {
  const transaction = resolveScopeAnchorTransaction(context);
  if (!transaction) {
    return;
  }

  const state = getOrCreateState(transaction);
  state.latestTablesById.set(table.id().toString(), table);
};

export const resolveLatestTableInTransactionScope = (
  context: IExecutionContext,
  tableId: TableId,
  fallbackTable: Table
): Table => {
  const transaction = resolveScopeAnchorTransaction(context);
  if (!transaction) {
    return fallbackTable;
  }

  const state = stateByTransaction.get(transaction);
  return state?.latestTablesById.get(tableId.toString()) ?? fallbackTable;
};

export const flushTableUpdateTransactionScope = async (
  context: IExecutionContext
): Promise<Result<void, DomainError>> => {
  const transaction = resolveScopeAnchorTransaction(context);
  if (!transaction) {
    return ok(undefined);
  }

  const state = stateByTransaction.get(transaction);
  if (!state) {
    return ok(undefined);
  }

  state.depth = Math.max(0, state.depth - 1);
  if (state.depth > 0) {
    return ok(undefined);
  }

  try {
    while (state.deferredTasks.length > 0) {
      const task = state.deferredTasks.shift();
      if (!task) {
        continue;
      }
      const result = await task();
      if (result.isErr()) {
        return err(result.error);
      }
    }
    return ok(undefined);
  } finally {
    stateByTransaction.delete(transaction);
  }
};

export const abortTableUpdateTransactionScope = (context: IExecutionContext): void => {
  const transaction = resolveScopeAnchorTransaction(context);
  if (!transaction) {
    return;
  }

  stateByTransaction.delete(transaction);
};
