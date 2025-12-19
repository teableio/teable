import type {
  IExecutionContext,
  IUnitOfWork,
  IUnitOfWorkTransaction,
  UnitOfWorkOperation,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { Kysely, Transaction } from 'kysely';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2PostgresDbTokens } from './di/tokens';

class UnitOfWorkAbort extends Error {
  constructor(message: string) {
    super(message);
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
  ): Promise<Result<T, string>> {
    if (context.transaction) {
      if (context.transaction instanceof PostgresUnitOfWorkTransaction) {
        return work(context);
      }
      return err('Unsupported transaction context');
    }

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
      if (error instanceof UnitOfWorkAbort) return err(error.message);
      return err(`Unexpected unit of work error: ${describeError(error)}`);
    }
  }
}

const describeError = (error: unknown): string => {
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
