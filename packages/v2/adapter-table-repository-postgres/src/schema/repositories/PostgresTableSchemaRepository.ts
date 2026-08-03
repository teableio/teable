import type {
  TableId,
  BaseId,
  FieldId,
  IExecutionContext,
  ISpecification,
  ITableRepository,
  ITableSchemaRepository,
  Field,
  LinkField,
  ITableSpecVisitor,
  Table,
  DomainError,
  ITracer,
  SpanAttributes,
  TableSchemaInsertManyOptions,
  RecordUpdateDTO,
} from '@teable/v2-core';
import {
  TraceSpan,
  TeableSpanAttributes,
  DbFieldName,
  TableByIdSpec,
  domainError,
  isDomainError,
  resolveLatestTableInTransactionScope,
  scheduleTableUpdateDeferredTask,
  v2CoreTokens,
  SelectOption,
  RecordsBatchUpdated,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql } from 'kysely';
import type {
  Kysely,
  ColumnDefinitionBuilder,
  CreateTableBuilder,
  CompiledQuery,
  Transaction,
} from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ComputedUpdatePlanner } from '../../record/computed/ComputedUpdatePlanner';
import type { FieldDependencyGraph } from '../../record/computed/FieldDependencyGraph';
import { v2RecordRepositoryPostgresTokens } from '../../record/di/tokens';
import {
  executeCompiledQueries,
  executeTableSchemaStatements,
  resolvePostgresDbOrTx,
} from '../../shared/db';
import {
  createSchemaNotNullViolationError,
  isNotNullViolation,
  isUniqueViolation,
} from '../../shared/errors';
import { toQualifiedIdentifierLiteral } from '../../shared/sqlIdentifiers';
import {
  ensureUndoCaptureInfrastructure,
  invalidateUndoCaptureTableCache,
} from '../../shared/undoCapture';
import { v2PostgresDdlTokens } from '../di/tokens';
import { detectCircularDependency } from '../helpers/detectCircularDependency';
import {
  createFieldSchemaRules,
  createSchemaRuleContext,
  PostgresSchemaIntrospector,
} from '../rules';
import type { TableSchemaStatementBuilder } from '../rules/core';
import { DependencyChangeDetectorVisitor } from '../visitors/DependencyChangeDetectorVisitor';
import { FieldValueChangeCollectorVisitor } from '../visitors/FieldValueChangeCollectorVisitor';
import type { ICreateTableBuilderRef } from '../visitors/PostgresTableSchemaFieldCreateVisitor';
import {
  buildTableLocationsById,
  PostgresTableSchemaFieldCreateVisitor,
} from '../visitors/PostgresTableSchemaFieldCreateVisitor';
import { TableAddFieldCollectorVisitor } from '../visitors/TableAddFieldCollectorVisitor';
import { TableSchemaUpdateVisitor } from '../visitors/TableSchemaUpdateVisitor';

type ComputedFieldBackfillService = {
  backfillMany(
    context: IExecutionContext,
    input: {
      table: Table;
      fields: ReadonlyArray<Field>;
      includeOneManyTwoWay?: boolean;
      skipDistinctFilter?: boolean;
    }
  ): Promise<Result<{ fields: ReadonlyArray<Field> }, DomainError>>;
};

type ComputedFieldCascadeService = {
  cascade(
    context: IExecutionContext,
    input: {
      table: Table;
      selfBackfillFieldIds: ReadonlyArray<FieldId>;
      valueChangedFieldIds: ReadonlyArray<FieldId>;
      deferredBackfillFieldIds?: ReadonlyArray<FieldId>;
      hasDbStorageTypeChange?: boolean;
    }
  ): Promise<Result<void, DomainError>>;
};

type FieldValueChangeSet = {
  selfBackfillFieldIds: ReadonlyArray<FieldId>;
  valueChangedFieldIds: ReadonlyArray<FieldId>;
  deferredBackfillFieldIds: ReadonlyArray<FieldId>;
  hasDbStorageTypeChange: boolean;
};

type SchemaStatementTraceOptions = {
  readonly tracer?: ITracer;
  readonly attributes?: SpanAttributes;
};

const ensureDbFieldNames = (fields: ReadonlyArray<Field>): Result<void, DomainError> => {
  for (const field of fields) {
    if (field.dbFieldName().isOk()) continue;
    const dbFieldNameResult = DbFieldName.rehydrate(field.id().toString());
    if (dbFieldNameResult.isErr()) return err(dbFieldNameResult.error);
    const setResult = field.setDbFieldName(dbFieldNameResult.value);
    if (setResult.isErr()) return err(setResult.error);
  }
  return ok(undefined);
};

@injectable()
export class PostgresTableSchemaRepository implements ITableSchemaRepository {
  constructor(
    @inject(v2PostgresDdlTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2RecordRepositoryPostgresTokens.computedFieldBackfillService)
    private readonly computedFieldBackfillService: ComputedFieldBackfillService,
    @inject(v2RecordRepositoryPostgresTokens.computedFieldCascadeService)
    private readonly cascadeService: ComputedFieldCascadeService,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePlanner)
    private readonly computedUpdatePlanner: ComputedUpdatePlanner,
    @inject(v2RecordRepositoryPostgresTokens.computedDependencyGraph)
    private readonly fieldDependencyGraph: FieldDependencyGraph,
    @inject(v2RecordRepositoryPostgresTokens.metaDb)
    private readonly metaDb: Kysely<V1TeableDatabase> = db
  ) {}

  private resolveMetaDb(
    context: IExecutionContext
  ): Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase> {
    const scope = this.db === this.metaDb ? 'data' : 'meta';
    return resolvePostgresDbOrTx(this.metaDb, context, scope);
  }

  private parseTableIdentifier(dbTableName: string): { schema: string | null; tableName: string } {
    const [schema, ...rest] = dbTableName.split('.');
    if (rest.length === 0) {
      return { schema: null, tableName: schema ?? dbTableName };
    }

    return { schema: schema ?? null, tableName: rest.join('.') };
  }

  private async loadTableLocationsForUpdate(
    context: IExecutionContext,
    table: Table
  ): Promise<
    Result<ReadonlyMap<string, { schema: string | null; tableName: string }>, DomainError>
  > {
    const repository = this;
    return safeTry<ReadonlyMap<string, { schema: string | null; tableName: string }>, DomainError>(
      async function* () {
        const locations = new Map(yield* buildTableLocationsById([table]));
        const metaDb = repository.resolveMetaDb(context);
        const introspector = new PostgresSchemaIntrospector(metaDb as Kysely<V1TeableDatabase>);
        const tableMetaExists = yield* await introspector.tableExists('public', 'table_meta');

        if (!tableMetaExists) {
          return ok(locations);
        }

        const rows = await metaDb
          .selectFrom('table_meta')
          .select(['id', 'db_table_name'])
          .where('base_id', '=', table.baseId().toString())
          .where('deleted_time', 'is', null)
          .where('db_table_name', 'is not', null)
          .execute();

        for (const row of rows) {
          if (!row.db_table_name) {
            continue;
          }
          locations.set(row.id, repository.parseTableIdentifier(row.db_table_name));
        }

        return ok(locations);
      }
    );
  }

  private async executeScopedTableSchemaStatements(
    context: IExecutionContext,
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    statements: ReadonlyArray<TableSchemaStatementBuilder>,
    trace?: SchemaStatementTraceOptions
  ): Promise<void> {
    let currentScope: 'data' | 'meta' | undefined;
    let batch: TableSchemaStatementBuilder[] = [];

    const flush = async () => {
      if (!currentScope || batch.length === 0) return;
      const targetDb = currentScope === 'meta' ? this.resolveMetaDb(context) : db;
      await executeTableSchemaStatements(targetDb, batch, {
        ...trace,
        dataDb: db as Kysely<unknown> | Transaction<unknown>,
        metaDb: this.resolveMetaDb(context) as Kysely<unknown> | Transaction<unknown>,
        enforceRelationAccess: this.db !== this.metaDb,
      });
      batch = [];
    };

    for (const statement of statements) {
      const statementScope = statement.scope;
      if (currentScope && currentScope !== statementScope) {
        await flush();
      }
      currentScope = statementScope;
      batch.push(statement);
    }

    await flush();
  }

  private async ensureDeferredForeignKeys(
    context: IExecutionContext,
    tables: ReadonlyArray<Table>,
    options?: Pick<TableSchemaInsertManyOptions, 'optimizeForEmptyTables'>
  ): Promise<Result<void, DomainError>> {
    const repository = this;
    return safeTry<void, DomainError>(async function* () {
      const db = resolvePostgresDbOrTx(repository.db, context) as Kysely<V1TeableDatabase>;
      const metaDb = repository.resolveMetaDb(context) as Kysely<V1TeableDatabase>;
      const introspector = new PostgresSchemaIntrospector(db);

      for (const table of tables) {
        yield* ensureDbFieldNames(table.getFields());

        const { schema, tableName } = yield* table
          .dbTableName()
          .andThen((name) => name.split({ defaultSchema: null }));

        for (const field of table.getFields()) {
          const rulesResult = createFieldSchemaRules(field, {
            schema,
            tableName,
            tableId: table.id().toString(),
          });
          const rules = yield* rulesResult;

          const ctx = createSchemaRuleContext({
            db,
            metaDb,
            introspector,
            schema,
            tableName,
            tableId: table.id().toString(),
            field,
            table,
            optimizeForEmptyTables: options?.optimizeForEmptyTables,
          });

          const deferredFkRules = rules.filter(
            (rule) => rule.id.startsWith('fk:') || rule.id.startsWith('junction_fk:')
          );

          if (deferredFkRules.length === 0) continue;

          for (const rule of deferredFkRules) {
            const statements = yield* rule.up(ctx);
            await executeTableSchemaStatements(db, statements, {
              tracer: context.tracer,
              dataDb: db as Kysely<unknown> | Transaction<unknown>,
              metaDb: metaDb as Kysely<unknown> | Transaction<unknown>,
              attributes: {
                [TeableSpanAttributes.TABLE_ID]: table.id().toString(),
                'teable.base_id': table.baseId().toString(),
                'teable.table_name': tableName,
                'teable.schema': schema ?? 'public',
                'teable.schema.statement.source': 'deferred_foreign_key',
              },
            });
          }
        }
      }

      return ok(undefined);
    });
  }

  private async insertTableSkeleton(
    context: IExecutionContext,
    table: Table
  ): Promise<Result<void, DomainError>> {
    const repository = this;
    return await safeTry<void, DomainError>(async function* () {
      yield* ensureDbFieldNames(table.getFields());

      const { schema, tableName } = yield* table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: null }));
      const db = resolvePostgresDbOrTx(repository.db, context);

      const schemaBuilder = schema ? db.schema.withSchema(schema) : db.schema;
      const builder = schemaBuilder
        .createTable(tableName)
        .addColumn('__id', 'text', (col: ColumnDefinitionBuilder) => col.notNull().unique())
        .addColumn('__auto_number', 'serial', (col: ColumnDefinitionBuilder) => col.primaryKey())
        .addColumn('__created_time', 'timestamptz', (col: ColumnDefinitionBuilder) =>
          col.notNull().defaultTo(sql`now()`)
        )
        .addColumn('__last_modified_time', 'timestamptz')
        .addColumn('__created_by', 'text', (col: ColumnDefinitionBuilder) => col.notNull())
        .addColumn('__last_modified_by', 'text')
        .addColumn('__version', 'integer', (col: ColumnDefinitionBuilder) => col.notNull());

      try {
        const compiledStatements: CompiledQuery[] = [];
        if (schema && schema !== 'public') {
          compiledStatements.push(db.schema.createSchema(schema).ifNotExists().compile());
        }
        compiledStatements.push(builder.compile());

        await executeCompiledQueries(db, compiledStatements);
      } catch (error) {
        return err(
          domainError.infrastructure({
            message: `Failed to insert table schema: ${describeError(error)}`,
          })
        );
      }

      return ok(undefined);
    });
  }

  private async insertTableFieldSchemas(
    context: IExecutionContext,
    table: Table,
    knownTables: ReadonlyArray<Table> = [table],
    options?: Pick<TableSchemaInsertManyOptions, 'optimizeForEmptyTables'>
  ): Promise<Result<void, DomainError>> {
    const repository = this;
    return await safeTry<void, DomainError>(async function* () {
      yield* ensureDbFieldNames(table.getFields());

      const { schema, tableName } = yield* table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: null }));
      const tableLocationsById = yield* buildTableLocationsById(knownTables);
      const db = resolvePostgresDbOrTx(repository.db, context);

      const visitor = PostgresTableSchemaFieldCreateVisitor.forSchemaUpdate({
        db,
        schema,
        tableName,
        tableId: table.id().toString(),
        tableLocationsById,
        optimizeForEmptyTables: options?.optimizeForEmptyTables,
      });
      const statements = yield* visitor.apply(table);

      if (statements.length === 0) {
        return ok(undefined);
      }

      try {
        await repository.executeScopedTableSchemaStatements(context, db, statements, {
          tracer: context.tracer,
          attributes: {
            [TeableSpanAttributes.TABLE_ID]: table.id().toString(),
            'teable.base_id': table.baseId().toString(),
            'teable.table_name': tableName,
            'teable.schema': schema ?? 'public',
            'teable.schema.statement.source': 'table_schema_insert_fields',
          },
        });
      } catch (error) {
        return err(
          domainError.infrastructure({
            message: `Failed to insert table schema: ${describeError(error)}`,
          })
        );
      }

      return ok(undefined);
    });
  }

  private async ensureUndoCaptureForTable(
    context: IExecutionContext,
    table: Table
  ): Promise<Result<void, DomainError>> {
    const repository = this;
    return await safeTry<void, DomainError>(async function* () {
      const { schema, tableName } = yield* table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: null }));
      const db = resolvePostgresDbOrTx(repository.db, context);

      try {
        await ensureUndoCaptureInfrastructure(
          repository.db,
          db,
          toQualifiedIdentifierLiteral(schema, tableName),
          `${schema ?? 'public'}.${tableName}`
        );
      } catch {
        // Snapshot capture wiring is best-effort and must not block table creation.
      }

      return ok(undefined);
    });
  }

  private async insertTableSchema(
    context: IExecutionContext,
    table: Table,
    knownTables: ReadonlyArray<Table> = [table],
    options?: Pick<
      TableSchemaInsertManyOptions,
      'optimizeForEmptyTables' | 'skipUndoCaptureSetup'
    > & {
      skipSchemaCreate?: boolean;
    }
  ): Promise<
    Result<
      {
        schema: string | null;
        tableName: string;
        fieldStatements: ReadonlyArray<TableSchemaStatementBuilder>;
      },
      DomainError
    >
  > {
    const repository = this;
    return await safeTry<
      {
        schema: string | null;
        tableName: string;
        fieldStatements: ReadonlyArray<TableSchemaStatementBuilder>;
      },
      DomainError
    >(async function* () {
      yield* ensureDbFieldNames(table.getFields());

      const { schema, tableName } = yield* table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: null }));
      const db = resolvePostgresDbOrTx(repository.db, context);

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
        tableLocationsById: yield* buildTableLocationsById(knownTables),
        optimizeForEmptyTables: options?.optimizeForEmptyTables,
      });
      const fieldStatements = yield* visitor.apply(table);

      try {
        const compiledStatements: CompiledQuery[] = [];
        if (!options?.skipSchemaCreate && schema && schema !== 'public') {
          compiledStatements.push(db.schema.createSchema(schema).ifNotExists().compile());
        }
        compiledStatements.push(builderRef.builder.compile());

        await executeCompiledQueries(db, compiledStatements);
      } catch (error) {
        return err(
          domainError.infrastructure({
            message: `Failed to insert table schema: ${describeError(error)}`,
          })
        );
      }

      if (!options?.skipUndoCaptureSetup) {
        try {
          await ensureUndoCaptureInfrastructure(
            repository.db,
            db,
            toQualifiedIdentifierLiteral(schema, tableName),
            `${schema ?? 'public'}.${tableName}`
          );
        } catch {
          // Snapshot capture wiring is best-effort and must not block table creation.
        }
      }

      return ok({ schema, tableName, fieldStatements });
    });
  }

  private async ensureSchemas(
    context: IExecutionContext,
    schemas: ReadonlyArray<string | null>
  ): Promise<Result<void, DomainError>> {
    const schemaNames = [
      ...new Set(
        schemas.filter((schema): schema is string => schema != null && schema !== 'public')
      ),
    ];
    if (schemaNames.length === 0) {
      return ok(undefined);
    }

    const db = resolvePostgresDbOrTx(this.db, context);
    try {
      await executeCompiledQueries(
        db,
        schemaNames.map((schema) => db.schema.createSchema(schema).ifNotExists().compile())
      );
      return ok(undefined);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to create table schemas: ${describeError(error)}`,
        })
      );
    }
  }

  @TraceSpan()
  async insert(context: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    const result = await this.insertTableSchema(context, table);
    if (result.isErr()) {
      return err(result.error);
    }

    const { schema, tableName, fieldStatements } = result.value;
    const db = resolvePostgresDbOrTx(this.db, context);
    try {
      await this.executeScopedTableSchemaStatements(context, db, fieldStatements, {
        tracer: context.tracer,
        attributes: {
          [TeableSpanAttributes.TABLE_ID]: table.id().toString(),
          'teable.base_id': table.baseId().toString(),
          'teable.table_name': tableName,
          'teable.schema': schema ?? 'public',
          'teable.schema.statement.source': 'table_schema_insert',
        },
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to insert table schema: ${describeError(error)}`,
        })
      );
    }

    return ok(undefined);
  }

  @TraceSpan()
  async insertMany(
    context: IExecutionContext,
    tables: ReadonlyArray<Table>,
    options?: TableSchemaInsertManyOptions
  ): Promise<Result<void, DomainError>> {
    const knownTables = options?.knownTables ?? tables;
    const fieldStatementGroups: Array<{
      table: Table;
      schema: string | null;
      tableName: string;
      fieldStatements: ReadonlyArray<TableSchemaStatementBuilder>;
    }> = [];

    const tableLocations: Array<{ schema: string | null; tableName: string }> = [];
    for (const table of tables) {
      const tableLocation = table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: null }));
      if (tableLocation.isErr()) return err(tableLocation.error);
      tableLocations.push(tableLocation.value);
    }
    const ensureSchemasResult = await this.ensureSchemas(
      context,
      tableLocations.map((tableLocation) => tableLocation.schema)
    );
    if (ensureSchemasResult.isErr()) return err(ensureSchemasResult.error);

    for (const table of tables) {
      const result = await this.insertTableSchema(context, table, knownTables, {
        ...options,
        skipSchemaCreate: true,
      });
      if (result.isErr()) return err(result.error);
      fieldStatementGroups.push({ table, ...result.value });
    }

    const db = resolvePostgresDbOrTx(this.db, context);
    for (const { table, schema, tableName, fieldStatements } of fieldStatementGroups) {
      try {
        await this.executeScopedTableSchemaStatements(context, db, fieldStatements, {
          tracer: context.tracer,
          attributes: {
            [TeableSpanAttributes.TABLE_ID]: table.id().toString(),
            'teable.base_id': table.baseId().toString(),
            'teable.table_name': tableName,
            'teable.schema': schema ?? 'public',
            'teable.schema.statement.source': 'table_schema_insert_fields',
          },
        });
      } catch (error) {
        return err(
          domainError.infrastructure({
            message: `Failed to insert table schema: ${describeError(error)}`,
          })
        );
      }
    }

    // Some FK constraints are conditionally created only if the target table already exists.
    // In batch table creation, referenced tables might be created later, so we do a second pass
    // to (idempotently) add any missing FK constraints once all tables exist.
    const ensureFkResult = await this.ensureDeferredForeignKeys(context, tables, options);
    if (ensureFkResult.isErr()) return err(ensureFkResult.error);

    return ok(undefined);
  }

  @TraceSpan()
  async ensureInserted(
    context: IExecutionContext,
    table: Table
  ): Promise<Result<void, DomainError>> {
    return this.ensureInsertedWithKnownTables(context, table, [table]);
  }

  private async ensureInsertedWithKnownTables(
    context: IExecutionContext,
    table: Table,
    knownTables: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    const repository = this;
    return await safeTry<void, DomainError>(async function* () {
      yield* ensureDbFieldNames(table.getFields());

      const { schema, tableName } = yield* table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: null }));
      const db = resolvePostgresDbOrTx(repository.db, context) as Kysely<V1TeableDatabase>;
      const introspector = new PostgresSchemaIntrospector(db);
      const exists = yield* await introspector.tableExists(schema, tableName);

      if (!exists) {
        yield* await repository.insert(context, table);
        return ok(undefined);
      }

      yield* await repository.insertTableFieldSchemas(context, table, knownTables);
      yield* await repository.ensureUndoCaptureForTable(context, table);

      return ok(undefined);
    });
  }

  @TraceSpan()
  async ensureInsertedMany(
    context: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    for (const table of tables) {
      const result = await this.ensureInsertedWithKnownTables(context, table, tables);
      if (result.isErr()) return err(result.error);
    }

    const ensureFkResult = await this.ensureDeferredForeignKeys(context, tables);
    if (ensureFkResult.isErr()) return err(ensureFkResult.error);

    return ok(undefined);
  }

  @TraceSpan()
  async update(
    context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    const repository = this;
    return await safeTry<Table, DomainError>(async function* () {
      yield* ensureDbFieldNames(table.getFields());

      const { schema, tableName } = yield* table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: null }));

      const db = resolvePostgresDbOrTx(repository.db, context);
      const tableLocationsById = yield* await repository.loadTableLocationsForUpdate(
        context,
        table
      );
      const recordUpdates: RecordUpdateDTO[] = [];
      const visitor = new TableSchemaUpdateVisitor({
        db,
        schema,
        tableName,
        tableId: table.id().toString(),
        table,
        tableLocationsById,
        recordUpdateCollector: {
          add: (update) => {
            recordUpdates.push(update);
          },
        },
      });
      yield* mutateSpec.accept(visitor);
      const statements = yield* visitor.where();
      if (statements.length > 0) {
        try {
          await repository.executeScopedTableSchemaStatements(context, db, statements, {
            tracer: context.tracer,
            attributes: {
              [TeableSpanAttributes.TABLE_ID]: table.id().toString(),
              'teable.base_id': table.baseId().toString(),
              'teable.table_name': tableName,
              'teable.schema': schema ?? 'public',
              'teable.schema.statement.source': 'table_schema_update',
            },
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            return err(
              domainError.validation({
                message: 'Cannot complete update: unique constraint violated',
                code: 'validation.field.unique',
              })
            );
          }

          if (isNotNullViolation(error)) {
            return err(createSchemaNotNullViolationError(error, table.getFields(), context.$t));
          }

          return err(
            domainError.infrastructure({
              message: `Failed to update table schema: ${describeError(error)}`,
            })
          );
        }
      }

      // Check for circular dependencies if the spec involves dependency changes
      const dependencyDetector = new DependencyChangeDetectorVisitor();
      yield* mutateSpec.accept(dependencyDetector);
      if (dependencyDetector.needsCheck()) {
        const dependencyChangedFieldIds = dependencyDetector.dependencyChangedFieldIds();
        const graphResult = yield* await repository.fieldDependencyGraph.load(
          table.baseId(),
          context,
          dependencyChangedFieldIds.length > 0
            ? { requiredFieldIds: dependencyChangedFieldIds }
            : undefined
        );
        const cycleCheckResult = detectCircularDependency(graphResult.edges);
        if (cycleCheckResult.isErr()) {
          return err(cycleCheckResult.error);
        }
      }

      const valueChanges = yield* repository.collectFieldValueChanges(mutateSpec);

      const backfillVisitor = new TableAddFieldCollectorVisitor();
      yield* mutateSpec.accept(backfillVisitor);
      const fields = backfillVisitor.fields();
      if (fields.length > 0) {
        yield* await repository.computedFieldBackfillService.backfillMany(context, {
          table,
          fields,
          // Newly added fields have no prior stored values, so we can skip the
          // expensive DISTINCT comparison and backfill every existing row directly.
          skipDistinctFilter: true,
          includeOneManyTwoWay: fields.some((field) => {
            if (field.type().toString() !== 'link') {
              return false;
            }
            const linkField = field as unknown as LinkField;
            return linkField.relationship().toString() === 'oneMany' && !linkField.isOneWay();
          }),
        });
      }

      // Cascade value changes to dependent computed fields
      // Re-ensure dbFieldNames after mutation: specs like TableUpdateFieldNameSpec
      // replace fields via duplicate() which drops the dbFieldName.
      yield* ensureDbFieldNames(table.getFields());
      if (
        valueChanges.selfBackfillFieldIds.length > 0 ||
        valueChanges.valueChangedFieldIds.length > 0
      ) {
        yield* await repository.cascadeService.cascade(context, {
          table,
          selfBackfillFieldIds: valueChanges.selfBackfillFieldIds,
          valueChangedFieldIds: valueChanges.valueChangedFieldIds,
          deferredBackfillFieldIds: valueChanges.deferredBackfillFieldIds,
          hasDbStorageTypeChange: valueChanges.hasDbStorageTypeChange,
        });
      }

      const nextTable = yield* await repository.refreshInMemoryTableAfterUpdate(
        context,
        table,
        valueChanges.valueChangedFieldIds
      );
      if (recordUpdates.length > 0) {
        nextTable.recordDomainEvents([
          RecordsBatchUpdated.create({
            tableId: nextTable.id(),
            baseId: nextTable.baseId(),
            updates: recordUpdates,
            source: 'user',
          }),
        ]);
      }
      yield* await repository.recordPostPersistActionTriggers(context, nextTable, valueChanges);
      yield* await repository.scheduleDeferredBackfillAfterUpdate(context, nextTable, valueChanges);

      return ok(nextTable);
    });
  }

  private collectFieldValueChanges(
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Result<FieldValueChangeSet, DomainError> {
    const valueChangeVisitor = new FieldValueChangeCollectorVisitor();
    const acceptResult = mutateSpec.accept(valueChangeVisitor);
    if (acceptResult.isErr()) return err(acceptResult.error);

    return ok({
      selfBackfillFieldIds: valueChangeVisitor.selfBackfillFields(),
      valueChangedFieldIds: valueChangeVisitor.valueChangedFields(),
      deferredBackfillFieldIds: valueChangeVisitor.deferredBackfillFields(),
      hasDbStorageTypeChange: valueChangeVisitor.hasDbStorageTypeChange(),
    });
  }

  @TraceSpan()
  private async refreshInMemoryTableAfterUpdate(
    context: IExecutionContext,
    table: Table,
    valueChangedFieldIds: ReadonlyArray<FieldId>
  ): Promise<Result<Table, DomainError>> {
    try {
      const selectFieldIds = this.collectChangedSelectFieldIds(table, valueChangedFieldIds);
      if (selectFieldIds.length === 0) {
        return ok(table);
      }

      const db = this.resolveMetaDb(context);
      const rows = await db
        .selectFrom('field')
        .select(['id', 'options'])
        .where(
          'id',
          'in',
          selectFieldIds.map((fieldId) => fieldId.toString())
        )
        .execute();

      if (rows.length === 0) {
        return ok(table);
      }

      const optionsByFieldId = new Map<string, ReadonlyArray<SelectOption>>();
      for (const row of rows) {
        const optionsResult = this.parseSelectOptions(row.options);
        if (optionsResult.isErr()) return err(optionsResult.error);
        optionsByFieldId.set(row.id, optionsResult.value);
      }

      let nextTable = table;
      for (const fieldId of selectFieldIds) {
        const selectOptions = optionsByFieldId.get(fieldId.toString());
        if (!selectOptions) continue;
        const nextTableResult = nextTable.addSelectOptions(fieldId, selectOptions);
        if (nextTableResult.isErr()) return err(nextTableResult.error);
        nextTable = nextTableResult.value;
      }

      return ok(nextTable);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to refresh in-memory table after schema update: ${describeError(error)}`,
        })
      );
    }
  }

  @TraceSpan()
  private async recordPostPersistActionTriggers(
    context: IExecutionContext,
    table: Table,
    valueChanges: FieldValueChangeSet
  ): Promise<Result<void, DomainError>> {
    const repository = this;
    return safeTry<void, DomainError>(async function* () {
      const changedFieldIds = dedupeFieldIds([
        ...valueChanges.selfBackfillFieldIds,
        ...valueChanges.valueChangedFieldIds,
        ...valueChanges.deferredBackfillFieldIds,
      ]);
      if (changedFieldIds.length === 0) {
        return ok(undefined);
      }

      const actionTriggerTargets = new Map<
        string,
        { tableId: TableId; baseId?: BaseId; fieldIds: Set<string> }
      >();

      const addActionTriggerTarget = (
        tableId: TableId,
        fieldIds: ReadonlyArray<FieldId>,
        baseId?: BaseId
      ) => {
        const key = tableId.toString();
        const target = actionTriggerTargets.get(key) ?? {
          tableId,
          baseId,
          fieldIds: new Set<string>(),
        };
        if (baseId) {
          target.baseId = baseId;
        }
        for (const fieldId of fieldIds) {
          target.fieldIds.add(fieldId.toString());
        }
        actionTriggerTargets.set(key, target);
      };

      addActionTriggerTarget(table.id(), changedFieldIds, table.baseId());

      const planResult = yield* await repository.computedUpdatePlanner.plan(
        {
          table,
          changedFieldIds,
          changedRecordIds: [],
          changeType: 'update',
          cyclePolicy: 'skip',
        },
        context
      );

      for (const step of planResult.steps) {
        addActionTriggerTarget(step.tableId, step.fieldIds);
      }

      for (const target of actionTriggerTargets.values()) {
        let targetBaseId = target.baseId;
        if (!targetBaseId) {
          const targetTableResult = await repository.tableRepository.findOne(
            context,
            TableByIdSpec.create(target.tableId)
          );
          if (targetTableResult.isOk()) {
            targetBaseId = targetTableResult.value.baseId();
          }
        }

        const [firstFieldId] = target.fieldIds;
        table.requestActionTrigger({
          tableId: target.tableId,
          baseId: targetBaseId ?? table.baseId(),
          // Schema-driven computed refresh should not masquerade as a record write.
          // Emit a setField-compatible hint instead so UI record queries can refresh
          // without downstream consumers treating this as a user/data mutation.
          actionKey: 'setField',
          payload: {
            tableId: target.tableId.toString(),
            fieldIds: [...target.fieldIds],
            ...(firstFieldId ? { field: { id: firstFieldId } } : {}),
          },
        });
      }

      return ok(undefined);
    });
  }

  @TraceSpan()
  private async scheduleDeferredBackfillAfterUpdate(
    context: IExecutionContext,
    table: Table,
    valueChanges: FieldValueChangeSet
  ): Promise<Result<void, DomainError>> {
    if (valueChanges.deferredBackfillFieldIds.length === 0) {
      return ok(undefined);
    }

    scheduleTableUpdateDeferredTask(context, async () =>
      this.replayDeferredBackfillAfterUpdate(
        context,
        resolveLatestTableInTransactionScope(context, table.id(), table),
        valueChanges
      )
    );

    return ok(undefined);
  }

  @TraceSpan()
  private async replayDeferredBackfillAfterUpdate(
    context: IExecutionContext,
    table: Table,
    valueChanges: FieldValueChangeSet
  ): Promise<Result<void, DomainError>> {
    const repository = this;
    return await safeTry<void, DomainError>(async function* () {
      yield* await repository.cascadeService.cascade(context, {
        table,
        selfBackfillFieldIds: [],
        valueChangedFieldIds: valueChanges.deferredBackfillFieldIds,
        hasDbStorageTypeChange: valueChanges.hasDbStorageTypeChange,
      });

      return ok(undefined);
    });
  }

  @TraceSpan()
  async delete(
    context: IExecutionContext,
    table: Table,
    options?: { mode?: 'soft' | 'permanent' }
  ): Promise<Result<void, DomainError>> {
    if ((options?.mode ?? 'soft') !== 'permanent') {
      return ok(undefined);
    }

    const repository = this;
    return await safeTry<void, DomainError>(async function* () {
      const { schema, tableName } = yield* table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: null }));
      const db = resolvePostgresDbOrTx(repository.db, context);

      try {
        const schemaBuilder = schema ? db.schema.withSchema(schema) : db.schema;
        await schemaBuilder.dropTable(tableName).ifExists().execute();
        invalidateUndoCaptureTableCache(`${schema ?? 'public'}.${tableName}`, repository.db);
      } catch (error) {
        return err(
          domainError.infrastructure({
            message: `Failed to delete table schema: ${describeError(error)}`,
          })
        );
      }

      return ok(undefined);
    });
  }

  private collectChangedSelectFieldIds(
    table: Table,
    fieldIds: ReadonlyArray<FieldId>
  ): ReadonlyArray<FieldId> {
    if (fieldIds.length === 0) return [];
    const selectFieldIds: FieldId[] = [];
    for (const fieldId of fieldIds) {
      const fieldResult = table.getField((field) => field.id().equals(fieldId));
      if (fieldResult.isErr()) continue;
      const fieldType = fieldResult.value.type().toString();
      if (fieldType === 'singleSelect' || fieldType === 'multipleSelect') {
        selectFieldIds.push(fieldId);
      }
    }

    return selectFieldIds;
  }

  private parseSelectOptions(raw: unknown): Result<ReadonlyArray<SelectOption>, DomainError> {
    if (raw == null) {
      return ok([]);
    }

    let parsedRaw: unknown = raw;
    if (typeof raw === 'string') {
      try {
        parsedRaw = JSON.parse(raw);
      } catch {
        return ok([]);
      }
    }

    if (typeof parsedRaw !== 'object' || parsedRaw == null) {
      return ok([]);
    }

    const choices = (parsedRaw as { choices?: unknown }).choices;
    if (!Array.isArray(choices)) {
      return ok([]);
    }

    const options: SelectOption[] = [];
    for (const choice of choices) {
      if (typeof choice !== 'object' || choice == null) {
        continue;
      }
      const optionResult = SelectOption.create(choice);
      if (optionResult.isErr()) {
        continue;
      }
      options.push(optionResult.value);
    }

    return ok(options);
  }
}

const dedupeFieldIds = (fieldIds: ReadonlyArray<FieldId>): FieldId[] => {
  const seen = new Map<string, FieldId>();
  for (const fieldId of fieldIds) {
    seen.set(fieldId.toString(), fieldId);
  }
  return [...seen.values()];
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
