import type { TableI18nKey } from '@teable/i18n-keys';

import type { ActorId } from '../domain/shared/ActorId';
import type { IDomainContext, IDomainContextConfig } from '../domain/shared/DomainContext';
import type { TableDataSafetyLimitConfig } from '../domain/shared/TableDataSafetyLimits';
import type { ITracer } from './Tracer';

export interface IUnitOfWorkTransaction {
  readonly kind: 'unitOfWorkTransaction';
  readonly scope?: UnitOfWorkScope;
  readonly committed?: boolean;
  readonly rolledBack?: boolean;
  afterCommit?(handler: UnitOfWorkAfterCommitHandler): void;
  afterRollback?(handler: UnitOfWorkAfterCommitHandler): void;
}

export type UnitOfWorkAfterCommitHandler = () => Promise<void> | void;
export type UnitOfWorkScope = 'meta' | 'data';
export type ExecutionContextBackgroundTask = () => Promise<void> | void;
export type ExecutionContextBackgroundTaskScheduler = (
  task: ExecutionContextBackgroundTask
) => void;

export type IExecutionContextTransactions = Partial<
  Record<UnitOfWorkScope, IUnitOfWorkTransaction>
>;

export interface IExecutionContext {
  actorId: ActorId;
  transaction?: IUnitOfWorkTransaction;
  transactions?: IExecutionContextTransactions;
  tracer?: ITracer;
  requestId?: string;
  windowId?: string;
  scheduleBackgroundTask?: ExecutionContextBackgroundTaskScheduler;
  undoRedo?: { mode: 'undo' | 'redo' | 'normal' };
  config?: {
    tableLimits?: TableDataSafetyLimitConfig;
    /** @deprecated Use `tableLimits.fieldOptions.maxSelectChoices`. */
    selectFieldOptions?: IDomainContextConfig['selectFieldOptions'];
    /** @deprecated Use `tableLimits.tableSchema.maxFieldsPerTable`. */
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

export const getExecutionContextTranslator = (
  context?: Pick<IExecutionContext, '$t'>
): ((key: string, options?: Record<string, unknown>) => string) | undefined => {
  if (!context?.$t) {
    return undefined;
  }

  return (key: string, options?: Record<string, unknown>) =>
    context.$t?.(key as TableI18nKey, options) ?? key;
};

export const scheduleExecutionContextBackgroundTask = (
  context: IExecutionContext,
  task: ExecutionContextBackgroundTask
): void => {
  if (context.scheduleBackgroundTask) {
    context.scheduleBackgroundTask(task);
    return;
  }

  const timeout = (
    globalThis as {
      setTimeout?: (handler: () => void, timeout: number) => { unref?: () => void } | unknown;
    }
  ).setTimeout;
  if (typeof timeout === 'function') {
    const handle = timeout(() => void task(), 0) as { unref?: () => void } | undefined;
    handle?.unref?.();
    return;
  }

  const immediate = (
    globalThis as { setImmediate?: (handler: () => void) => { unref?: () => void } | unknown }
  ).setImmediate;
  if (typeof immediate === 'function') {
    const handle = immediate(() => void task()) as { unref?: () => void } | undefined;
    handle?.unref?.();
    return;
  }

  const scheduler = (globalThis as { queueMicrotask?: (task: () => void) => void }).queueMicrotask;
  if (typeof scheduler === 'function') {
    scheduler(() => void task());
    return;
  }

  void task();
};

export const getDomainContext = (context?: IExecutionContext): IDomainContext | undefined => {
  const tableLimits = context?.config?.tableLimits;
  const selectFieldOptions = context?.config?.selectFieldOptions;
  const tableFields = context?.config?.tableFields;
  if (!context?.$t && !tableLimits && !selectFieldOptions && !tableFields) {
    return undefined;
  }

  const translate = getExecutionContextTranslator(context);

  return {
    t: translate,
    config:
      tableLimits || selectFieldOptions || tableFields
        ? {
            ...(tableLimits ? { tableLimits } : {}),
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
