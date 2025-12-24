import { resolvePostgresDb, v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  TraceSpan,
  type IExecutionContext,
  type ISpecification,
  type ITableSchemaRepository,
  type ITableSpecVisitor,
  type Table,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { ColumnDefinitionBuilder, CompiledQuery, CreateTableBuilder, Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  PostgresTableFieldVisitor,
  type ICreateTableBuilderRef,
} from '../visitors/PostgresTableFieldVisitor';
import { TableSchemaUpdateVisitor } from '../visitors/TableSchemaUpdateVisitor';

@injectable()
export class PostgresTableSchemaRepository implements ITableSchemaRepository {
  constructor(
    @inject(v2PostgresDbTokens.db)
    private readonly db: Kysely<unknown>
  ) {}

  @TraceSpan()
  async insert(context: IExecutionContext, table: Table): Promise<Result<void, string>> {
    const dbTableNameResult = table
      .dbTableName()
      .andThen((name) => name.split({ defaultSchema: null }));
    if (dbTableNameResult.isErr()) return err(dbTableNameResult.error);
    const { schema, tableName } = dbTableNameResult.value;
    const db = resolvePostgresDb(this.db, context);

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
    const visitor = new PostgresTableFieldVisitor(builderRef);
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

  @TraceSpan()
  async update(
    context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, string>> {
    const dbTableNameResult = table
      .dbTableName()
      .andThen((name) => name.split({ defaultSchema: null }));
    if (dbTableNameResult.isErr()) return err(dbTableNameResult.error);
    const { schema, tableName } = dbTableNameResult.value;

    const db = resolvePostgresDb(this.db, context);
    const visitor = new TableSchemaUpdateVisitor({ db, schema, tableName });
    const acceptResult = mutateSpec.accept(visitor);
    if (acceptResult.isErr()) return err(acceptResult.error);
    const statementsResult = visitor.where();
    if (statementsResult.isErr()) return err(statementsResult.error);
    if (statementsResult.value.length === 0) return ok(undefined);

    try {
      const batch = combineCompiledQueriesAsSql(
        statementsResult.value.map((statement) => statement.compile())
      );
      await batch.execute(db);
    } catch (error) {
      return err(`Failed to update table schema: ${describeError(error)}`);
    }

    return ok(undefined);
  }

  @TraceSpan()
  async delete(context: IExecutionContext, table: Table): Promise<Result<void, string>> {
    const dbTableNameResult = table
      .dbTableName()
      .andThen((name) => name.split({ defaultSchema: null }));
    if (dbTableNameResult.isErr()) return err(dbTableNameResult.error);
    const { schema, tableName } = dbTableNameResult.value;
    const db = resolvePostgresDb(this.db, context);

    try {
      const schemaBuilder = schema ? db.schema.withSchema(schema) : db.schema;
      await schemaBuilder.dropTable(tableName).ifExists().execute();
    } catch (error) {
      return err(`Failed to delete table schema: ${describeError(error)}`);
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

const combineCompiledQueriesAsSql = (
  compiled: ReadonlyArray<CompiledQuery>
): ReturnType<typeof sql> => {
  const statements = compiled.map(compileWithLiterals);
  return sql.join(statements, sql.raw(';\n'));
};

const compileWithLiterals = (compiled: CompiledQuery): ReturnType<typeof sql> => {
  const parts: Array<ReturnType<typeof sql>> = [];
  const parameters = compiled.parameters;
  let lastIndex = 0;
  const placeholder = /\$(\d+)/g;
  let match: RegExpExecArray | null;

  while ((match = placeholder.exec(compiled.sql)) !== null) {
    const before = compiled.sql.slice(lastIndex, match.index);
    if (before) parts.push(sql.raw(before));
    const parameterIndex = Number(match[1]) - 1;
    const value = parameters[parameterIndex] ?? null;
    parts.push(sql.lit(value));
    lastIndex = match.index + match[0].length;
  }

  const tail = compiled.sql.slice(lastIndex);
  if (tail) parts.push(sql.raw(tail));
  if (parts.length === 0) return sql.raw(compiled.sql);

  return sql.join(parts, sql.raw(''));
};
