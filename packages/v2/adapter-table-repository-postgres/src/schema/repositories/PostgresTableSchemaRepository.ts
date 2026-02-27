import { TraceSpan, DbFieldName, domainError, isDomainError } from '@teable/v2-core';
import {
  SelectOption,
  type FieldId,
  type IExecutionContext,
  type ISpecification,
  type ITableSchemaRepository,
  type Field,
  type LinkField,
  type ITableSpecVisitor,
  type Table,
  type DomainError,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql } from 'kysely';
import type {
  Kysely,
  ColumnDefinitionBuilder,
  CompiledQuery,
  CreateTableBuilder,
  Transaction,
} from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { FieldDependencyGraph } from '../../record/computed/FieldDependencyGraph';
import { v2RecordRepositoryPostgresTokens } from '../../record/di/tokens';
import { isNotNullViolation, isUniqueViolation } from '../../shared/errors';
import { v2PostgresDdlTokens } from '../di/tokens';
import { detectCircularDependency } from '../helpers/detectCircularDependency';
import {
  createFieldSchemaRules,
  createSchemaRuleContext,
  PostgresSchemaIntrospector,
} from '../rules';
import { DependencyChangeDetectorVisitor } from '../visitors/DependencyChangeDetectorVisitor';
import { FieldValueChangeCollectorVisitor } from '../visitors/FieldValueChangeCollectorVisitor';
import type { ICreateTableBuilderRef } from '../visitors/PostgresTableSchemaFieldCreateVisitor';
import { PostgresTableSchemaFieldCreateVisitor } from '../visitors/PostgresTableSchemaFieldCreateVisitor';
import { TableAddFieldCollectorVisitor } from '../visitors/TableAddFieldCollectorVisitor';
import { TableSchemaUpdateVisitor } from '../visitors/TableSchemaUpdateVisitor';

type ComputedFieldBackfillService = {
  backfillMany(
    context: IExecutionContext,
    input: {
      table: Table;
      fields: ReadonlyArray<Field>;
      includeOneManyTwoWay?: boolean;
    }
  ): Promise<Result<void, DomainError>>;
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
    @inject(v2RecordRepositoryPostgresTokens.computedFieldBackfillService)
    private readonly computedFieldBackfillService: ComputedFieldBackfillService,
    @inject(v2RecordRepositoryPostgresTokens.computedFieldCascadeService)
    private readonly cascadeService: ComputedFieldCascadeService,
    @inject(v2RecordRepositoryPostgresTokens.computedDependencyGraph)
    private readonly fieldDependencyGraph: FieldDependencyGraph
  ) {}

  private async ensureDeferredForeignKeys(
    context: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    const repository = this;
    return safeTry<void, DomainError>(async function* () {
      const db = resolvePostgresDb(repository.db, context) as Kysely<V1TeableDatabase>;
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
            introspector,
            schema,
            tableName,
            tableId: table.id().toString(),
            field,
            table,
          });

          const deferredFkRules = rules.filter(
            (rule) => rule.id.startsWith('fk:') || rule.id.startsWith('junction_fk:')
          );

          if (deferredFkRules.length === 0) continue;

          for (const rule of deferredFkRules) {
            const statements = yield* rule.up(ctx);
            await executeCompiledQueries(
              db,
              statements.map((statement) => statement.compile(db))
            );
          }
        }
      }

      return ok(undefined);
    });
  }

  @TraceSpan()
  async insert(context: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    const repository = this;
    return await safeTry<void, DomainError>(async function* () {
      yield* ensureDbFieldNames(table.getFields());

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
        return err(
          domainError.infrastructure({
            message: `Failed to insert table schema: ${describeError(error)}`,
          })
        );
      }

      return ok(undefined);
    });
  }

  @TraceSpan()
  async insertMany(
    context: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    for (const table of tables) {
      const result = await this.insert(context, table);
      if (result.isErr()) return err(result.error);
    }

    // Some FK constraints are conditionally created only if the target table already exists.
    // In batch table creation, referenced tables might be created later, so we do a second pass
    // to (idempotently) add any missing FK constraints once all tables exist.
    const ensureFkResult = await this.ensureDeferredForeignKeys(context, tables);
    if (ensureFkResult.isErr()) return err(ensureFkResult.error);

    return ok(undefined);
  }

  @TraceSpan()
  async update(
    context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    const repository = this;
    return await safeTry<void, DomainError>(async function* () {
      yield* ensureDbFieldNames(table.getFields());

      const { schema, tableName } = yield* table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: null }));

      const db = resolvePostgresDb(repository.db, context);
      const visitor = new TableSchemaUpdateVisitor({
        db,
        schema,
        tableName,
        tableId: table.id().toString(),
        table,
      });
      yield* mutateSpec.accept(visitor);
      const statements = yield* visitor.where();
      if (statements.length > 0) {
        try {
          await executeCompiledQueries(
            db,
            statements.map((statement) => statement.compile(db))
          );
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
            return err(
              domainError.validation({
                message: 'Cannot complete update: null value violates not-null constraint',
                code: 'validation.field.not_null',
              })
            );
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

      const valueChangeVisitor = new FieldValueChangeCollectorVisitor();
      yield* mutateSpec.accept(valueChangeVisitor);
      const selfBackfillFieldIds = valueChangeVisitor.selfBackfillFields();
      const valueChangedFieldIds = valueChangeVisitor.valueChangedFields();
      const deferredBackfillFieldIds = valueChangeVisitor.deferredBackfillFields();

      const backfillVisitor = new TableAddFieldCollectorVisitor();
      yield* mutateSpec.accept(backfillVisitor);
      const fields = backfillVisitor.fields();
      if (fields.length > 0) {
        yield* await repository.computedFieldBackfillService.backfillMany(context, {
          table,
          fields,
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
      if (selfBackfillFieldIds.length > 0 || valueChangedFieldIds.length > 0) {
        yield* await repository.cascadeService.cascade(context, {
          table,
          selfBackfillFieldIds,
          valueChangedFieldIds,
          deferredBackfillFieldIds,
          hasDbStorageTypeChange: valueChangeVisitor.hasDbStorageTypeChange(),
        });
      }

      return ok(undefined);
    });
  }

  @TraceSpan()
  async refreshInMemoryTableAfterUpdate(
    context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    const repository = this;
    return await safeTry<Table, DomainError>(async function* () {
      const selectFieldIds = yield* repository.collectChangedSelectFieldIds(table, mutateSpec);
      if (selectFieldIds.length === 0) {
        return ok(table);
      }

      const db = resolvePostgresDb(repository.db, context);
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
        const optionsResult = repository.parseSelectOptions(row.options);
        if (optionsResult.isErr()) return err(optionsResult.error);
        optionsByFieldId.set(row.id, optionsResult.value);
      }

      let nextTable = table;
      for (const fieldId of selectFieldIds) {
        const selectOptions = optionsByFieldId.get(fieldId.toString());
        if (!selectOptions || selectOptions.length === 0) continue;
        const nextTableResult = nextTable.addSelectOptions(fieldId, selectOptions);
        if (nextTableResult.isErr()) return err(nextTableResult.error);
        nextTable = nextTableResult.value;
      }

      return ok(nextTable);
    });
  }

  @TraceSpan()
  async replayDeferredBackfillAfterUpdate(
    context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    const repository = this;
    return await safeTry<void, DomainError>(async function* () {
      const valueChangeVisitor = new FieldValueChangeCollectorVisitor();
      yield* mutateSpec.accept(valueChangeVisitor);
      const deferredBackfillFieldIds = valueChangeVisitor.deferredBackfillFields();
      if (deferredBackfillFieldIds.length === 0) {
        return ok(undefined);
      }

      yield* await repository.cascadeService.cascade(context, {
        table,
        selfBackfillFieldIds: [],
        valueChangedFieldIds: deferredBackfillFieldIds,
        hasDbStorageTypeChange: valueChangeVisitor.hasDbStorageTypeChange(),
      });

      return ok(undefined);
    });
  }

  @TraceSpan()
  async delete(context: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    const repository = this;
    return await safeTry<void, DomainError>(async function* () {
      const { schema, tableName } = yield* table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: null }));
      const db = resolvePostgresDb(repository.db, context);

      try {
        const schemaBuilder = schema ? db.schema.withSchema(schema) : db.schema;
        await schemaBuilder.dropTable(tableName).ifExists().execute();
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
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Result<ReadonlyArray<FieldId>, DomainError> {
    const valueChangeVisitor = new FieldValueChangeCollectorVisitor();
    const acceptResult = mutateSpec.accept(valueChangeVisitor);
    if (acceptResult.isErr()) return err(acceptResult.error);

    const fieldIds = valueChangeVisitor.valueChangedFields();
    if (fieldIds.length === 0) return ok([]);

    const selectFieldIds: FieldId[] = [];
    for (const fieldId of fieldIds) {
      const fieldResult = table.getField((field) => field.id().equals(fieldId));
      if (fieldResult.isErr()) continue;
      const fieldType = fieldResult.value.type().toString();
      if (fieldType === 'singleSelect' || fieldType === 'multipleSelect') {
        selectFieldIds.push(fieldId);
      }
    }

    return ok(selectFieldIds);
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

const executeCompiledQueries = async <DB>(
  db: Kysely<DB> | Transaction<DB>,
  compiled: ReadonlyArray<CompiledQuery>
): Promise<void> => {
  for (const statement of compiled) {
    await db.executeQuery(statement);
  }
};
