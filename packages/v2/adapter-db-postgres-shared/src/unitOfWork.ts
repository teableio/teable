import type {
  IUnitOfWorkOptions,
  IExecutionContext,
  IUnitOfWork,
  IUnitOfWorkTransaction,
  UnitOfWorkScope,
  UnitOfWorkAfterCommitHandler,
  UnitOfWorkOperation,
  DomainError,
} from '@teable/v2-core';
import {
  activateUnitOfWorkScope,
  bindUnitOfWorkTransaction,
  domainError,
  getUnitOfWorkTransaction,
  isDomainError,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { Kysely, Transaction } from 'kysely';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IV2PostgresDbConfig } from './config';
import { v2DataDbTokens, v2MetaDbTokens } from './di/tokens';

class UnitOfWorkAbort extends Error {
  constructor(readonly error: DomainError) {
    super(error.message);
    this.name = 'UnitOfWorkAbort';
  }
}

export class PostgresUnitOfWorkTransaction<DB> implements IUnitOfWorkTransaction {
  readonly kind = 'unitOfWorkTransaction' as const;
  private readonly afterCommitHandlers: UnitOfWorkAfterCommitHandler[] = [];
  private readonly afterRollbackHandlers: UnitOfWorkAfterCommitHandler[] = [];

  constructor(
    readonly db: Transaction<DB>,
    readonly scope: UnitOfWorkScope
  ) {}

  afterCommit(handler: UnitOfWorkAfterCommitHandler): void {
    this.afterCommitHandlers.push(handler);
  }

  afterRollback(handler: UnitOfWorkAfterCommitHandler): void {
    this.afterRollbackHandlers.push(handler);
  }

  async runAfterCommitHandlers(): Promise<void> {
    for (const handler of this.afterCommitHandlers) {
      await handler();
    }
  }

  async runAfterRollbackHandlers(): Promise<void> {
    for (const handler of this.afterRollbackHandlers) {
      await handler();
    }
  }
}

export const getPostgresTransaction = <DB>(
  context?: IExecutionContext,
  scope: UnitOfWorkScope = 'data'
): Transaction<DB> | null => {
  const transaction = getUnitOfWorkTransaction(context, scope);
  if (transaction instanceof PostgresUnitOfWorkTransaction) {
    return transaction.db as Transaction<DB>;
  }
  return null;
};

export const resolvePostgresDbOrTx = <DB>(
  db: Kysely<DB>,
  context?: IExecutionContext,
  scope: UnitOfWorkScope = 'data'
): Kysely<DB> | Transaction<DB> => {
  return getPostgresTransaction<DB>(context, scope) ?? db;
};

@injectable()
export class PostgresUnitOfWork<DB = unknown> implements IUnitOfWork {
  constructor(
    @inject(v2MetaDbTokens.db)
    private readonly metaDb: Kysely<DB>,
    @inject(v2DataDbTokens.db)
    private readonly dataDb: Kysely<DB>,
    @inject(v2MetaDbTokens.config)
    private readonly metaConfig: IV2PostgresDbConfig,
    @inject(v2DataDbTokens.config)
    private readonly dataConfig: IV2PostgresDbConfig
  ) {}

  private usesSinglePhysicalDatabase(): boolean {
    return (
      this.metaDb === this.dataDb ||
      this.metaConfig.pg.connectionString === this.dataConfig.pg.connectionString
    );
  }

  private reuseSiblingScopeTransaction(
    context: IExecutionContext,
    scope: UnitOfWorkScope
  ): IExecutionContext | null {
    if (!this.usesSinglePhysicalDatabase()) {
      return null;
    }

    const siblingScope: UnitOfWorkScope = scope === 'meta' ? 'data' : 'meta';
    const siblingTransaction = getUnitOfWorkTransaction(context, siblingScope);
    if (!siblingTransaction) {
      return null;
    }

    return {
      ...context,
      transaction: siblingTransaction,
      transactions: {
        ...(context.transactions ?? {}),
        ...(siblingTransaction.scope ? { [siblingTransaction.scope]: siblingTransaction } : {}),
        [scope]: siblingTransaction,
      },
    };
  }

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>> {
    const scope = options?.scope ?? 'data';
    const existingTransaction = getUnitOfWorkTransaction(context, scope);

    if (existingTransaction) {
      if (existingTransaction instanceof PostgresUnitOfWorkTransaction) {
        return work(activateUnitOfWorkScope(context, scope));
      }
      return err(domainError.validation({ message: 'Unsupported transaction context' }));
    }

    const sharedTransactionContext = this.reuseSiblingScopeTransaction(context, scope);
    if (sharedTransactionContext) {
      return work(sharedTransactionContext);
    }

    const db = scope === 'meta' ? this.metaDb : this.dataDb;
    const maxRetries = 3;
    let attempt = 0;

    // Retry only for top-level transactions, and only for retryable infra failures.
    // Nested transactions must not retry because they share an outer transaction scope.
    // Keep delays tiny because this is often used in request/response paths.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let transaction: PostgresUnitOfWorkTransaction<DB> | undefined;
      try {
        const transactionResult = await db.transaction().execute(async (trx) => {
          transaction = new PostgresUnitOfWorkTransaction(trx, scope);
          const transactionContext = bindUnitOfWorkTransaction(context, transaction);

          const workResult = await work(transactionContext);
          if (workResult.isErr()) {
            throw new UnitOfWorkAbort(workResult.error);
          }

          return { workResult, transaction };
        });
        await transactionResult.transaction.runAfterCommitHandlers();
        return transactionResult.workResult;
      } catch (error) {
        if (error instanceof UnitOfWorkAbort) {
          if (attempt < maxRetries && isRetryableTransactionAbort(error.error)) {
            const delayMs = backoffMs(attempt);
            attempt += 1;
            await sleep(delayMs);
            continue;
          }
          await transaction?.runAfterRollbackHandlers();
          return err(error.error);
        }
        await transaction?.runAfterRollbackHandlers();
        return err(
          domainError.unexpected({
            message: `Unexpected unit of work error: ${describeError(error)}`,
          })
        );
      }
    }
  }
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
};

const backoffMs = (attempt: number): number => {
  const base = 5 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 10);
  return base + jitter;
};

const isRetryableTransactionAbort = (error: DomainError): boolean => {
  if (!error.tags.includes('infrastructure')) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('deadlock detected') ||
    message.includes('could not serialize access') ||
    message.includes('serialization failure')
  );
};

const describeError = (error: unknown): string => {
  if (isDomainError(error)) return error.message;
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
};
