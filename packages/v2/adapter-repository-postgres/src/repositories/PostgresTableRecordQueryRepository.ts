import * as core from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely, sql, type Transaction } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2PostgresStateTokens } from '../di/tokens';

const recordIdColumn = '__id';
const autoNumberColumn = '__auto_number';

type FieldColumn = {
  fieldId: core.FieldId;
  dbFieldName: string;
};

@injectable()
export class PostgresTableRecordQueryRepository implements core.ITableRecordQueryRepository {
  constructor(
    @inject(v2PostgresStateTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async find(
    context: core.IExecutionContext,
    table: core.Table
  ): Promise<Result<ReadonlyArray<core.TableRecord>, string>> {
    const tableNameResult = table
      .dbTableName()
      .andThen((name) => name.split({ defaultSchema: null }));
    if (tableNameResult.isErr()) return err(tableNameResult.error);

    const fieldColumnsResult = buildFieldColumns(table);
    if (fieldColumnsResult.isErr()) return err(fieldColumnsResult.error);
    const fieldColumns = fieldColumnsResult.value;

    try {
      const { schema, tableName } = tableNameResult.value;
      const db = resolvePostgresDb(this.db, context);
      const tableIdentifier = buildTableIdentifier(schema, tableName);
      const selectColumns = [
        sql.ref(recordIdColumn),
        ...fieldColumns.map((column) => sql.ref(column.dbFieldName)),
      ];
      const result = await sql<Record<string, unknown>>`
        select ${sql.join(selectColumns)}
        from ${tableIdentifier}
        order by ${sql.ref(autoNumberColumn)}
      `.execute(db);

      const recordsResult = mapRowsToRecords(table, fieldColumns, result.rows);
      if (recordsResult.isErr()) return err(recordsResult.error);
      return ok(recordsResult.value);
    } catch (error) {
      return err(`Failed to load table records: ${describeError(error)}`);
    }
  }
}

const buildFieldColumns = (table: core.Table): Result<ReadonlyArray<FieldColumn>, string> => {
  const columns: FieldColumn[] = [];
  const seen = new Set<string>();
  for (const field of table.fields()) {
    const dbFieldNameResult = field.dbFieldName().andThen((name) => name.value());
    if (dbFieldNameResult.isErr()) return err(dbFieldNameResult.error);
    const dbFieldName = dbFieldNameResult.value;
    if (seen.has(dbFieldName)) return err('Duplicate DbFieldName');
    seen.add(dbFieldName);
    columns.push({ fieldId: field.id(), dbFieldName });
  }
  return ok(columns);
};

const mapRowsToRecords = (
  table: core.Table,
  fieldColumns: ReadonlyArray<FieldColumn>,
  rows: ReadonlyArray<Record<string, unknown>>
): Result<ReadonlyArray<core.TableRecord>, string> => {
  const records: core.TableRecord[] = [];
  for (const row of rows) {
    const recordIdResult = core.RecordId.create(row[recordIdColumn]);
    if (recordIdResult.isErr()) return err(recordIdResult.error);

    const fieldValues: core.TableRecordFieldValue[] = [];
    for (const column of fieldColumns) {
      const cellValueResult = core.TableRecordCellValue.create(row[column.dbFieldName]);
      if (cellValueResult.isErr()) return err(cellValueResult.error);
      fieldValues.push({
        fieldId: column.fieldId,
        value: cellValueResult.value,
      });
    }
    const recordResult = core.TableRecord.create({
      id: recordIdResult.value,
      tableId: table.id(),
      fieldValues,
    });
    if (recordResult.isErr()) return err(recordResult.error);
    records.push(recordResult.value);
  }
  return ok(records);
};

const buildTableIdentifier = (schema: string | null, tableName: string) => {
  if (!schema) return sql.ref(tableName);
  return sql`${sql.ref(schema)}.${sql.ref(tableName)}`;
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
