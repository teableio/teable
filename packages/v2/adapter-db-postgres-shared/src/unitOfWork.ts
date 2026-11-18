import { randomInt } from 'node:crypto';
import type {
  IDomainBatchTransactionScope,
  IUnitOfWorkOptions,
  IExecutionContext,
  IUnitOfWork,
  IUnitOfWorkTransaction,
  IUnitOfWorkTransactionSavepointHandle,
  UnitOfWorkScope,
  UnitOfWorkAfterCommitHandler,
  UnitOfWorkOperation,
  DomainError,
} from '@teable/v2-core';
import {
  activateUnitOfWorkScope,
  bindUnitOfWorkTransaction,
  createCrossDatabaseBatchError,
  domainError,
  getUnitOfWorkTransaction,
  isDomainError,
  isReusableBatchTransactionScope,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { sql, type Kysely, type Transaction } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IV2PostgresDbConfig } from './config';
import { v2DataDbTokens, v2MetaDbTokens } from './di/tokens';
import { getPostgresSqlExecutionDiagnostics } from './PostgresSqlExecutionError';
import { randomIntBelow } from './random';

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

  beginSavepoint(): IUnitOfWorkTransactionSavepointHandle {
    const afterCommitCountBefore = this.afterCommitHandlers.length;
    const afterRollbackCountBefore = this.afterRollbackHandlers.length;
    let settled = false;
    return {
      commit: () => {
        settled = true;
      },
      rollback: async () => {
        if (settled || this.state !== 'pending') {
          return;
        }
        settled = true;
        this.afterCommitHandlers.length = afterCommitCountBefore;
        const rolledBackHandlers = this.afterRollbackHandlers.splice(afterRollbackCountBefore);
        for (const handler of rolledBackHandlers) {
          await handler();
        }
      },
    };
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

const getReusablePostgresUnitOfWorkTransaction = <DB>(
  context?: IExecutionContext,
  scope: UnitOfWorkScope = 'data'
): PostgresUnitOfWorkTransaction<DB> | PostgresUnitOfWorkTransactionLike<DB> | null => {
  const transaction = getUnitOfWorkTransaction(context, scope);
  if (isReusablePostgresTransaction<DB>(transaction)) {
    return transaction;
  }

  const activeTransaction = context?.transaction;
  if (
    activeTransaction !== transaction &&
    (!activeTransaction?.scope || activeTransaction.scope === scope) &&
    isReusablePostgresTransaction<DB>(activeTransaction)
  ) {
    return activeTransaction;
  }

  return null;
};

export const getPostgresTransaction = <DB>(
  context?: IExecutionContext,
  scope: UnitOfWorkScope = 'data'
): Transaction<DB> | null => {
  return (
    (getReusablePostgresUnitOfWorkTransaction<DB>(context, scope)?.db as Transaction<DB>) ?? null
  );
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

  private async trackBatchTransactionOutcome<T>(
    batchTx: IDomainBatchTransactionScope | undefined,
    workPromise: Promise<Result<T, DomainError>>
  ): Promise<Result<T, DomainError>> {
    if (!batchTx) {
      return workPromise;
    }
    try {
      const result = await workPromise;
      if (result.isErr()) {
        batchTx.markRollbackOnly(result.error);
        return result;
      }
      if (batchTx.rollbackReason) {
        return err(batchTx.rollbackReason);
      }
      return result;
    } catch (error) {
      batchTx.markRollbackOnly(toUnexpectedUnitOfWorkError(error));
      throw error;
    }
  }

  private async handleRetryableFailure(
    transaction: PostgresUnitOfWorkTransaction<DB> | undefined,
    error: unknown,
    attempt: number,
    maxRetries: number,
    retry: boolean
  ): Promise<Result<never, DomainError> | 'retry'> {
    await transaction?.runAfterRollbackHandlers();
    if (error instanceof UnitOfWorkAbort) {
      if (shouldRetryTransactionAbort(error.error, attempt, maxRetries)) {
        await sleep(backoffMs(attempt));
        return 'retry';
      }
      return err(error.error);
    }
    const sqlState = extractPgSqlState(error);
    if (retry && attempt < maxRetries && isRetryablePgSqlState(sqlState)) {
      await sleep(backoffMs(attempt));
      return 'retry';
    }
    return err(toUnexpectedUnitOfWorkError(error));
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
        const outcome = await this.handleRetryableFailure(
          transaction,
          error,
          attempt,
          maxRetries,
          retry
        );
        if (outcome === 'retry') {
          attempt += 1;
          continue;
        }
        return outcome;
      }
    }
  }

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>> {
    const scope = options?.scope ?? 'data';
    const batchTx = isReusableBatchTransactionScope(context.batchTransaction)
      ? context.batchTransaction
      : undefined;
    if (batchTx?.rollbackReason) {
      return err(batchTx.rollbackReason);
    }

    const existingResult = this.runWithExistingTransaction(context, scope, work);
    if (existingResult) {
      return this.trackBatchTransactionOutcome(batchTx, existingResult);
    }

    const sharedTransactionContext = this.reuseSiblingScopeTransaction(context, scope);
    if (sharedTransactionContext) {
      return this.trackBatchTransactionOutcome(batchTx, work(sharedTransactionContext));
    }

    if (batchTx) {
      const crossDbError = createCrossDatabaseBatchError(batchTx.scope, scope);
      batchTx.markRollbackOnly(crossDbError);
      return err(crossDbError);
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
    const batchTx = isReusableBatchTransactionScope(context.batchTransaction)
      ? context.batchTransaction
      : undefined;
    if (batchTx?.rollbackReason) {
      return err(batchTx.rollbackReason);
    }

    const uowTransaction = getReusablePostgresUnitOfWorkTransaction<DB>(context, 'data');
    if (!uowTransaction) {
      return err(
        domainError.infrastructure({
          code: 'unit_of_work.transaction_required',
          message: 'Savepoint requires an active data transaction',
        })
      );
    }
    const transaction = uowTransaction.db as Transaction<DB>;

    const name = `v2_sp_${(this.savepointSequence = (this.savepointSequence + 1) % 1_000_000)}_${randomInt(1_000_000)}`;

    try {
      await sql`savepoint ${sql.id(name)}`.execute(transaction);
    } catch (error) {
      return err(toUnexpectedUnitOfWorkError(error));
    }

    const batchSavepoint = batchTx?.beginSavepoint?.();
    const txSavepoint = uowTransaction.beginSavepoint?.();
    let result: Result<T, DomainError>;
    try {
      result = await work(context);
    } catch (error) {
      await this.rollbackSavepoint(transaction, name);
      batchSavepoint?.rollback();
      await txSavepoint?.rollback();
      throw error;
    }

    const poisonedInSavepoint = result.isOk() ? batchSavepoint?.rollbackReason : undefined;
    if (result.isErr() || poisonedInSavepoint) {
      const failureReason = result.isErr() ? result.error : poisonedInSavepoint!;
      const rollbackResult = await this.rollbackSavepoint(transaction, name);
      batchSavepoint?.rollback();
      await txSavepoint?.rollback();
      if (rollbackResult.isErr()) {
        batchTx?.markRollbackOnly(rollbackResult.error);
        return err(rollbackResult.error);
      }
      return err(failureReason);
    }

    try {
      await sql`release savepoint ${sql.id(name)}`.execute(transaction);
    } catch (error) {
      batchSavepoint?.rollback();
      await txSavepoint?.rollback();
      const releaseError = toUnexpectedUnitOfWorkError(error);
      batchTx?.markRollbackOnly(releaseError);
      return err(releaseError);
    }

    txSavepoint?.commit();
    batchSavepoint?.commit();
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

const isRetryablePgSqlState = (sqlState: string | undefined): boolean =>
  sqlState === '40P01' || sqlState === '40001';

const extractPgSqlState = (error: unknown): string | undefined => {
  const fromDiag = getPostgresSqlExecutionDiagnostics(error)?.postgres?.sqlState;
  if (fromDiag) return fromDiag;
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    const cause = (error as { cause?: unknown }).cause;
    if (cause) return extractPgSqlState(cause);
  }
  return undefined;
};

const isRetryableTransactionAbort = (error: DomainError): boolean => {
  if (!error.tags.includes('infrastructure')) return false;
  const sqlState =
    typeof error.details?.postgresSql === 'object' && error.details.postgresSql !== null
      ? (error.details.postgresSql as { postgres?: { sqlState?: string } }).postgres?.sqlState
      : undefined;
  if (isRetryablePgSqlState(sqlState)) return true;
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
