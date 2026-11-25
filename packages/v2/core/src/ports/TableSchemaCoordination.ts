import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { getUnitOfWorkTransaction, type IExecutionContext } from './ExecutionContext';

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

/** PostgreSQL proof checked again by the metadata publication transaction. */
export type TableSchemaLeaseFence = {
  backendPid: number;
  transactionId: string;
};

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
  readonly fence?: TableSchemaLeaseFence;
  /** Local lifecycle only; not a round-trip proof and never replaces publication fencing. */
  readonly isActive?: boolean;
  /** Absent on non-fenced adapters: capability publication must fail closed. */
  assertHeld?(): Promise<Result<void, DomainError>>;
  release(): Promise<void>;
}

export interface ITableSchemaCoordination {
  acquire(
    context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: TableSchemaCoordinationMode,
    /** Cancels acquisition only; a granted lease remains held until release(). */
    signal?: AbortSignal
  ): Promise<Result<ITableSchemaCoordinationLease, DomainError>>;
  /** Existing batches can only acquire on their own transaction without waiting. */
  tryAcquireInTransaction?(
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

const schemaLeaseScopeKey = Symbol('tableSchemaLeaseScope');
type ScopedExecutionContext = IExecutionContext & {
  [schemaLeaseScopeKey]?: {
    readonly lease: ITableSchemaCoordinationLease;
    readonly tableIds: ReadonlySet<string>;
    active: boolean;
  };
};

/** Reuse a parent's lease or reject an uncovered request without waiting on coordination. */
export function resolveScopedTableSchemaLease(
  context: IExecutionContext,
  tableIds: ReadonlyArray<string>,
  mode: TableSchemaCoordinationMode
): Result<ITableSchemaCoordinationLease, DomainError> | undefined {
  const scope = (context as ScopedExecutionContext)[schemaLeaseScopeKey];
  if (!scope) return undefined;
  const { lease } = scope;
  if (
    !scope.active ||
    lease.isActive === false ||
    (mode === 'exclusive' && lease.mode !== 'exclusive') ||
    tableIds.some((id) => !scope.tableIds.has(id))
  ) {
    return err(
      domainError.conflict({
        code: 'schema_coordination.busy',
        message: 'The operation exceeds its table schema lease; retry the request',
        details: { tableIds, mode },
      })
    );
  }
  return ok({
    tableIds: lease.tableIds,
    mode: lease.mode,
    fence: lease.fence,
    get isActive() {
      return scope.active && lease.isActive !== false;
    },
    assertHeld: lease.assertHeld?.bind(lease),
    release: async () => undefined,
  });
}

/** Hold a schema lease across a batch transaction and all its nested commands. */
export async function withTableSchemaCoordination<T>(
  context: IExecutionContext,
  coordination: ITableSchemaCoordination,
  tableIds: ReadonlyArray<string>,
  mode: TableSchemaCoordinationMode,
  work: (context: IExecutionContext) => Promise<Result<T, DomainError>>
): Promise<Result<T, DomainError>> {
  const scoped = resolveScopedTableSchemaLease(context, tableIds, mode);
  if (scoped) return scoped.isErr() ? err(scoped.error) : work(context);
  const inTransaction = Boolean(
    getUnitOfWorkTransaction(context, 'meta') || getUnitOfWorkTransaction(context, 'data')
  );
  const acquired = inTransaction
    ? await coordination.tryAcquireInTransaction?.(context, tableIds, mode)
    : await coordination.acquire(context, tableIds, mode, context.abortSignal);
  if (!acquired) {
    return err(
      domainError.invariant({
        code: 'schema_coordination.transaction_already_started',
        message: 'Acquire table schema coordination before starting the write transaction',
      })
    );
  }
  if (acquired.isErr()) return err(acquired.error);
  const lease = acquired.value;
  const scope = { lease, tableIds: new Set(lease.tableIds), active: true };
  const scopedContext: ScopedExecutionContext = { ...context, [schemaLeaseScopeKey]: scope };
  try {
    return await work(scopedContext);
  } finally {
    scope.active = false;
    await lease.release();
  }
}

/**
 * Base implementation: acquire requested locks or reuse explicit parent coverage.
 */
export abstract class TableSchemaCoordination implements ITableSchemaCoordination {
  async acquire(
    context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: TableSchemaCoordinationMode,
    signal?: AbortSignal
  ): Promise<Result<ITableSchemaCoordinationLease, DomainError>> {
    if (signal?.aborted) {
      return err(
        domainError.infrastructure({
          code: 'schema_coordination.cancelled',
          message: 'Table schema coordination acquisition cancelled',
        })
      );
    }
    const scoped = resolveScopedTableSchemaLease(context, tableIds, mode);
    if (scoped) return scoped;
    const requested = Array.from(new Set(tableIds)).sort();
    if (requested.length === 0) {
      return ok(createTableSchemaCoordinationLease(mode, []));
    }
    return this.acquireLocks(context, requested, mode, signal);
  }

  protected abstract acquireLocks(
    context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: TableSchemaCoordinationMode,
    signal?: AbortSignal
  ): Promise<Result<ITableSchemaCoordinationLease, DomainError>>;
}

/** Default coordination: every lease is immediately granted and releases nothing. */
export class NoopTableSchemaCoordination extends TableSchemaCoordination {
  async tryAcquireInTransaction(
    context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: TableSchemaCoordinationMode
  ): Promise<Result<ITableSchemaCoordinationLease, DomainError>> {
    return this.acquire(context, tableIds, mode, context.abortSignal);
  }

  protected async acquireLocks(
    _context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: TableSchemaCoordinationMode
  ): Promise<Result<ITableSchemaCoordinationLease, DomainError>> {
    return ok(createTableSchemaCoordinationLease(mode, tableIds));
  }
}
