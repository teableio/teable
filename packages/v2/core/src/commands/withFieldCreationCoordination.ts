import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { TableId } from '../domain/table/TableId';
import { getUnitOfWorkTransaction, type IExecutionContext } from '../ports/ExecutionContext';
import type { ITableSchemaCoordination } from '../ports/TableSchemaCoordination';

export async function withFieldCreationCoordination<T>(
  context: IExecutionContext,
  tableId: TableId,
  coordination: ITableSchemaCoordination,
  execute: () => Promise<Result<T, DomainError>>
): Promise<Result<T, DomainError>> {
  // A parent transaction may already hold metadata locks. Waiting on a lease
  // here can deadlock with a standalone creator waiting for those locks.
  if (getUnitOfWorkTransaction(context, 'meta') || getUnitOfWorkTransaction(context, 'data')) {
    return execute();
  }

  // Both single and batch creation derive view column metadata from the table
  // snapshot. Hold the same lease from the metadata read through commit.
  const lease = await coordination.acquire(
    context,
    [tableId.toString()],
    'exclusive',
    context.abortSignal
  );
  if (lease.isErr()) return err(lease.error);
  try {
    return await execute();
  } finally {
    await lease.value.release();
  }
}
