import * as core from '@teable/v2-core';
import { domainError, isDomainError, type DomainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Expression, Kysely, SqlBool, Transaction } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2PostgresStateTokens } from '../di/tokens';
import {
  TableRecordConditionWhereVisitor,
  type RecordConditionWhere,
} from './visitors/TableRecordConditionWhereVisitor';
import {
  TableRecordSelectColumnsVisitor,
  type FieldColumn,
} from './visitors/TableRecordSelectColumnsVisitor';

const recordIdColumn = '__id';
const autoNumberColumn = '__auto_number';

@injectable()
export class PostgresTableRecordQueryRepository implements core.ITableRecordQueryRepository {
  constructor(
    @inject(v2PostgresStateTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async find(
    context: core.IExecutionContext,
    table: core.Table,
    spec?: core.ISpecification<core.TableRecord, core.ITableRecordConditionSpecVisitor>
  ): Promise<Result<ReadonlyArray<core.TableRecordReadModel>, DomainError>> {
    return safeTry<ReadonlyArray<core.TableRecordReadModel>, DomainError>(
      async function* (this: PostgresTableRecordQueryRepository) {
        const dbTableName = yield* table.dbTableName();
        const { schema, tableName } = yield* dbTableName.split({ defaultSchema: null });

        const selectVisitor = new TableRecordSelectColumnsVisitor();
        const selectedColumns = yield* selectVisitor.apply(table);

        const whereClause = spec ? yield* buildRecordWhere(spec) : undefined;

        try {
          const db = resolvePostgresDb(this.db, context);
          const dbWithSchema = schema ? db.withSchema(schema) : db;
          const dynamic = db.dynamic;
          const selectColumns = selectVisitor.selectColumns(dynamic, recordIdColumn);

          const baseQuery = dbWithSchema.selectFrom(tableName as never).select(selectColumns);
          const query = whereClause
            ? baseQuery.where(whereClause as unknown as Expression<SqlBool>)
            : baseQuery;

          const rows = await query.orderBy(dynamic.ref(autoNumberColumn)).execute();
          const records = yield* mapRowsToReadModels(selectedColumns, rows);
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
  fieldColumns: ReadonlyArray<FieldColumn>,
  rows: ReadonlyArray<Record<string, unknown>>
): Result<ReadonlyArray<core.TableRecordReadModel>, DomainError> => {
  const records: core.TableRecordReadModel[] = [];
  for (const row of rows) {
    const rawId = row[recordIdColumn];
    if (typeof rawId !== 'string')
      return err(domainError.validation({ message: 'Invalid record id' }));

    const fields: Record<string, unknown> = {};
    for (const column of fieldColumns) {
      fields[column.fieldId.toString()] = row[column.dbFieldName];
    }
    records.push({ id: rawId, fields });
  }
  return ok(records);
};

const buildRecordWhere = (
  spec: core.ISpecification<core.TableRecord, core.ITableRecordConditionSpecVisitor>
): Result<RecordConditionWhere, DomainError> => {
  const visitor = new TableRecordConditionWhereVisitor();
  const acceptResult = spec.accept(visitor);
  if (acceptResult.isErr()) return err(acceptResult.error);
  return visitor.where();
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
