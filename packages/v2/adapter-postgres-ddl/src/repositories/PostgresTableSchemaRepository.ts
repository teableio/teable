import type { IExecutionContext, ITableSchemaRepository, Table } from '@teable/v2-core';
import { resolvePostgresDb, v2PostgresDbTokens } from '@teable/v2-db-postgres';
import { inject, injectable } from '@teable/v2-di';
import type { ColumnDefinitionBuilder, CreateTableBuilder, Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  PostgresTableFieldVisitor,
  type ICreateTableBuilderRef,
} from '../visitors/PostgresTableFieldVisitor';

@injectable()
export class PostgresTableSchemaRepository implements ITableSchemaRepository {
  constructor(
    @inject(v2PostgresDbTokens.db)
    private readonly db: Kysely<unknown>
  ) {}

  async save(context: IExecutionContext, table: Table): Promise<Result<void, string>> {
    const tableId = table.id().toString();
    let dbTableName: string;
    const db = resolvePostgresDb(this.db, context);

    try {
      const tableMetaResult = await sql<{ dbTableName: string }>`
        select db_table_name as "dbTableName"
        from table_meta
        where id = ${tableId}
      `.execute(db);

      dbTableName = tableMetaResult.rows[0]?.dbTableName ?? '';
    } catch (error) {
      return err(`Failed to load table metadata: ${describeError(error)}`);
    }

    if (!dbTableName) return err('Missing db table name');

    const { schema, tableName } = splitDbTableName(dbTableName);
    if (schema && schema !== 'public') {
      try {
        await db.schema.createSchema(schema).ifNotExists().execute();
      } catch (error) {
        return err(`Failed to ensure table schema: ${describeError(error)}`);
      }
    }

    type ICreateTableBuilder = CreateTableBuilder<string, string>;
    const schemaBuilder = schema ? db.schema.withSchema(schema) : db.schema;
    let builder = schemaBuilder
      .createTable(tableName)
      .ifNotExists() as unknown as ICreateTableBuilder;

    builder = builder
      .addColumn('__id', 'text', (col: ColumnDefinitionBuilder) => col.notNull().unique())
      .addColumn('__auto_number', 'serial', (col: ColumnDefinitionBuilder) => col.primaryKey())
      .addColumn('__created_time', 'timestamptz', (col: ColumnDefinitionBuilder) =>
        col.notNull().defaultTo(sql`now()`)
      )
      .addColumn('__last_modified_time', 'timestamptz')
      .addColumn('__created_by', 'text', (col: ColumnDefinitionBuilder) => col.notNull())
      .addColumn('__last_modified_by', 'text')
      .addColumn('__version', 'integer', (col: ColumnDefinitionBuilder) => col.notNull());

    let fieldDbNameById: Map<string, string>;
    try {
      const fieldRows = await sql<{ id: string; dbFieldName: string }>`
        select id, db_field_name as "dbFieldName"
        from field
        where table_id = ${tableId}
          and deleted_time is null
      `.execute(db);
      fieldDbNameById = new Map(fieldRows.rows.map((row) => [row.id, row.dbFieldName]));
    } catch (error) {
      return err(`Failed to load field metadata: ${describeError(error)}`);
    }

    const builderRef: ICreateTableBuilderRef = { builder };
    const visitor = new PostgresTableFieldVisitor(builderRef, fieldDbNameById);
    const applyResult = visitor.apply(table);
    if (applyResult.isErr()) return err(applyResult.error);

    try {
      await builderRef.builder.execute();
    } catch (error) {
      return err(`Failed to save table schema: ${describeError(error)}`);
    }

    return ok(undefined);
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

const splitDbTableName = (dbTableName: string): { schema: string | null; tableName: string } => {
  const dotIndex = dbTableName.indexOf('.');
  if (dotIndex === -1) return { schema: null, tableName: dbTableName };
  return { schema: dbTableName.slice(0, dotIndex), tableName: dbTableName.slice(dotIndex + 1) };
};
