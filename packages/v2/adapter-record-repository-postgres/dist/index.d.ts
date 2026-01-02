import * as core from "@teable/v2-core";
import { AttachmentField, AutoNumberField, ButtonField, CheckboxField, CreatedByField, CreatedTimeField, DateField, DomainError, Field, FieldId, FormulaField, ICellValueSpecVisitor, IExecutionContext, IFieldVisitor, ILogger, ISpecification, ITableRepository, LastModifiedByField, LastModifiedTimeField, LinkField, LongTextField, LookupField, MultipleSelectField, NumberField, RatingField, RollupField, SetAttachmentValueSpec, SetCheckboxValueSpec, SetDateValueSpec, SetLinkValueSpec, SetLongTextValueSpec, SetMultipleSelectValueSpec, SetNumberValueSpec, SetRatingValueSpec, SetSingleLineTextValueSpec, SetSingleSelectValueSpec, SetUserValueSpec, SingleLineTextField, SingleSelectField, Table, UserField } from "@teable/v2-core";
import { Result } from "neverthrow";
import { AliasedRawBuilder, Kysely, SelectQueryBuilder } from "kysely";
import { V1TeableDatabase } from "@teable/v2-postgres-schema";

//#region src/di/tokens.d.ts
declare const v2RecordRepositoryPostgresTokens: {
  readonly db: symbol;
  readonly tableRecordQueryBuilderManager: symbol;
};
//#endregion
//#region src/di/register.d.ts
interface IV2RecordRepositoryPostgresConfig {
  /** Kysely database instance */
  db: Kysely<V1TeableDatabase>;
}
declare const registerV2RecordRepositoryPostgresAdapter: (c: any, config: IV2RecordRepositoryPostgresConfig) => DependencyContainer;
//#endregion
//#region src/query-builder/ITableRecordQueryBuilder.d.ts
type DynamicDB = Record<string, Record<string, unknown>>;
type QB = SelectQueryBuilder<DynamicDB, string, Record<string, unknown>>;
/** Dependencies for query builder preparation */
interface IQueryBuilderDeps {
  readonly context: IExecutionContext;
  readonly tableRepository: ITableRepository;
}
/**
 * Common interface for table record query builders.
 * Both computed and stored builders implement this interface.
 */
interface ITableRecordQueryBuilder {
  /**
   * Set the table to query from.
   * @param table - The table domain object
   */
  from(table: Table): this;
  /**
   * Set field projection (which fields to select).
   * If not called, all fields are selected.
   * @param projection - Array of field IDs to select
   */
  select(projection: FieldId[]): this;
  /**
   * Limit the number of records returned.
   * @param n - Maximum number of records
   */
  limit(n: number): this;
  /**
   * Skip a number of records.
   * @param n - Number of records to skip
   */
  offset(n: number): this;
  /**
   * Prepare the query builder by loading any required data.
   * Called by the manager before build().
   * Each builder decides what data it needs to prepare.
   *
   * @param deps - Dependencies for preparation (context, repositories)
   * @returns Result indicating success or error
   */
  prepare(deps: IQueryBuilderDeps): Promise<Result<void, DomainError>>;
  /**
   * Build the query and return a Kysely SelectQueryBuilder.
   * @returns Result containing the query builder or an error
   */
  build(): Result<QB, DomainError>;
}
//#endregion
//#region src/query-builder/FieldOutputColumnVisitor.d.ts
type FieldOutputColumn = {
  readonly fieldId: FieldId;
  readonly columnAlias: string;
};
/**
 * Visitor to collect field id -> output column alias mapping.
 * Currently all fields use dbFieldName as the output alias,
 * but this can be extended in the future for different field types.
 */
declare class FieldOutputColumnVisitor implements IFieldVisitor<FieldOutputColumn> {
  private readonly columns;
  /**
   * Collect output column mappings for all fields in a table.
   */
  collect(table: Table): Result<ReadonlyArray<FieldOutputColumn>, DomainError>;
  /**
   * Get the column alias for a single field.
   */
  getColumnAlias(field: Field): Result<string, DomainError>;
  private addColumn;
  visitSingleLineTextField(field: SingleLineTextField): Result<FieldOutputColumn, DomainError>;
  visitLongTextField(field: LongTextField): Result<FieldOutputColumn, DomainError>;
  visitNumberField(field: NumberField): Result<FieldOutputColumn, DomainError>;
  visitCheckboxField(field: CheckboxField): Result<FieldOutputColumn, DomainError>;
  visitDateField(field: DateField): Result<FieldOutputColumn, DomainError>;
  visitSingleSelectField(field: SingleSelectField): Result<FieldOutputColumn, DomainError>;
  visitMultipleSelectField(field: MultipleSelectField): Result<FieldOutputColumn, DomainError>;
  visitUserField(field: UserField): Result<FieldOutputColumn, DomainError>;
  visitAttachmentField(field: AttachmentField): Result<FieldOutputColumn, DomainError>;
  visitCreatedTimeField(field: CreatedTimeField): Result<FieldOutputColumn, DomainError>;
  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<FieldOutputColumn, DomainError>;
  visitAutoNumberField(field: AutoNumberField): Result<FieldOutputColumn, DomainError>;
  visitCreatedByField(field: CreatedByField): Result<FieldOutputColumn, DomainError>;
  visitLastModifiedByField(field: LastModifiedByField): Result<FieldOutputColumn, DomainError>;
  visitRatingField(field: RatingField): Result<FieldOutputColumn, DomainError>;
  visitButtonField(field: ButtonField): Result<FieldOutputColumn, DomainError>;
  visitFormulaField(field: FormulaField): Result<FieldOutputColumn, DomainError>;
  visitLinkField(field: LinkField): Result<FieldOutputColumn, DomainError>;
  visitLookupField(field: LookupField): Result<FieldOutputColumn, DomainError>;
  visitRollupField(field: RollupField): Result<FieldOutputColumn, DomainError>;
}
//#endregion
//#region src/query-builder/TableRecordQueryBuilderManager.d.ts
/** Query mode determines how fields are resolved */
type QueryMode = 'computed' | 'stored';
interface IQueryBuilderManagerOptions {
  /** Query mode. Defaults to 'computed' */
  mode?: QueryMode;
}
/**
 * Manager that creates the appropriate query builder based on configuration.
 *
 * For 'computed' mode:
 * - Creates ComputedTableRecordQueryBuilder
 * - Builder's prepare() loads foreign tables for link/lookup/rollup fields
 *
 * For 'stored' mode:
 * - Creates StoredTableRecordQueryBuilder that reads pre-stored values
 * - Builder's prepare() is no-op
 */
declare class TableRecordQueryBuilderManager {
  private readonly db;
  private readonly tableRepository;
  constructor(db: Kysely<V1TeableDatabase>, tableRepository: ITableRepository);
  /**
   * Create a query builder for the given table.
   * Calls prepare() on the builder to let it load any required data.
   *
   * @param context - Execution context for repository calls
   * @param table - The main table to query
   * @param options - Optional mode configuration
   * @returns Result containing the prepared query builder
   */
  createBuilder(context: IExecutionContext, table: Table, options?: IQueryBuilderManagerOptions): Promise<Result<ITableRecordQueryBuilder, DomainError>>;
}
//#endregion
//#region src/query-builder/computed/ComputedFieldSelectExpressionVisitor.d.ts
/** SQL aggregate functions for rollup */
declare const SqlAggregate: {
  readonly COUNT: "COUNT";
  readonly SUM: "SUM";
  readonly AVG: "AVG";
  readonly MAX: "MAX";
  readonly MIN: "MIN";
  readonly BOOL_AND: "BOOL_AND";
  readonly BOOL_OR: "BOOL_OR";
  readonly BOOL_XOR: "BOOL_XOR";
  readonly STRING_AGG: "STRING_AGG";
  readonly ARRAY_AGG: "ARRAY_AGG";
};
type SqlAggregate = (typeof SqlAggregate)[keyof typeof SqlAggregate];
/** Column type for lateral join */
type LateralColumnType = {
  type: 'link';
  lookupFieldId: FieldId;
  isMultiValue: boolean;
} | {
  type: 'lookup';
  foreignFieldId: FieldId;
} | {
  type: 'rollup';
  foreignFieldId: FieldId;
  aggregate: SqlAggregate;
};
/** Shared context for collecting lateral join requirements */
interface ILateralContext {
  /** Add a column to lateral join, returns the lateral alias */
  addColumn(linkFieldId: FieldId, foreignTableId: string, outputAlias: string, columnType: LateralColumnType): string;
}
declare class ComputedFieldSelectExpressionVisitor implements IFieldVisitor<AliasedRawBuilder<unknown, string>> {
  private readonly tableAlias;
  private readonly lateral;
  private readonly columnVisitor;
  constructor(tableAlias: string, lateral: ILateralContext);
  private getColAlias;
  private simpleColumn;
  visitSingleLineTextField(field: SingleLineTextField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitLongTextField(field: LongTextField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitNumberField(field: NumberField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitCheckboxField(field: CheckboxField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitDateField(field: DateField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitSingleSelectField(field: SingleSelectField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitMultipleSelectField(field: MultipleSelectField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitUserField(field: UserField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitAttachmentField(field: AttachmentField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitCreatedTimeField(field: CreatedTimeField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitAutoNumberField(field: AutoNumberField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitCreatedByField(field: CreatedByField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitLastModifiedByField(field: LastModifiedByField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitRatingField(field: RatingField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitButtonField(field: ButtonField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitFormulaField(field: FormulaField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitLinkField(field: LinkField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitLookupField(field: LookupField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitRollupField(field: RollupField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
}
//#endregion
//#region src/query-builder/computed/ComputedTableRecordQueryBuilder.d.ts
interface IComputedQueryBuilderOptions {
  /** Foreign tables for link/lookup/rollup - can be pre-set (for tests) or loaded via prepare() */
  readonly foreignTables?: ReadonlyMap<string, Table>;
}
/**
 * Query builder that computes field values using LATERAL joins and SQL expressions.
 * Dynamically resolves link/lookup/rollup fields through database-side computation.
 */
declare class ComputedTableRecordQueryBuilder implements ITableRecordQueryBuilder {
  private readonly db;
  private table;
  private projection;
  private limitValue;
  private offsetValue;
  private foreignTables;
  constructor(db: Kysely<DynamicDB>, options?: IComputedQueryBuilderOptions);
  from(table: Table): this;
  select(projection: FieldId[]): this;
  limit(n: number): this;
  offset(n: number): this;
  /**
   * Prepare by loading foreign tables needed for link/lookup/rollup fields.
   */
  prepare(deps: IQueryBuilderDeps): Promise<Result<void, DomainError>>;
  build(): Result<QB, DomainError>;
  private createLateralContext;
  private buildSelectColumns;
  private buildLateralJoins;
  private buildLateralSelectExpr;
  private getForeignColRef;
  /**
   * Build join condition based on relationship type.
   *
   * FK config meanings from LinkFieldConfig.buildDbConfig:
   * - manyOne/oneOne: selfKeyName='__id', foreignKeyName='__fk_{fieldId}' (FK in current table)
   *   → join: f.__id = t.{foreignKeyName}
   * - oneMany: selfKeyName='__fk_{symmetricFieldId}', foreignKeyName='__id' (FK in foreign table)
   *   → join: f.{selfKeyName} = t.__id
   * - manyMany: both keys point to junction table columns
   *   → join via junction table
   */
  private getJoinCondition;
}
//#endregion
//#region src/query-builder/stored/StoredFieldSelectVisitor.d.ts
/**
 * Visitor that generates simple SELECT expressions for stored column values.
 * All fields are selected directly from the table without any computation.
 */
declare class StoredFieldSelectVisitor implements IFieldVisitor<AliasedRawBuilder<unknown, string>> {
  private readonly tableAlias;
  constructor(tableAlias: string);
  private selectColumn;
  visitSingleLineTextField(field: SingleLineTextField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitLongTextField(field: LongTextField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitNumberField(field: NumberField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitCheckboxField(field: CheckboxField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitDateField(field: DateField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitSingleSelectField(field: SingleSelectField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitMultipleSelectField(field: MultipleSelectField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitUserField(field: UserField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitAttachmentField(field: AttachmentField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitCreatedTimeField(field: CreatedTimeField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitAutoNumberField(field: AutoNumberField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitCreatedByField(field: CreatedByField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitLastModifiedByField(field: LastModifiedByField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitRatingField(field: RatingField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitButtonField(field: ButtonField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitFormulaField(field: FormulaField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitLinkField(field: LinkField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitLookupField(field: LookupField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
  visitRollupField(field: RollupField): Result<AliasedRawBuilder<unknown, string>, DomainError>;
}
//#endregion
//#region src/query-builder/stored/StoredTableRecordQueryBuilder.d.ts
/**
 * Query builder that selects all stored column values directly.
 * No LATERAL joins, no formula computation - just raw column selection.
 * Used for fast reads when pre-computed values are acceptable.
 */
declare class StoredTableRecordQueryBuilder implements ITableRecordQueryBuilder {
  private readonly db;
  private table;
  private projection;
  private limitValue;
  private offsetValue;
  constructor(db: Kysely<DynamicDB>);
  from(table: Table): this;
  select(projection: FieldId[]): this;
  limit(n: number): this;
  offset(n: number): this;
  /**
   * No preparation needed for stored builder - reads pre-stored values.
   */
  prepare(_deps: IQueryBuilderDeps): Promise<Result<void, DomainError>>;
  build(): Result<QB, DomainError>;
  private buildSelectColumns;
}
//#endregion
//#region src/repository/PostgresTableRecordQueryRepository.d.ts
declare class PostgresTableRecordQueryRepository implements core.ITableRecordQueryRepository {
  private readonly queryBuilderManager;
  private readonly logger;
  constructor(queryBuilderManager: TableRecordQueryBuilderManager, logger: ILogger);
  find(context: core.IExecutionContext, table: core.Table, _spec?: core.ISpecification<core.TableRecord, core.ITableRecordConditionSpecVisitor>, options?: core.ITableRecordQueryOptions): Promise<Result<ReadonlyArray<core.TableRecordReadModel>, DomainError>>;
}
//#endregion
//#region src/repository/PostgresTableRecordRepository.d.ts
/**
 * PostgreSQL implementation of TableRecordRepository.
 *
 * Handles insert, update, and delete operations for table records.
 */
declare class PostgresTableRecordRepository implements core.ITableRecordRepository {
  private readonly db;
  private readonly logger;
  constructor(db: Kysely<V1TeableDatabase>, logger: ILogger);
  insert(context: core.IExecutionContext, table: core.Table, record: core.TableRecord): Promise<Result<void, DomainError>>;
  update(_context: core.IExecutionContext, _table: core.Table, _record: core.TableRecord): Promise<Result<void, DomainError>>;
  delete(_context: core.IExecutionContext, table: core.Table, recordId: core.RecordId): Promise<Result<void, DomainError>>;
}
//#endregion
//#region src/visitors/FieldDatabaseValueVisitor.d.ts
/**
 * Visitor that transforms cell values to their database storage format.
 *
 * This handles the conversion of JavaScript values to PostgreSQL-compatible formats:
 * - Primitive values (string, number, boolean) are returned as-is
 * - Complex values (arrays, objects) are JSON stringified for JSONB columns
 *
 * Usage:
 * ```typescript
 * const visitor = FieldDatabaseValueVisitor.create(cellValue.toValue());
 * const dbValue = field.accept(visitor);
 * ```
 */
declare class FieldDatabaseValueVisitor implements IFieldVisitor<unknown> {
  private readonly rawValue;
  private constructor();
  static create(rawValue: unknown): FieldDatabaseValueVisitor;
  visitSingleLineTextField(_field: SingleLineTextField): Result<unknown, DomainError>;
  visitLongTextField(_field: LongTextField): Result<unknown, DomainError>;
  visitNumberField(_field: NumberField): Result<unknown, DomainError>;
  visitRatingField(_field: RatingField): Result<unknown, DomainError>;
  visitFormulaField(_field: FormulaField): Result<unknown, DomainError>;
  visitRollupField(_field: RollupField): Result<unknown, DomainError>;
  visitLookupField(_field: LookupField): Result<unknown, DomainError>;
  visitSingleSelectField(_field: SingleSelectField): Result<unknown, DomainError>;
  visitMultipleSelectField(_field: MultipleSelectField): Result<unknown, DomainError>;
  visitCheckboxField(_field: CheckboxField): Result<unknown, DomainError>;
  visitDateField(_field: DateField): Result<unknown, DomainError>;
  visitAttachmentField(_field: AttachmentField): Result<unknown, DomainError>;
  visitUserField(_field: UserField): Result<unknown, DomainError>;
  visitLinkField(_field: LinkField): Result<unknown, DomainError>;
  visitCreatedTimeField(_field: CreatedTimeField): Result<unknown, DomainError>;
  visitLastModifiedTimeField(_field: LastModifiedTimeField): Result<unknown, DomainError>;
  visitCreatedByField(_field: CreatedByField): Result<unknown, DomainError>;
  visitLastModifiedByField(_field: LastModifiedByField): Result<unknown, DomainError>;
  visitAutoNumberField(_field: AutoNumberField): Result<unknown, DomainError>;
  visitButtonField(_field: ButtonField): Result<unknown, DomainError>;
}
//#endregion
//#region src/visitors/PostgresCellValueSpecVisitor.d.ts
/**
 * Column value entry for SQL generation
 */
interface ColumnValueEntry {
  fieldId: string;
  value: unknown;
}
/**
 * PostgreSQL implementation of ICellValueSpecVisitor.
 *
 * This visitor collects column/value pairs from SetValueSpecs for use in
 * UPDATE SQL generation.
 *
 * Future: Will be used when implementing repository.update() to generate
 * UPDATE SET column1 = value1, column2 = value2 ... queries.
 *
 * Usage:
 * ```typescript
 * const visitor = new PostgresCellValueSpecVisitor();
 * await spec.accept(visitor);
 * const entries = visitor.getColumnValues();
 * // Use entries to generate UPDATE SQL
 * ```
 */
declare class PostgresCellValueSpecVisitor implements ICellValueSpecVisitor {
  private readonly entries;
  /**
   * Generic visit method for ISpecification interface.
   * Required by ISpecVisitor.
   */
  visit(_spec: ISpecification<any, any>): Result<void, DomainError>;
  visitSetSingleLineTextValue(spec: SetSingleLineTextValueSpec): Result<void, DomainError>;
  visitSetLongTextValue(spec: SetLongTextValueSpec): Result<void, DomainError>;
  visitSetNumberValue(spec: SetNumberValueSpec): Result<void, DomainError>;
  visitSetRatingValue(spec: SetRatingValueSpec): Result<void, DomainError>;
  visitSetSingleSelectValue(spec: SetSingleSelectValueSpec): Result<void, DomainError>;
  visitSetMultipleSelectValue(spec: SetMultipleSelectValueSpec): Result<void, DomainError>;
  visitSetCheckboxValue(spec: SetCheckboxValueSpec): Result<void, DomainError>;
  visitSetDateValue(spec: SetDateValueSpec): Result<void, DomainError>;
  visitSetAttachmentValue(spec: SetAttachmentValueSpec): Result<void, DomainError>;
  visitSetLinkValue(spec: SetLinkValueSpec): Result<void, DomainError>;
  visitSetUserValue(spec: SetUserValueSpec): Result<void, DomainError>;
  /**
   * Get all collected column/value entries.
   */
  getColumnValues(): ReadonlyArray<ColumnValueEntry>;
  /**
   * Clear all collected entries.
   */
  clear(): void;
}
//#endregion
export { type ColumnValueEntry, ComputedFieldSelectExpressionVisitor, ComputedTableRecordQueryBuilder, type DynamicDB, FieldDatabaseValueVisitor, FieldOutputColumn, FieldOutputColumnVisitor, IComputedQueryBuilderOptions, ILateralContext, IQueryBuilderDeps, IQueryBuilderManagerOptions, ITableRecordQueryBuilder, IV2RecordRepositoryPostgresConfig, LateralColumnType, PostgresCellValueSpecVisitor, PostgresTableRecordQueryRepository, PostgresTableRecordRepository, type QB, QueryMode, SqlAggregate, StoredFieldSelectVisitor, StoredTableRecordQueryBuilder, TableRecordQueryBuilderManager, registerV2RecordRepositoryPostgresAdapter, v2RecordRepositoryPostgresTokens };
//# sourceMappingURL=index.d.ts.map