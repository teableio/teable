import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { Table } from '../domain/table/Table';
import type { ViewId } from '../domain/table/views/ViewId';
import type { IExecutionContext } from './ExecutionContext';

/**
 * T8080: schema preparation for lazily created view row-order columns.
 *
 * Ordered creates must create the `__row_<viewId>` column, backfill it and
 * build its index before acquiring a table schema lease. The implementation
 * runs that work on the caller's non-transactional handle so `ADD COLUMN`,
 * the chunked backfill and `CREATE INDEX CONCURRENTLY` never execute while the
 * lease (or the request write transaction) is held. Preparation is idempotent;
 * order calculation itself stays on `IRecordOrderCalculator`.
 */
export interface IRecordOrderColumnPreparer {
  /**
   * Resolves `true` when this preparer owns the column lifecycle, so the caller
   * may skip its legacy pre-transaction preparation. The no-op default resolves
   * `false`, keeping the legacy path for hosts that only implement
   * `IRecordOrderCalculator`.
   */
  prepareOrderColumn(
    context: IExecutionContext,
    table: Table,
    viewId: ViewId
  ): Promise<Result<boolean, DomainError>>;
}
