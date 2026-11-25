import { err, ok, type Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import {
  createCrossDatabaseBatchError,
  failBatchResultIfActive,
  getUnitOfWorkTransaction,
  isReusableBatchTransactionScope,
  type IDomainBatchSavepointHandle,
  type IDomainBatchTransactionScope,
  type IExecutionContext,
  type IUnitOfWorkTransaction,
  type UnitOfWorkAfterCommitHandler,
  type UnitOfWorkScope,
} from '../../ports/ExecutionContext';
import type { ILogger } from '../../ports/Logger';
import type { IUnitOfWork, IUnitOfWorkOptions } from '../../ports/UnitOfWork';

export type BatchExecutionScope =
  | { readonly kind: 'error'; readonly error: DomainError }
  | { readonly kind: 'inBatch'; readonly batchTransaction: IDomainBatchTransactionScope }
  | { readonly kind: 'standalone' };

const isTransactionPendingOrActive = (tx: IUnitOfWorkTransaction): boolean =>
  tx.pending !== undefined ? tx.pending : !tx.committed && !tx.rolledBack;

export const resolveBatchExecutionScope = (
  context: IExecutionContext,
  scope: UnitOfWorkScope
): BatchExecutionScope => {
  const existingTransaction = getUnitOfWorkTransaction(context, scope);
  const activeBatch = isReusableBatchTransactionScope(context.batchTransaction)
    ? context.batchTransaction
    : undefined;

  if (activeBatch) {
    if (activeBatch.rollbackReason) {
      return { kind: 'error', error: activeBatch.rollbackReason };
    }
    if (existingTransaction === activeBatch.ownerTransaction) {
      return { kind: 'inBatch', batchTransaction: activeBatch };
    }
    const crossDbError = createCrossDatabaseBatchError(activeBatch.scope, scope);
    activeBatch.markRollbackOnly(crossDbError);
    return { kind: 'error', error: crossDbError };
  }

  if (existingTransaction && isTransactionPendingOrActive(existingTransaction)) {
    return {
      kind: 'error',
      error: domainError.infrastructure({
        code: 'domain_event.transaction_owner_required',
        message: `DomainWriteTransaction must own the top-level ${scope} transaction`,
      }),
    };
  }

  return { kind: 'standalone' };
};

/** Executes each post-commit task independently so one failure cannot drop subsequent tasks or fail an already-committed write. */
export const runAfterCommitTasksSafely = async (
  tasks: ReadonlyArray<UnitOfWorkAfterCommitHandler>,
  scope: UnitOfWorkScope,
  logger?: ILogger
): Promise<void> => {
  for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
    try {
      await tasks[taskIndex]!();
    } catch (error) {
      logger?.error('domain_event:batch_after_commit_task_failed', {
        scope,
        committed: true,
        taskIndex,
        errorType: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

/** Scopes savepoint `rollbackReason` and deferred tasks so a rolled-back savepoint does not poison the outer batch. */
export const runWithBatchSavepoint = async <T>(
  context: IExecutionContext,
  work: () => Promise<Result<T, DomainError>>
): Promise<Result<T, DomainError>> => {
  const activeBatch = isReusableBatchTransactionScope(context.batchTransaction)
    ? context.batchTransaction
    : undefined;
  if (activeBatch?.rollbackReason) {
    return err(activeBatch.rollbackReason);
  }
  const handle = activeBatch?.beginSavepoint?.();
  if (!handle) {
    return work();
  }

  let result: Result<T, DomainError>;
  try {
    result = await work();
  } catch (error) {
    handle.rollback();
    throw error;
  }

  if (result.isErr()) {
    handle.rollback();
    return result;
  }

  // An inner write failed inside the savepoint even though the callback returned ok():
  // roll back the savepoint's deferred tasks & rollbackReason instead of leaking either.
  if (handle.rollbackReason) {
    const poisoned = handle.rollbackReason;
    handle.rollback();
    return err(poisoned);
  }

  handle.commit();
  return result;
};

const runReenteredBatch = async <T>(
  context: IExecutionContext,
  batchTransaction: IDomainBatchTransactionScope,
  work: (batchContext: IExecutionContext) => Promise<Result<T, DomainError>>
): Promise<Result<T, DomainError>> => {
  let result: Result<T, DomainError>;
  try {
    result = await work(context);
  } catch (error) {
    batchTransaction.markRollbackOnly(domainError.fromUnknown(error));
    throw error;
  }
  return failBatchResultIfActive(context, result);
};

/** Executes a single-transaction batch scope, resetting deferred post-commit tasks on each retry attempt. */
export const runWithBatchTransaction = async <T>(params: {
  unitOfWork: IUnitOfWork;
  context: IExecutionContext;
  scope: UnitOfWorkScope;
  isolationLevel?: IUnitOfWorkOptions['isolationLevel'];
  onRetryExhausted?: IUnitOfWorkOptions['onRetryExhausted'];
  work: (batchContext: IExecutionContext) => Promise<Result<T, DomainError>>;
  logger?: ILogger;
}): Promise<Result<T, DomainError>> => {
  const { unitOfWork, context, scope, isolationLevel, onRetryExhausted, work, logger } = params;
  const scopeResolution = resolveBatchExecutionScope(context, scope);
  if (scopeResolution.kind === 'error') {
    return err(scopeResolution.error);
  }
  if (scopeResolution.kind === 'inBatch') {
    if (isolationLevel) {
      return unitOfWork.withTransaction(
        context,
        (tx) => runReenteredBatch(tx, scopeResolution.batchTransaction, work),
        { scope, isolationLevel }
      );
    }
    return runReenteredBatch(context, scopeResolution.batchTransaction, work);
  }

  let winningAfterCommitTasks: UnitOfWorkAfterCommitHandler[] = [];
  const transactionResult = await unitOfWork.withTransaction<T>(
    context,
    async (txContext) => {
      // Reset per attempt so unitOfWork deadlock/serialization retries never replay aborted tasks.
      const attemptAfterCommitTasks: UnitOfWorkAfterCommitHandler[] = [];
      winningAfterCommitTasks = attemptAfterCommitTasks;

      const ownerTransaction = getUnitOfWorkTransaction(txContext, scope);
      if (!ownerTransaction) {
        winningAfterCommitTasks = [];
        return err(
          domainError.infrastructure({
            code: 'domain_event.transaction_required',
            message: `Domain write batch requires an active ${scope} transaction`,
          })
        );
      }

      let rollbackReason: DomainError | undefined;
      const batchTransaction: IDomainBatchTransactionScope = {
        scope,
        ownerTransaction,
        get rollbackReason() {
          return rollbackReason;
        },
        markRollbackOnly(reason) {
          rollbackReason ??= reason;
        },
        enqueueAfterCommit(task) {
          attemptAfterCommitTasks.push(task);
        },
        beginSavepoint(): IDomainBatchSavepointHandle {
          const savedRollbackReason = rollbackReason;
          const taskCountBefore = attemptAfterCommitTasks.length;
          let settled = false;
          return {
            get rollbackReason() {
              return rollbackReason;
            },
            commit() {
              settled = true;
            },
            rollback() {
              if (settled) {
                return;
              }
              settled = true;
              attemptAfterCommitTasks.length = taskCountBefore;
              rollbackReason = savedRollbackReason;
            },
          };
        },
      };

      const batchContext: IExecutionContext = { ...txContext, batchTransaction };
      let workResult: Result<T, DomainError>;
      try {
        workResult = await work(batchContext);
      } catch (error) {
        winningAfterCommitTasks = [];
        batchTransaction.markRollbackOnly(domainError.fromUnknown(error));
        throw error;
      }

      if (workResult.isErr()) {
        winningAfterCommitTasks = [];
        batchTransaction.markRollbackOnly(workResult.error);
        return err(workResult.error);
      }
      if (rollbackReason) {
        winningAfterCommitTasks = [];
        return err(rollbackReason);
      }
      return workResult;
    },
    { scope, isolationLevel, onRetryExhausted }
  );

  if (transactionResult.isErr()) {
    return err(transactionResult.error);
  }

  await runAfterCommitTasksSafely(winningAfterCommitTasks, scope, logger);
  return ok(transactionResult.value);
};
