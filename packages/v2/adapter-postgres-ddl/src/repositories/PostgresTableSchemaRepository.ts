import {
  TraceSpan,
  type IExecutionContext,
  type ITableSchemaRepository,
  type Table,
} from '@teable/v2-core';
import { resolvePostgresDb, v2PostgresDbTokens } from '@teable/v2-db-postgres';
import { inject, injectable } from '@teable/v2-di';
import type { ColumnDefinitionBuilder, CreateTableBuilder, Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { buildDbFieldNameMap, splitDbTableName } from '../naming';
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

  @TraceSpan()
  async insert(context: IExecutionContext, table: Table): Promise<Result<void, string>> {
    const tableId = table.id().toString();
    let dbTableName: string;
    const fieldDbNameById = buildDbFieldNameMap(
      table.fields().map((field) => ({ id: field.id().toString(), name: field.name().toString() }))
    );
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

    type ICreateTableBuilder = CreateTableBuilder<string, string>;
    const schemaBuilder = schema ? db.schema.withSchema(schema) : db.schema;
    let builder = schemaBuilder.createTable(tableName) as unknown as ICreateTableBuilder;

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

    const builderRef: ICreateTableBuilderRef = { builder };
    const visitor = new PostgresTableFieldVisitor(builderRef, fieldDbNameById);
    const applyResult = visitor.apply(table);
    if (applyResult.isErr()) return err(applyResult.error);

    try {
      const statements: string[] = [];
      if (schema && schema !== 'public') {
        statements.push(db.schema.createSchema(schema).ifNotExists().compile().sql);
      }
      statements.push(builderRef.builder.compile().sql);

      await sql.raw(statements.join(';\n')).execute(db);
    } catch (error) {
      return err(`Failed to insert table schema: ${describeError(error)}`);
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
