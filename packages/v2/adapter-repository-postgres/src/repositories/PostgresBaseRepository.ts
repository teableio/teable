import * as core from '@teable/v2-core';
import { domainError, isDomainError, type DomainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely, sql, type Transaction } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2PostgresStateTokens } from '../di/tokens';

const DEFAULT_SPACE_ID = 'spc00000000000000000';

@injectable()
export class PostgresBaseRepository implements core.IBaseRepository {
  constructor(
    @inject(v2PostgresStateTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  @core.TraceSpan()
  async insert(
    context: core.IExecutionContext,
    base: core.Base
  ): Promise<Result<core.Base, DomainError>> {
    const now = new Date();
    const actorId = context.actorId.toString();

    const transaction = getPostgresTransaction<V1TeableDatabase>(context);
    const persist = async (trx: Kysely<V1TeableDatabase>): Promise<Result<void, DomainError>> => {
      const order = sql<number>`
        (
          select coalesce(max("order"), 0) + 1
          from base
          where space_id = ${DEFAULT_SPACE_ID}
        )
      `;

      await sql`
        insert into ${sql.ref('base')} (id, space_id, name, "order", icon, schema_pass, deleted_time, created_time, created_by, last_modified_by, last_modified_time)
        values (
          ${base.id().toString()},
          ${DEFAULT_SPACE_ID},
          ${base.name().toString()},
          ${order},
          null,
          null,
          null,
          ${now},
          ${actorId},
          ${actorId},
          ${now}
        )
      `.execute(trx);

      return ok(undefined);
    };

    try {
      const persistResult = transaction
        ? await persist(transaction)
        : await this.db.transaction().execute(async (trx) => persist(trx));
      if (persistResult.isErr()) return err(persistResult.error);
    } catch (error) {
      return err(
        domainError.infrastructure({ message: `Failed to insert base: ${describeError(error)}` })
      );
    }

    return ok(base);
  }

  @core.TraceSpan()
  async findOne(
    context: core.IExecutionContext,
    baseId: core.BaseId
  ): Promise<Result<core.Base | null, DomainError>> {
    try {
      const db = resolvePostgresDb(this.db, context);
      const row = await db
        .selectFrom('base')
        .select(['id', 'name'])
        .where('id', '=', baseId.toString())
        .where('deleted_time', 'is', null)
        .executeTakeFirst();

      if (!row) return ok(null);

      const baseResult = this.mapBaseRow(row);
      if (baseResult.isErr()) return err(baseResult.error);

      return ok(baseResult.value);
    } catch (error) {
      return err(
        domainError.unexpected({ message: `Failed to load base: ${describeError(error)}` })
      );
    }
  }

  @core.TraceSpan()
  async find(
    context: core.IExecutionContext,
    pagination: core.OffsetPagination
  ): Promise<Result<core.IFindBasesResult, DomainError>> {
    try {
      const db = resolvePostgresDb(this.db, context);

      // Get total count
      const countResult = await db
        .selectFrom('base')
        .select(db.fn.count('id').as('count'))
        .where('deleted_time', 'is', null)
        .executeTakeFirst();

      const total = Number(countResult?.count ?? 0);

      // Get paginated bases
      const rows = await db
        .selectFrom('base')
        .select(['id', 'name'])
        .where('deleted_time', 'is', null)
        .orderBy('order', 'asc')
        .limit(pagination.limit().toNumber())
        .offset(pagination.offset().toNumber())
        .execute();

      const basesResult = this.sequenceResults(rows.map((row) => this.mapBaseRow(row)));
      if (basesResult.isErr()) return err(basesResult.error);

      return ok({
        bases: basesResult.value,
        total,
      });
    } catch (error) {
      return err(
        domainError.unexpected({ message: `Failed to load bases: ${describeError(error)}` })
      );
    }
  }

  private mapBaseRow(row: { id: string; name: string }): Result<core.Base, DomainError> {
    const baseIdResult = core.BaseId.create(row.id);
    if (baseIdResult.isErr()) return err(baseIdResult.error);

    const baseNameResult = core.BaseName.create(row.name);
    if (baseNameResult.isErr()) return err(baseNameResult.error);

    return core.Base.rehydrate({
      id: baseIdResult.value,
      name: baseNameResult.value,
    });
  }

  private sequenceResults<T>(
    values: ReadonlyArray<Result<T, DomainError>>
  ): Result<ReadonlyArray<T>, DomainError> {
    return values.reduce<Result<ReadonlyArray<T>, DomainError>>(
      (acc, next) => acc.andThen((arr) => next.map((v) => [...arr, v])),
      ok([])
    );
  }
}

type PostgresTransactionContext<DB> = {
  kind: 'unitOfWorkTransaction';
  db: Transaction<DB>;
};

const getPostgresTransaction = <DB>(context: core.IExecutionContext): Transaction<DB> | null => {
  const transaction = context.transaction as Partial<PostgresTransactionContext<DB>> | undefined;
  if (transaction?.kind === 'unitOfWorkTransaction' && transaction.db) {
    return transaction.db as Transaction<DB>;
  }
  return null;
};

const resolvePostgresDb = <DB>(
  db: Kysely<DB>,
  context: core.IExecutionContext
): Kysely<DB> | Transaction<DB> => {
  return getPostgresTransaction<DB>(context) ?? db;
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
