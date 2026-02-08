import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { RecordId } from '../../domain/table/records/RecordId';
import type { Table } from '../../domain/table/Table';
import type { ViewId } from '../../domain/table/views/ViewId';
import type { IExecutionContext } from '../ExecutionContext';
import type { IRecordOrderCalculator } from '../RecordOrderCalculator';

export class NoopRecordOrderCalculator implements IRecordOrderCalculator {
  async calculateOrders(
    _context: IExecutionContext,
    _table: Table,
    _viewId: ViewId,
    _anchorId: RecordId,
    _position: 'before' | 'after',
    _count: number
  ): Promise<Result<ReadonlyArray<number>, DomainError>> {
    return err(
      domainError.notImplemented({
        message: 'Record order calculator is not implemented',
        code: 'record_order.not_implemented',
      })
    );
  }
}
