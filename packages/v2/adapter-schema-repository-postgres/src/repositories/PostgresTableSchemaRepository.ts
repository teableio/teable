import {
  TraceSpan,
  type IExecutionContext,
  type ISpecification,
  type ITableSchemaRepository,
  type ITableSpecVisitor,
  type Table,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  Kysely,
  sql,
  type ColumnDefinitionBuilder,
  type CompiledQuery,
  type CreateTableBuilder,
  type Transaction,
} from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2PostgresDdlTokens } from '../di/tokens';
import {
  ICreateTableBuilderRef,
  PostgresTableSchemaFieldCreateVisitor,
} from '../visitors/PostgresTableSchemaFieldCreateVisitor';
import { TableSchemaUpdateVisitor } from '../visitors/TableSchemaUpdateVisitor';

@injectable()
export class PostgresTableSchemaRepository implements ITableSchemaRepository {
  constructor(
    @inject(v2PostgresDdlTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  @TraceSpan()
  async insert(context: IExecutionContext, table: Table): Promise<Result<void, string>> {
    const repository = this;
    return await safeTry<void, string>(async function* () {
      const { schema, tableName } = yield* table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: null }));
      const db = resolvePostgresDb(repository.db, context);

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
      const visitor = PostgresTableSchemaFieldCreateVisitor.forTableCreation({
        builderRef,
        db,
        schema,
        tableName,
        tableId: table.id().toString(),
      });
      const fieldStatements = yield* visitor.apply(table);

      try {
        const compiledStatements: CompiledQuery[] = [];
        if (schema && schema !== 'public') {
          compiledStatements.push(db.schema.createSchema(schema).ifNotExists().compile());
        }
        compiledStatements.push(builderRef.builder.compile());
        compiledStatements.push(...fieldStatements.map((statement) => statement.compile(db)));

        await executeCompiledQueries(db, compiledStatements);
      } catch (error) {
        return err(`Failed to insert table schema: ${describeError(error)}`);
      }

      return ok(undefined);
    });
  }

  @TraceSpan()
  async update(
    context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, string>> {
    const repository = this;
    return await safeTry<void, string>(async function* () {
      const { schema, tableName } = yield* table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: null }));

      const db = resolvePostgresDb(repository.db, context);
      const visitor = new TableSchemaUpdateVisitor({
        db,
        schema,
        tableName,
        tableId: table.id().toString(),
      });
      yield* mutateSpec.accept(visitor);
      const statements = yield* visitor.where();
      if (statements.length === 0) return ok(undefined);

      try {
        await executeCompiledQueries(
          db,
          statements.map((statement) => statement.compile(db))
        );
      } catch (error) {
        return err(`Failed to update table schema: ${describeError(error)}`);
      }

      return ok(undefined);
    });
  }

  @TraceSpan()
  async delete(context: IExecutionContext, table: Table): Promise<Result<void, string>> {
    const repository = this;
    return await safeTry<void, string>(async function* () {
      const { schema, tableName } = yield* table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: null }));
      const db = resolvePostgresDb(repository.db, context);

      try {
        const schemaBuilder = schema ? db.schema.withSchema(schema) : db.schema;
        await schemaBuilder.dropTable(tableName).ifExists().execute();
      } catch (error) {
        return err(`Failed to delete table schema: ${describeError(error)}`);
      }

      return ok(undefined);
    });
  }
}

type PostgresTransactionContext<DB> = {
  kind: 'unitOfWorkTransaction';
  db: Transaction<DB>;
};

const getPostgresTransaction = <DB>(context: IExecutionContext): Transaction<DB> | null => {
  const transaction = context.transaction as Partial<PostgresTransactionContext<DB>> | undefined;
  if (transaction?.kind === 'unitOfWorkTransaction' && transaction.db) {
    return transaction.db as Transaction<DB>;
  }
  return null;
};

const resolvePostgresDb = <DB>(
  db: Kysely<DB>,
  context: IExecutionContext
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

const executeCompiledQueries = async <DB>(
  db: Kysely<DB> | Transaction<DB>,
  compiled: ReadonlyArray<CompiledQuery>
): Promise<void> => {
  for (const statement of compiled) {
    await db.executeQuery(statement);
  }
};
