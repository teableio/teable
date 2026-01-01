import * as core from '@teable/v2-core';
import {
  domainError,
  type ILogger,
  isDomainError,
  v2CoreTokens,
  type DomainError,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely, Transaction } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2PostgresStateTokens } from '../di/tokens';
import {
  FieldOutputColumnVisitor,
  type FieldOutputColumn,
} from '../query-builder/FieldOutputColumnVisitor';
import { PostgresTableRecordQueryBuilder } from '../query-builder/TableRecordQueryBuilder';

const RECORD_ID_COLUMN = '__id';

@injectable()
export class PostgresTableRecordQueryRepository implements core.ITableRecordQueryRepository {
  constructor(
    @inject(v2PostgresStateTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger
  ) {}

  async find(
    context: core.IExecutionContext,
    table: core.Table,
    _spec?: core.ISpecification<core.TableRecord, core.ITableRecordConditionSpecVisitor>,
    options?: core.ITableRecordQueryOptions
  ): Promise<Result<ReadonlyArray<core.TableRecordReadModel>, DomainError>> {
    return safeTry<ReadonlyArray<core.TableRecordReadModel>, DomainError>(
      async function* (this: PostgresTableRecordQueryRepository) {
        const db = resolvePostgresDb(this.db, context);

        // Build query using the new query builder
        const queryBuilder = new PostgresTableRecordQueryBuilder(
          db as unknown as Kysely<Record<string, Record<string, unknown>>>
        );
        const builtQuery = yield* queryBuilder
          .from(table, { foreignTables: options?.foreignTables })
          // TODO: Apply spec/filter to the query
          .build();

        const compiled = builtQuery.compile();
        this.logger.debug(`find:sql\n${compiled.sql}`, { parameters: compiled.parameters });

        // Collect field column mappings
        const fieldColumns = yield* new FieldOutputColumnVisitor().collect(table);

        try {
          const rows = await builtQuery.execute();
          const records = mapRowsToReadModels(fieldColumns, rows);
          return ok(records);
        } catch (error) {
          return err(
            domainError.unexpected({
              message: `Failed to load table records: ${describeError(error)}`,
            })
          );
        }
      }.bind(this)
    );
  }
}

const mapRowsToReadModels = (
  fieldColumns: ReadonlyArray<FieldOutputColumn>,
  rows: ReadonlyArray<Record<string, unknown>>
): ReadonlyArray<core.TableRecordReadModel> => {
  return rows.map((row) => {
    const rawId = row[RECORD_ID_COLUMN];
    const id = typeof rawId === 'string' ? rawId : String(rawId);

    const fields: Record<string, unknown> = {};
    for (const column of fieldColumns) {
      fields[column.fieldId.toString()] = row[column.columnAlias];
    }
    return { id, fields };
  });
};

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
