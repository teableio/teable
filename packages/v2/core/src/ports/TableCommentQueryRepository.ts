import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { TableId } from '../domain/table/TableId';
import type { IExecutionContext } from './ExecutionContext';

export interface ITableCommentCount {
  readonly recordId: string;
  readonly count: number;
}

/** Counts non-deleted comments for an already authorized page of records. */
export interface ITableCommentQueryRepository {
  countByRecordIds(
    context: IExecutionContext,
    tableId: TableId,
    recordIds: ReadonlyArray<string>
  ): Promise<Result<ReadonlyArray<ITableCommentCount>, DomainError>>;
}
