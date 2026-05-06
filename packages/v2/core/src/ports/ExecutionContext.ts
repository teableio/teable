import type { TableI18nKey } from '@teable/i18n-keys';

import type { ActorId } from '../domain/shared/ActorId';
import type { IDomainContext, IDomainContextConfig } from '../domain/shared/DomainContext';
import type { ITracer } from './Tracer';

export interface IUnitOfWorkTransaction {
  readonly kind: 'unitOfWorkTransaction';
  readonly scope?: UnitOfWorkScope;
  afterCommit?(handler: UnitOfWorkAfterCommitHandler): void;
  afterRollback?(handler: UnitOfWorkAfterCommitHandler): void;
}

export type UnitOfWorkAfterCommitHandler = () => Promise<void> | void;
export type UnitOfWorkScope = 'meta' | 'data';

export type IExecutionContextTransactions = Partial<Record<UnitOfWorkScope, IUnitOfWorkTransaction>>;

export interface IExecutionContextBatchMutation {
  readonly operationId?: string;
  readonly groupId?: string;
  readonly totalRecordCount: number;
  readonly totalChunkCount: number;
  readonly chunkIndex: number;
  readonly scope: 'operation' | 'chunk';
}

export interface IExecutionContext {
  actorId: ActorId;
  transaction?: IUnitOfWorkTransaction;
  transactions?: IExecutionContextTransactions;
  tracer?: ITracer;
  requestId?: string;
  windowId?: string;
  batchMutation?: IExecutionContextBatchMutation;
  undoRedo?: { mode: 'undo' | 'redo' | 'normal' };
  duplicateTable?: {
    sourceTableId: string;
    duplicatedTableId?: string;
    includeRecords: boolean;
  };
  config?: {
    selectFieldOptions?: IDomainContextConfig['selectFieldOptions'];
    tableFields?: IDomainContextConfig['tableFields'];
  };
  $t?: (key: TableI18nKey, options?: Record<string, unknown>) => string;
}

export const getUnitOfWorkTransaction = (
  context: IExecutionContext | undefined,
  scope: UnitOfWorkScope = 'data'
): IUnitOfWorkTransaction | undefined => {
  const scopedTransaction = context?.transactions?.[scope];
  if (scopedTransaction) {
    return scopedTransaction;
  }

  const activeTransaction = context?.transaction;
  if (!activeTransaction) {
    return undefined;
  }

  if (!activeTransaction.scope || activeTransaction.scope === scope) {
    return activeTransaction;
  }

  return undefined;
};

export const bindUnitOfWorkTransaction = (
  context: IExecutionContext,
  transaction: IUnitOfWorkTransaction
): IExecutionContext => {
  const scope = transaction.scope;
  return {
    ...context,
    transaction,
    transactions: scope
      ? {
          ...(context.transactions ?? {}),
          [scope]: transaction,
        }
      : context.transactions,
  };
};

export const activateUnitOfWorkScope = (
  context: IExecutionContext,
  scope: UnitOfWorkScope
): IExecutionContext => {
  const transaction = getUnitOfWorkTransaction(context, scope);
  if (!transaction) {
    return context;
  }

  return {
    ...context,
    transaction,
    transactions: transaction.scope
      ? {
          ...(context.transactions ?? {}),
          [transaction.scope]: transaction,
        }
      : context.transactions,
  };
};

export const getDomainContext = (context?: IExecutionContext): IDomainContext | undefined => {
  const selectFieldOptions = context?.config?.selectFieldOptions;
  const tableFields = context?.config?.tableFields;
  if (!context?.$t && !selectFieldOptions && !tableFields) {
    return undefined;
  }

  const translate = context?.$t
    ? (key: string, options?: Record<string, unknown>) =>
        context.$t?.(key as TableI18nKey, options) ?? key
    : undefined;

  return {
    t: translate,
    config:
      selectFieldOptions || tableFields
        ? {
            ...(selectFieldOptions ? { selectFieldOptions } : {}),
            ...(tableFields ? { tableFields } : {}),
          }
        : undefined,
  };
};

export const registerAfterCommit = (
  context: IExecutionContext,
  handler: UnitOfWorkAfterCommitHandler
): boolean => {
  if (!context.transaction?.afterCommit) {
    return false;
  }

  context.transaction.afterCommit(handler);
  return true;
};

export const registerAfterRollback = (
  context: IExecutionContext,
  handler: UnitOfWorkAfterCommitHandler
): boolean => {
  if (!context.transaction?.afterRollback) {
    return false;
  }

  context.transaction.afterRollback(handler);
  return true;
};

export const withoutTransaction = (context: IExecutionContext): IExecutionContext => {
  const nextContext: IExecutionContext = { ...context };
  delete nextContext.transaction;
  delete nextContext.transactions;
  return nextContext;
};
