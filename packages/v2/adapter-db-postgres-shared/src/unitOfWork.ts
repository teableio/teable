import { randomInt } from 'node:crypto';
import { randomIntBelow } from './random';
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
import { sql, type Kysely, type Transaction } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IV2PostgresDbConfig } from './config';
import { v2DataDbTokens, v2MetaDbTokens } from './di/tokens';
import { getPostgresSqlExecutionDiagnostics } from './PostgresSqlExecutionError';

class UnitOfWorkAbort extends Error {
  constructor(readonly error: DomainError) {
    super(error.message);
    this.name = 'UnitOfWorkAbort';
    if (error.stack) {
      this.stack = error.stack;
    }
  }
}

const throwIfUnitOfWorkFailed = <T>(result: Result<T, DomainError>): void => {
  if (result.isErr()) {
    throw new UnitOfWorkAbort(result.error);
  }
};

const toUnexpectedUnitOfWorkError = (error: unknown): DomainError => {
  const postgresSql = getPostgresSqlExecutionDiagnostics(error);
  return domainError.unexpected({
    message: `Unexpected unit of work error: ${describeError(error)}`,
    ...(postgresSql ? { details: { postgresSql } } : {}),
  });
};

const shouldRetryTransactionAbort = (
  error: DomainError,
  attempt: number,
  maxRetries: number
): boolean => attempt < maxRetries && isRetryableTransactionAbort(error);
type UnitOfWorkTransactionState =
  | 'pending'
  | 'committing'
  | 'committed'
  | 'rollingBack'
  | 'rolledBack';

export class PostgresUnitOfWorkTransaction<DB> implements IUnitOfWorkTransaction {
  readonly kind = 'unitOfWorkTransaction' as const;
  private readonly afterCommitHandlers: UnitOfWorkAfterCommitHandler[] = [];
  private readonly afterRollbackHandlers: UnitOfWorkAfterCommitHandler[] = [];
  private state: UnitOfWorkTransactionState = 'pending';

  constructor(
    readonly db: Transaction<DB>,
    readonly scope: UnitOfWorkScope
  ) {}

  get pending(): boolean {
    return this.state === 'pending';
  }

  get committed(): boolean {
    return this.state === 'committed';
  }

  get rolledBack(): boolean {
    return this.state === 'rolledBack';
  }

  afterCommit(handler: UnitOfWorkAfterCommitHandler): void {
    if (this.state === 'committed') {
      void handler();
      return;
    }

    if (this.state === 'rollingBack' || this.state === 'rolledBack') {
      return;
    }

    this.afterCommitHandlers.push(handler);
  }

  afterRollback(handler: UnitOfWorkAfterCommitHandler): void {
    if (this.state === 'rolledBack') {
      void handler();
      return;
    }

    if (this.state === 'committing' || this.state === 'committed') {
      return;
    }

    this.afterRollbackHandlers.push(handler);
  }

  async runAfterCommitHandlers(): Promise<void> {
    if (this.state !== 'pending') {
      return;
    }

    this.state = 'committing';
    while (this.afterCommitHandlers.length > 0) {
      const handler = this.afterCommitHandlers.shift();
      if (!handler) {
        continue;
      }
      await handler();
    }
    this.state = 'committed';
  }

  async runAfterRollbackHandlers(): Promise<void> {
    if (this.state !== 'pending') {
      return;
    }

    this.state = 'rollingBack';
    while (this.afterRollbackHandlers.length > 0) {
      const handler = this.afterRollbackHandlers.shift();
      if (!handler) {
        continue;
      }
      await handler();
    }
    this.state = 'rolledBack';
  }
}

type PostgresUnitOfWorkTransactionLike<DB> = IUnitOfWorkTransaction & {
  readonly db: Transaction<DB>;
};

const isPostgresUnitOfWorkTransaction = <DB>(
  transaction: IUnitOfWorkTransaction | undefined
): transaction is PostgresUnitOfWorkTransaction<DB> | PostgresUnitOfWorkTransactionLike<DB> => {
  if (!transaction) {
    return false;
  }
  if (transaction instanceof PostgresUnitOfWorkTransaction) {
    return true;
  }
  return (
    transaction.kind === 'unitOfWorkTransaction' && 'db' in transaction && transaction.db != null
  );
};

/**
 * A transaction is only reusable while pending. Once commit or rollback starts,
 * kysely has already released the underlying connection back to the pool, so
 * reusing the handle would write through a connection another request may own.
 */
const isReusablePostgresTransaction = <DB>(
  transaction: IUnitOfWorkTransaction | undefined
): transaction is PostgresUnitOfWorkTransaction<DB> | PostgresUnitOfWorkTransactionLike<DB> => {
  if (!isPostgresUnitOfWorkTransaction<DB>(transaction)) {
    return false;
  }
  if (transaction.pending !== undefined) {
    return transaction.pending;
  }
  return !transaction.committed && !transaction.rolledBack;
};

export const getPostgresTransaction = <DB>(
  context?: IExecutionContext,
  scope: UnitOfWorkScope = 'data'
): Transaction<DB> | null => {
  const transaction = getUnitOfWorkTransaction(context, scope);
  if (isReusablePostgresTransaction<DB>(transaction)) {
    return transaction.db as Transaction<DB>;
  }

  const activeTransaction = context?.transaction;
  if (
    activeTransaction !== transaction &&
    (!activeTransaction?.scope || activeTransaction.scope === scope) &&
    isReusablePostgresTransaction<DB>(activeTransaction)
  ) {
    return activeTransaction.db as Transaction<DB>;
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

  private savepointSequence = 0;

  private usesSinglePhysicalDatabase(): boolean {
    return (
      this.metaDb === this.dataDb ||
      (this.metaConfig.pg.connectionString === this.dataConfig.pg.connectionString &&
        this.metaConfig.pg.schema === this.dataConfig.pg.schema)
    );
  }

  private bindTransactionToPhysicalDatabaseScopes(
    context: IExecutionContext,
    transaction: PostgresUnitOfWorkTransaction<DB>,
    scope: UnitOfWorkScope
  ): IExecutionContext {
    const transactionContext = bindUnitOfWorkTransaction(context, transaction);
    if (!this.usesSinglePhysicalDatabase()) {
      return transactionContext;
    }

    const siblingScope: UnitOfWorkScope = scope === 'meta' ? 'data' : 'meta';
    return {
      ...transactionContext,
      transactions: {
        ...transactionContext.transactions,
        [scope]: transaction,
        [siblingScope]: transaction,
      },
    };
  }

  private async setTransactionSchema(
    transaction: Transaction<DB>,
    scope: UnitOfWorkScope
  ): Promise<void> {
    const schema = scope === 'meta' ? this.metaConfig.pg.schema : this.dataConfig.pg.schema;
    if (!schema) return;

    await sql`
      select set_config(
        'search_path',
        ${`${schema}, public`} || coalesce((
          select ', ' || quote_ident(n.nspname)
          from pg_extension e
          join pg_namespace n on n.oid = e.extnamespace
          where e.extname = 'pg_trgm'
        ), ''),
        true
      )
    `.execute(transaction);
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
    if (!isReusablePostgresTransaction<DB>(siblingTransaction)) {
      return null;
    }

    return {
      ...context,
      transaction: siblingTransaction,
      transactions: {
        ...context.transactions,
        ...(siblingTransaction.scope ? { [siblingTransaction.scope]: siblingTransaction } : {}),
        [scope]: siblingTransaction,
      },
    };
  }

  private runWithExistingTransaction<T>(
    context: IExecutionContext,
    scope: UnitOfWorkScope,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> | null {
    const existingTransaction = getUnitOfWorkTransaction(context, scope);
    if (!existingTransaction) return null;
    if (!isPostgresUnitOfWorkTransaction<DB>(existingTransaction)) {
      return Promise.resolve(
        err(domainError.validation({ message: 'Unsupported transaction context' }))
      );
    }
    if (!isReusablePostgresTransaction<DB>(existingTransaction)) {
      // The bound transaction is already committing/committed/rolled back and its
      // connection was released to the pool. Fall through to a fresh transaction
      // instead of silently writing through the dead handle.
      return null;
    }
    return work(activateUnitOfWorkScope(context, scope));
  }

  private async executeWithRetries<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    scope: UnitOfWorkScope,
    retry: boolean
  ): Promise<Result<T, DomainError>> {
    const db = scope === 'meta' ? this.metaDb : this.dataDb;
    const maxRetries = retry ? 3 : 0;
    let attempt = 0;

    // Retry only for top-level transactions, and only for retryable infra failures.
    // Nested transactions must not retry because they share an outer transaction scope.
    // Keep delays tiny because this is often used in request/response paths.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let transaction: PostgresUnitOfWorkTransaction<DB> | undefined;
      try {
        const transactionResult = await db.transaction().execute(async (trx) => {
          await this.setTransactionSchema(trx, scope);
          transaction = new PostgresUnitOfWorkTransaction(trx, scope);
          const transactionContext = this.bindTransactionToPhysicalDatabaseScopes(
            context,
            transaction,
            scope
          );

          const workResult = await work(transactionContext);
          throwIfUnitOfWorkFailed(workResult);

          return { workResult, transaction };
        });
        await transactionResult.transaction.runAfterCommitHandlers();
        return transactionResult.workResult;
      } catch (error) {
        if (error instanceof UnitOfWorkAbort) {
          if (shouldRetryTransactionAbort(error.error, attempt, maxRetries)) {
            const delayMs = backoffMs(attempt);
            attempt += 1;
            await sleep(delayMs);
            continue;
          }
          await transaction?.runAfterRollbackHandlers();
          return err(error.error);
        }
        await transaction?.runAfterRollbackHandlers();
        return err(toUnexpectedUnitOfWorkError(error));
      }
    }
  }

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>> {
    const scope = options?.scope ?? 'data';
    const existingResult = this.runWithExistingTransaction(context, scope, work);
    if (existingResult) return existingResult;

    const sharedTransactionContext = this.reuseSiblingScopeTransaction(context, scope);
    if (sharedTransactionContext) {
      return work(sharedTransactionContext);
    }

    return this.executeWithRetries(context, work, scope, options?.retry !== false);
  }

  /**
   * Runs `work` inside `SAVEPOINT` / `RELEASE SAVEPOINT`, rolling back to the
   * savepoint when `work` fails. PostgreSQL aborts the whole transaction after a
   * statement error, so recovery from a deliberate error (unique constraint race)
   * is only possible inside a savepoint.
   */
  async savepoint<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
    const transaction = getPostgresTransaction<DB>(context, 'data');
    if (!transaction) {
      return err(
        domainError.infrastructure({
          code: 'unit_of_work.transaction_required',
          message: 'Savepoint requires an active data transaction',
        })
      );
    }

    const name = `v2_sp_${(this.savepointSequence = (this.savepointSequence + 1) % 1_000_000)}_${randomInt(1_000_000)}`;

    try {
      await sql`savepoint ${sql.id(name)}`.execute(transaction);
    } catch (error) {
      return err(toUnexpectedUnitOfWorkError(error));
    }

    let result: Result<T, DomainError>;
    try {
      result = await work(context);
    } catch (error) {
      await this.rollbackSavepoint(transaction, name);
      throw error;
    }

    if (result.isErr()) {
      const rollbackResult = await this.rollbackSavepoint(transaction, name);
      if (rollbackResult.isErr()) {
        return err(rollbackResult.error);
      }
      return result;
    }

    try {
      await sql`release savepoint ${sql.id(name)}`.execute(transaction);
    } catch (error) {
      return err(toUnexpectedUnitOfWorkError(error));
    }

    return result;
  }

  private async rollbackSavepoint(
    transaction: Transaction<DB>,
    name: string
  ): Promise<Result<void, DomainError>> {
    try {
      await sql`rollback to savepoint ${sql.id(name)}`.execute(transaction);
      await sql`release savepoint ${sql.id(name)}`.execute(transaction);
      return ok(undefined);
    } catch (error) {
      return err(toUnexpectedUnitOfWorkError(error));
    }
  }
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
};

const backoffMs = (attempt: number): number => {
  const base = 5 * 2 ** attempt;
  const jitter = randomIntBelow(10);
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
