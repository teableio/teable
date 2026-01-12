import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { Field } from '../domain/table/fields/Field';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from './ExecutionContext';

/**
 * Input for backfilling a computed field.
 */
export interface ComputedFieldBackfillInput {
  /** The table containing the field */
  table: Table;
  /** The newly created computed field */
  field: Field;
}

/**
 * Service interface for backfilling computed field values when a new computed field is created.
 *
 * When a computed field (formula, lookup, rollup, conditionalLookup, conditionalRollup)
 * is created on a table that already has records, the existing records will have NULL
 * values for the new field. This service computes and stores values for all existing records.
 *
 * Key design decisions:
 * 1. Does NOT load record IDs into memory - uses SQL UPDATE directly
 * 2. No dirty table mechanism - updates all records in the table
 * 3. Single column update - new fields have no downstream dependencies
 */
export interface IComputedFieldBackfillService {
  /**
   * Backfill computed values for a newly created field.
   * Uses the configured mode (sync/async/hybrid) to determine execution strategy.
   *
   * @param context Execution context (may contain transaction)
   * @param input The table and field to backfill
   * @returns Result indicating success or error
   */
  backfill(
    context: IExecutionContext,
    input: ComputedFieldBackfillInput
  ): Promise<Result<void, DomainError>>;

  /**
   * Backfill multiple computed fields at once.
   * Useful when creating multiple fields in a single operation.
   *
   * @param context Execution context
   * @param input The table and fields to backfill
   * @returns Result indicating success or error
   */
  backfillMany(
    context: IExecutionContext,
    input: { table: Table; fields: ReadonlyArray<Field> }
  ): Promise<Result<void, DomainError>>;

  /**
   * Execute backfill synchronously (internal method).
   * This is called by the worker when processing async tasks.
   *
   * @param context Execution context
   * @param input The table and field to backfill
   * @returns Result indicating success or error
   */
  executeSync(
    context: IExecutionContext,
    input: ComputedFieldBackfillInput
  ): Promise<Result<void, DomainError>>;

  /**
   * Execute backfill for multiple fields synchronously.
   * This is called by the worker when processing async tasks.
   *
   * @param context Execution context
   * @param input The table and fields to backfill
   * @returns Result indicating success or error
   */
  executeSyncMany(
    context: IExecutionContext,
    input: { table: Table; fields: ReadonlyArray<Field> }
  ): Promise<Result<void, DomainError>>;
}
