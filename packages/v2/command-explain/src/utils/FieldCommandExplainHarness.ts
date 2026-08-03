import {
  type DomainError,
  Field,
  FieldType,
  type FieldId,
  type IDomainEvent,
  type IEventBus,
  type IExecutionContext,
  type IFindOptions,
  type ISpecification,
  type ITableRepository,
  type ITableSchemaRepository,
  type ITableSpecVisitor,
  type IUnitOfWork,
  Table,
  TableByIdSpec,
  TableId,
  type TableSortKey,
  type TableUpdatePersistResult,
  type UnitOfWorkOperation,
  DbFieldName,
} from '@teable/v2-core';
import {
  ComputedTableRecordQueryBuilder,
  ComputedUpdatePlanner,
  FieldValueChangeCollectorVisitor,
  TableAddFieldCollectorVisitor,
  TableSchemaUpdateVisitor,
  UpdateFromSelectBuilder,
  isPersistedAsGeneratedColumn,
  type DynamicDB,
} from '@teable/v2-adapter-table-repository-postgres';
import type { IPgTypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

export type CapturedFieldExplainStatement = {
  readonly description: string;
  readonly sql: string;
  readonly parameters: ReadonlyArray<unknown>;
  readonly explainable: boolean;
  readonly execute: boolean;
  readonly initialError?: string;
};

export const isExplainableSqlStatement = (sqlText: string): boolean => {
  const normalized = sqlText.trimStart().toLowerCase();
  return (
    normalized.startsWith('select ') ||
    normalized.startsWith('insert ') ||
    normalized.startsWith('update ') ||
    normalized.startsWith('delete ') ||
    normalized.startsWith('merge ') ||
    normalized.startsWith('with ')
  );
};

export class NoopEventBus implements IEventBus {
  async publish(
    _context: IExecutionContext,
    _event: IDomainEvent
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async publishMany(
    _context: IExecutionContext,
    _events: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

export class NoopUnitOfWork implements IUnitOfWork {
  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
    return work(context);
  }
}

export class OverlayTableRepository implements ITableRepository {
  private readonly overlayByTableId = new Map<string, Table>();
  private readonly deletedTableIds = new Set<string>();

  constructor(private readonly delegate: ITableRepository) {}

  async insert(context: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    this.deletedTableIds.delete(table.id().toString());
    this.overlayByTableId.set(table.id().toString(), table);
    return ok(table);
  }

  async insertMany(
    context: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    for (const table of tables) {
      this.deletedTableIds.delete(table.id().toString());
      this.overlayByTableId.set(table.id().toString(), table);
    }
    return ok(tables);
  }

  async findOne(
    context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    for (const table of this.overlayByTableId.values()) {
      if (!this.deletedTableIds.has(table.id().toString()) && spec.isSatisfiedBy(table)) {
        return ok(table);
      }
    }

    const result = await this.delegate.findOne(context, spec);
    if (result.isErr()) {
      return err(result.error);
    }

    const overlay = this.overlayByTableId.get(result.value.id().toString());
    if (overlay && !this.deletedTableIds.has(overlay.id().toString())) {
      return ok(overlay);
    }

    return result;
  }

  async find(
    context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    const result = await this.delegate.find(context, spec, options);
    if (result.isErr()) {
      return err(result.error);
    }

    const mergedByTableId = new Map<string, Table>();

    for (const table of result.value) {
      const overlay = this.overlayByTableId.get(table.id().toString());
      const effective = overlay ?? table;
      if (this.deletedTableIds.has(effective.id().toString())) {
        continue;
      }
      if (spec.isSatisfiedBy(effective)) {
        mergedByTableId.set(effective.id().toString(), effective);
      }
    }

    for (const table of this.overlayByTableId.values()) {
      if (this.deletedTableIds.has(table.id().toString())) {
        continue;
      }
      if (spec.isSatisfiedBy(table)) {
        mergedByTableId.set(table.id().toString(), table);
      }
    }

    return ok([...mergedByTableId.values()]);
  }

  async updateOne(
    _context: IExecutionContext,
    table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<TableUpdatePersistResult | void, DomainError>> {
    this.deletedTableIds.delete(table.id().toString());
    this.overlayByTableId.set(table.id().toString(), table);
    return ok(undefined);
  }

  async restore(_context: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    this.deletedTableIds.delete(table.id().toString());
    this.overlayByTableId.set(table.id().toString(), table);
    return ok(undefined);
  }

  async delete(context: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    this.overlayByTableId.delete(table.id().toString());
    this.deletedTableIds.add(table.id().toString());
    return ok(undefined);
  }
}

type CaptureSchemaRepositoryOptions = {
  db: Kysely<V1TeableDatabase>;
  tableRepository: ITableRepository;
  computedUpdatePlanner: ComputedUpdatePlanner;
  typeValidationStrategy: IPgTypeValidationStrategy;
};

export class CaptureTableSchemaRepository implements ITableSchemaRepository {
  private readonly statements: CapturedFieldExplainStatement[] = [];

  constructor(private readonly options: CaptureSchemaRepositoryOptions) {}

  getStatements(): ReadonlyArray<CapturedFieldExplainStatement> {
    return this.statements;
  }

  async insert(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async insertMany(
    _context: IExecutionContext,
    _tables: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async update(
    context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    const captureCompiledStatement = this.captureCompiledStatement.bind(this);
    const captureFieldBackfillStatements = this.captureFieldBackfillStatements.bind(this);
    const captureCascadeStatements = this.captureCascadeStatements.bind(this);
    const captureCascadePlanStatements = this.captureCascadePlanStatements.bind(this);
    const db = this.options.db;
    return safeTry<Table, DomainError>(async function* () {
      yield* ensureDbFieldNames(table.getFields());

      const dbTableNameResult = table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: null }));
      if (dbTableNameResult.isErr()) {
        return err(dbTableNameResult.error);
      }

      const { schema, tableName } = dbTableNameResult.value;
      const visitor = new TableSchemaUpdateVisitor({
        db,
        schema,
        tableName,
        tableId: table.id().toString(),
        table,
      });

      yield* mutateSpec.accept(visitor);
      const schemaStatements = yield* visitor.where();
      for (let i = 0; i < schemaStatements.length; i++) {
        captureCompiledStatement(
          `Schema step ${i + 1}: table ${table.name().toString()}`,
          schemaStatements[i]!.compile(db)
        );
      }

      const addFieldCollector = new TableAddFieldCollectorVisitor();
      yield* mutateSpec.accept(addFieldCollector);
      yield* await captureFieldBackfillStatements(context, table, addFieldCollector.fields(), {
        descriptionPrefix: 'Field backfill',
        includeOneManyTwoWay: addFieldCollector
          .fields()
          .some((field: Field) => field.type().equals(FieldType.link())),
      });

      const valueChangeVisitor = new FieldValueChangeCollectorVisitor();
      yield* mutateSpec.accept(valueChangeVisitor);
      yield* await captureCascadeStatements(context, table, {
        selfBackfillFieldIds: valueChangeVisitor.selfBackfillFields(),
        valueChangedFieldIds: valueChangeVisitor.valueChangedFields(),
        deferredBackfillFieldIds: valueChangeVisitor.deferredBackfillFields(),
        hasDbStorageTypeChange: valueChangeVisitor.hasDbStorageTypeChange(),
      });

      const deferredFieldIds = valueChangeVisitor.deferredBackfillFields();
      if (deferredFieldIds.length > 0) {
        yield* await captureCascadePlanStatements(context, table, {
          fieldIds: deferredFieldIds,
          skipDistinctFilter: valueChangeVisitor.hasDbStorageTypeChange(),
          descriptionPrefix: 'Deferred computed cascade',
        });
      }

      return ok(table);
    });
  }

  async delete(
    _context: IExecutionContext,
    table: Table,
    options?: { mode?: 'soft' | 'permanent' }
  ): Promise<Result<void, DomainError>> {
    if ((options?.mode ?? 'soft') !== 'permanent') {
      return ok(undefined);
    }

    const dbTableNameResult = table
      .dbTableName()
      .andThen((name) => name.split({ defaultSchema: null }));
    if (dbTableNameResult.isErr()) {
      return err(dbTableNameResult.error);
    }

    const { schema, tableName } = dbTableNameResult.value;
    const schemaBuilder = schema
      ? this.options.db.schema.withSchema(schema)
      : this.options.db.schema;
    this.captureCompiledStatement(
      `Schema delete: table ${table.name().toString()}`,
      schemaBuilder.dropTable(tableName).ifExists().compile()
    );

    return ok(undefined);
  }

  private captureCompiledStatement(
    description: string,
    compiled: { sql: string; parameters: ReadonlyArray<unknown> }
  ) {
    this.statements.push({
      description,
      sql: compiled.sql,
      parameters: compiled.parameters,
      explainable: isExplainableSqlStatement(compiled.sql),
      execute: true,
    });
  }

  private captureBuildError(description: string, error: unknown) {
    this.statements.push({
      description,
      sql: `-- ${describeError(error)}`,
      parameters: [],
      explainable: false,
      execute: false,
      initialError: describeError(error),
    });
  }

  private async captureFieldBackfillStatements(
    context: IExecutionContext,
    table: Table,
    fields: ReadonlyArray<Field>,
    options: {
      descriptionPrefix: string;
      includeOneManyTwoWay?: boolean;
      skipDistinctFilter?: boolean;
    }
  ): Promise<Result<void, DomainError>> {
    const backfillFields: Field[] = [];
    for (const field of fields) {
      if (!needsBackfill(field, options.includeOneManyTwoWay)) {
        continue;
      }
      const persistedAsGeneratedResult = isPersistedAsGeneratedColumn(field);
      if (persistedAsGeneratedResult.isErr()) {
        return err(persistedAsGeneratedResult.error);
      }
      if (persistedAsGeneratedResult.value) {
        continue;
      }
      backfillFields.push(field);
    }

    if (backfillFields.length === 0) {
      return ok(undefined);
    }

    const fieldIds = backfillFields.map((field) => field.id());
    const fieldLabels = backfillFields.map(
      (field) => `${field.name().toString()} (${field.type().toString()})`
    );

    const builder = new ComputedTableRecordQueryBuilder(
      this.options.db as unknown as Kysely<DynamicDB>,
      {
        typeValidationStrategy: this.options.typeValidationStrategy,
        forceLookupArrayOutput: true,
      }
    )
      .from(table)
      .select(fieldIds);

    const prepareResult = await builder.prepare({
      context,
      tableRepository: this.options.tableRepository,
    });
    if (prepareResult.isErr()) {
      this.captureBuildError(
        `${options.descriptionPrefix}: table ${table.name().toString()} [${fieldLabels.join(', ')}]`,
        prepareResult.error
      );
      return ok(undefined);
    }

    const selectQueryResult = builder.build();
    if (selectQueryResult.isErr()) {
      this.captureBuildError(
        `${options.descriptionPrefix}: table ${table.name().toString()} [${fieldLabels.join(', ')}]`,
        selectQueryResult.error
      );
      return ok(undefined);
    }

    const updateBuilder = new UpdateFromSelectBuilder(
      this.options.db as unknown as Kysely<DynamicDB>
    );
    const compiledResult = updateBuilder.build({
      table,
      fieldIds,
      selectQuery: selectQueryResult.value,
      skipDistinctFilter: options.skipDistinctFilter,
    });
    if (compiledResult.isErr()) {
      this.captureBuildError(
        `${options.descriptionPrefix}: table ${table.name().toString()} [${fieldLabels.join(', ')}]`,
        compiledResult.error
      );
      return ok(undefined);
    }

    this.captureCompiledStatement(
      `${options.descriptionPrefix}: table ${table.name().toString()}, fields [${fieldLabels.join(', ')}]`,
      compiledResult.value
    );
    return ok(undefined);
  }

  private async captureCascadeStatements(
    context: IExecutionContext,
    table: Table,
    options: {
      selfBackfillFieldIds: ReadonlyArray<FieldId>;
      valueChangedFieldIds: ReadonlyArray<FieldId>;
      deferredBackfillFieldIds: ReadonlyArray<FieldId>;
      hasDbStorageTypeChange: boolean;
    }
  ): Promise<Result<void, DomainError>> {
    const deferredFieldIdSet = new Set(
      options.deferredBackfillFieldIds.map((fieldId) => fieldId.toString())
    );
    const eligibleSelfBackfillFieldIds = options.selfBackfillFieldIds.filter(
      (fieldId) => !deferredFieldIdSet.has(fieldId.toString())
    );
    const eligibleValueChangedFieldIds = options.valueChangedFieldIds.filter(
      (fieldId) => !deferredFieldIdSet.has(fieldId.toString())
    );

    if (eligibleSelfBackfillFieldIds.length > 0) {
      const fields = resolveFieldsById(table, eligibleSelfBackfillFieldIds);
      const backfillResult = await this.captureFieldBackfillStatements(context, table, fields, {
        descriptionPrefix: 'Computed self-backfill',
        includeOneManyTwoWay: true,
        skipDistinctFilter: options.hasDbStorageTypeChange,
      });
      if (backfillResult.isErr()) {
        return err(backfillResult.error);
      }
    }

    const changedFieldIds = dedupFieldIds([
      ...eligibleSelfBackfillFieldIds,
      ...eligibleValueChangedFieldIds,
    ]);
    if (changedFieldIds.length === 0) {
      return ok(undefined);
    }

    return this.captureCascadePlanStatements(context, table, {
      fieldIds: changedFieldIds,
      skipDistinctFilter: options.hasDbStorageTypeChange,
      descriptionPrefix: 'Computed cascade',
    });
  }

  private async captureCascadePlanStatements(
    context: IExecutionContext,
    table: Table,
    options: {
      fieldIds: ReadonlyArray<FieldId>;
      skipDistinctFilter: boolean;
      descriptionPrefix: string;
    }
  ): Promise<Result<void, DomainError>> {
    if (options.fieldIds.length === 0) {
      return ok(undefined);
    }

    const planResult = await this.options.computedUpdatePlanner.plan(
      {
        table,
        changedFieldIds: options.fieldIds,
        changedRecordIds: [],
        changeType: 'update',
        cyclePolicy: 'skip',
      },
      context
    );
    if (planResult.isErr()) {
      return err(planResult.error);
    }

    const sortedSteps = [...planResult.value.steps].sort((left, right) => left.level - right.level);
    for (const step of sortedSteps) {
      const targetTable = step.tableId.equals(table.id())
        ? table
        : await this.loadTableById(context, step.tableId.toString());
      if (!targetTable) {
        continue;
      }
      const fields = resolveFieldsById(targetTable, step.fieldIds);
      const result = await this.captureFieldBackfillStatements(context, targetTable, fields, {
        descriptionPrefix: `${options.descriptionPrefix} level ${step.level}`,
        includeOneManyTwoWay: true,
        skipDistinctFilter: options.skipDistinctFilter,
      });
      if (result.isErr()) {
        return err(result.error);
      }
    }

    return ok(undefined);
  }

  private async loadTableById(
    context: IExecutionContext,
    tableId: string
  ): Promise<Table | undefined> {
    const tableIdResult = TableId.create(tableId);
    if (tableIdResult.isErr()) {
      return undefined;
    }

    const tableResult = await this.options.tableRepository.findOne(
      context,
      TableByIdSpec.create(tableIdResult.value)
    );
    if (tableResult.isErr()) {
      return undefined;
    }

    return tableResult.value;
  }
}

const resolveFieldsById = (table: Table, fieldIds: ReadonlyArray<FieldId>): Field[] => {
  const fieldIdSet = new Set(fieldIds.map((fieldId) => fieldId.toString()));
  return table.getFields().filter((field) => fieldIdSet.has(field.id().toString()));
};

const dedupFieldIds = (fieldIds: ReadonlyArray<FieldId>): FieldId[] => {
  const fieldIdsByString = new Map<string, FieldId>();
  for (const fieldId of fieldIds) {
    fieldIdsByString.set(fieldId.toString(), fieldId);
  }
  return [...fieldIdsByString.values()];
};

const needsBackfill = (field: Field, includeOneManyTwoWay = false): boolean => {
  const computedFieldSpecResult = Field.specs().isComputed().build();
  if (computedFieldSpecResult.isOk() && computedFieldSpecResult.value.isSatisfiedBy(field)) {
    return true;
  }

  if (field.type().equals(FieldType.link())) {
    const linkField = field as Field & {
      relationship: () => { toString(): string };
      isOneWay: () => boolean;
    };
    if (linkField.relationship().toString() === 'oneMany' && !linkField.isOneWay()) {
      return includeOneManyTwoWay;
    }
    return true;
  }

  return false;
};

const ensureDbFieldNames = (fields: ReadonlyArray<Field>): Result<void, DomainError> => {
  for (const field of fields) {
    if (field.dbFieldName().isOk()) {
      continue;
    }

    const dbFieldNameResult = DbFieldName.rehydrate(field.id().toString());
    if (dbFieldNameResult.isErr()) {
      return err(dbFieldNameResult.error);
    }

    const setDbFieldNameResult = field.setDbFieldName(dbFieldNameResult.value);
    if (setDbFieldNameResult.isErr()) {
      return err(setDbFieldNameResult.error);
    }
  }

  return ok(undefined);
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
};
