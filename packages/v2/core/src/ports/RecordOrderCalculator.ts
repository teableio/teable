import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { RecordId } from '../domain/table/records/RecordId';
import type { Table } from '../domain/table/Table';
import type { ViewId } from '../domain/table/views/ViewId';
import type { IExecutionContext } from './ExecutionContext';

export interface IRecordOrderCalculator {
  /**
   * Calculate row order values for a set of records to be moved.
   *
   * Implementations should ensure the view row order column exists and
   * compute fractional order values based on the anchor record.
   */
  calculateOrders(
    context: IExecutionContext,
    table: Table,
    viewId: ViewId,
    anchorId: RecordId,
    position: 'before' | 'after',
    count: number
  ): Promise<Result<ReadonlyArray<number>, DomainError>>;
}
