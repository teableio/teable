import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';

/**
 * Coordination modes for table schema operations.
 *
 * - `shared`: record writes that depend on the table metadata they read but do
 *   not change it. Typecast record writes belong here unless their preprocessing
 *   proves that they add select options.
 * - `exclusive`: schema changes (field deletion, and record writes whose
 *   accepted side effects add select options) that make previously read
 *   metadata stale.
 *
 * Leases are acquired, never upgraded. A caller that discovers it needs
 * `exclusive` while holding `shared` must release the shared lease first,
 * acquire a new exclusive lease, and reload every piece of metadata it uses.
 */
export const tableSchemaCoordinationModes = ['shared', 'exclusive'] as const;

export type TableSchemaCoordinationMode = (typeof tableSchemaCoordinationModes)[number];

/**
 * A held coordination lease for one or more tables.
 *
 * `tableIds` is the complete set of tables covered by this lease and `mode` is
 * the strength of that coverage.
 *
 * Coverage is limited to the tables named here. Indirect tables are not
 * covered unless the caller names them explicitly:
 * - link foreign tables read for title fill during a typecast record update;
 * - link foreign tables mutated by delete-field side effects (the reciprocal
 *   field removal runs under the deleted field's table lease only).
 * Callers that need cross-table protection must name every table in the same
 * acquisition.
 */
export interface ITableSchemaCoordinationLease {
  readonly mode: TableSchemaCoordinationMode;
  readonly tableIds: ReadonlyArray<string>;
  release(): Promise<void>;
}

export interface ITableSchemaCoordination {
  acquire(
    context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: TableSchemaCoordinationMode
  ): Promise<Result<ITableSchemaCoordinationLease, DomainError>>;
}

export const createTableSchemaCoordinationLease = (
  mode: TableSchemaCoordinationMode,
  tableIds: ReadonlyArray<string>,
  release: () => Promise<void> = async () => undefined
): ITableSchemaCoordinationLease => {
  const normalized = Array.from(new Set(tableIds)).sort();
  return {
    mode,
    tableIds: normalized,
    release,
  };
};

/**
 * Base implementation: every acquisition takes the requested locks at the
 * requested mode.
 */
export abstract class TableSchemaCoordination implements ITableSchemaCoordination {
  async acquire(
    context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: TableSchemaCoordinationMode
  ): Promise<Result<ITableSchemaCoordinationLease, DomainError>> {
    const requested = Array.from(new Set(tableIds)).sort();
    if (requested.length === 0) {
      return ok(createTableSchemaCoordinationLease(mode, []));
    }
    return this.acquireLocks(context, requested, mode);
  }

  protected abstract acquireLocks(
    context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: TableSchemaCoordinationMode
  ): Promise<Result<ITableSchemaCoordinationLease, DomainError>>;
}

/** Default coordination: every lease is immediately granted and releases nothing. */
export class NoopTableSchemaCoordination extends TableSchemaCoordination {
  protected async acquireLocks(
    _context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: TableSchemaCoordinationMode
  ): Promise<Result<ITableSchemaCoordinationLease, DomainError>> {
    return ok(createTableSchemaCoordinationLease(mode, tableIds));
  }
}
