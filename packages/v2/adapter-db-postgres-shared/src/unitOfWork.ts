import type {
  IExecutionContext,
  IUnitOfWork,
  IUnitOfWorkTransaction,
  UnitOfWorkOperation,
  DomainError,
} from '@teable/v2-core';
import { domainError, isDomainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { Kysely, Transaction } from 'kysely';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2PostgresDbTokens } from './di/tokens';

class UnitOfWorkAbort extends Error {
  constructor(readonly error: DomainError) {
    super(error.message);
    this.name = 'UnitOfWorkAbort';
  }
}

export class PostgresUnitOfWorkTransaction<DB> implements IUnitOfWorkTransaction {
  readonly kind = 'unitOfWorkTransaction' as const;

  constructor(readonly db: Transaction<DB>) {}
}

export const getPostgresTransaction = <DB>(context: IExecutionContext): Transaction<DB> | null => {
  const transaction = context.transaction;
  if (transaction instanceof PostgresUnitOfWorkTransaction) {
    return transaction.db as Transaction<DB>;
  }
  return null;
};

export const resolvePostgresDb = <DB>(
  db: Kysely<DB>,
  context: IExecutionContext
): Kysely<DB> | Transaction<DB> => {
  return getPostgresTransaction<DB>(context) ?? db;
};

@injectable()
export class PostgresUnitOfWork<DB = unknown> implements IUnitOfWork {
  constructor(
    @inject(v2PostgresDbTokens.db)
    private readonly db: Kysely<DB>
  ) {}

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
    if (context.transaction) {
      if (context.transaction instanceof PostgresUnitOfWorkTransaction) {
        return work(context);
      }
      return err(domainError.validation({ message: 'Unsupported transaction context' }));
    }

    const maxRetries = 3;
    let attempt = 0;

    // Retry only for top-level transactions, and only for retryable infra failures.
    // Nested transactions must not retry because they share an outer transaction scope.
    // Keep delays tiny because this is often used in request/response paths.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.db.transaction().execute(async (trx) => {
          const transactionContext: IExecutionContext = {
            ...context,
            transaction: new PostgresUnitOfWorkTransaction(trx),
          };

          const workResult = await work(transactionContext);
          if (workResult.isErr()) {
            throw new UnitOfWorkAbort(workResult.error);
          }

          return workResult;
        });
      } catch (error) {
        if (error instanceof UnitOfWorkAbort) {
          if (attempt < maxRetries && isRetryableTransactionAbort(error.error)) {
            const delayMs = backoffMs(attempt);
            attempt += 1;
            await sleep(delayMs);
            continue;
          }
          return err(error.error);
        }
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
