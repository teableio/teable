import type {
  DomainError,
  FieldId,
  IExecutionContext,
  ITableRepository,
  Table,
} from '@teable/v2-core';
import type { SelectQueryBuilder } from 'kysely';
import type { Result } from 'neverthrow';

type DynamicDB = Record<string, Record<string, unknown>>;
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

export type { QB, DynamicDB };
