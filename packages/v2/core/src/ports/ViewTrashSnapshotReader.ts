import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { TableId } from '../domain/table/TableId';
import type { ViewId } from '../domain/table/views/ViewId';
import type { ViewSnapshotValue } from '../domain/table/views/ViewSnapshot';
import type { IExecutionContext } from './ExecutionContext';

/** Loads retained, server-owned trash state; never accepts a client snapshot. */
export interface IViewTrashSnapshotReader {
  get(
    context: IExecutionContext,
    tableId: TableId,
    viewId: ViewId
  ): Promise<Result<ViewSnapshotValue, DomainError>>;
}
