import type {
  DomainError,
  FieldId,
  IExecutionContext,
  ISpecification,
  ITableRepository,
  ITableRecordConditionSpecVisitor,
  Table,
  TableRecord,
} from '@teable/v2-core';
import type { SelectQueryBuilder } from 'kysely';
import type { Result } from 'neverthrow';
import type { QueryMode } from './TableRecordQueryBuilderManager';

/**
 * System column names that can be used for ordering.
 * Includes built-in columns and view-specific row order columns.
 */
type SystemColumn =
  | '__id'
  | '__auto_number'
  | '__created_time'
  | '__last_modified_time'
  | '__created_by'
  | '__last_modified_by'
  | '__version'
  | `__row_${string}`;

/**
 * Valid column for orderBy: either a FieldId or a system column name.
 */
type OrderByColumn = FieldId | SystemColumn;

/**
 * Dynamic database schema type for Kysely.
 *
 * This is the canonical database schema type for all record-related Kysely operations
 * in this package. It represents a database where:
 * - Table names are dynamic strings (not known at compile time)
 * - Column names are dynamic strings (not known at compile time)
 * - Column values are of unknown type
 *
 * Use this type for ALL Kysely generic parameters in this package instead of
 * declaring ad-hoc `Record<string, Record<string, unknown>>` types.
 *
 * @example
 * ```typescript
 * // DO: Use DynamicDB for Kysely generics
 * const db = this.db as unknown as Kysely<DynamicDB>;
 * const executor: QueryExecutor<DynamicDB> = (db) => db.insertInto(tableName).values(values).execute();
 *
 * // DON'T: Declare ad-hoc types
 * type DB = Record<string, Record<string, unknown>>; // ❌
 * const db = this.db as unknown as Kysely<Record<string, Record<string, unknown>>>; // ❌
 * ```
 */
type DynamicDB = Record<string, Record<string, unknown>>;

/**
 * Standard query builder type for record queries.
 * A SelectQueryBuilder using the DynamicDB schema.
 */
type QB = SelectQueryBuilder<DynamicDB, string, Record<string, unknown>>;

/** Dependencies for query builder preparation */
export interface IQueryBuilderDeps {
  readonly context: IExecutionContext;
  readonly tableRepository: ITableRepository;
}

/**
 * Common interface for table record query builders.
 * Both computed and stored builders implement this interface.
 */
export interface ITableRecordQueryBuilder {
  readonly mode: QueryMode;
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
  select(projection: ReadonlyArray<FieldId>): this;

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
   * Set ordering for the query.
   * @param column - The column to order by (FieldId or system column like '__auto_number')
   * @param direction - Sort direction ('asc' or 'desc')
   */
  orderBy(column: OrderByColumn, direction: 'asc' | 'desc'): this;

  /**
   * Apply a record condition specification.
   * @param spec - Specification to filter records by
   */
  where(spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>): this;

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

export type { QB, DynamicDB, SystemColumn, OrderByColumn };
