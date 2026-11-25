import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableSchemaCoordination } from '../../ports/TableSchemaCoordination';
import type { RecordWriteCoordinationPlan } from './RecordWriteCoordinationPlan';

/** Check the capability snapshot protected by the actual record-write lease. */
export const assertRecordActorStorageEnabled = (
  context: IExecutionContext,
  table: Table
): Result<void, DomainError> =>
  context.requireActorStorage && table.actorStorageVersion() !== 1
    ? err(
        domainError.conflict({
          code: 'actor_storage.not_enabled',
          message: 'Actor attribution storage must be enabled before this write.',
          details: { tableId: table.id().toString() },
        })
      )
    : ok(undefined);

export async function withRecordWriteCoordination<T>(input: {
  context: IExecutionContext;
  tableId: TableId;
  coordination: ITableSchemaCoordination;
  initialPlan: RecordWriteCoordinationPlan;
  loadTable: () => Promise<Result<Table, DomainError>>;
  planForTable: (table: Table) => RecordWriteCoordinationPlan;
  execute: (table: Table) => Promise<Result<T, DomainError>>;
}): Promise<Result<T, DomainError>> {
  if (input.initialPlan.mode === 'none' && !input.context.requireActorStorage) {
    const table = await input.loadTable();
    return table.isErr() ? err(table.error) : input.execute(table.value);
  }

  // T8081: the lease deliberately spans `loadTable` and `execute`. Loading the
  // table (and, later, the record) before acquiring would let a concurrent
  // schema mutation land between the snapshot and the write, so the record and
  // plan must be read under the same lease they are written under. Pool waiting
  // under the lease is bounded by the deployment's pool sizing and connection
  // timeout instead of by reordering the lock.
  const tableIds = [input.tableId.toString()];
  const shared = await input.coordination.acquire(input.context, tableIds, 'shared');
  if (shared.isErr()) return err(shared.error);
  try {
    const table = await input.loadTable();
    if (table.isErr()) return err(table.error);
    const actorStorage = assertRecordActorStorageEnabled(input.context, table.value);
    if (actorStorage.isErr()) return err(actorStorage.error);
    const plan = input.planForTable(table.value);
    if (!plan.requiresFreshTable) return await input.execute(table.value);
  } finally {
    // Release before reacquiring: simultaneous in-place upgrades deadlock.
    await shared.value.release();
  }

  const exclusive = await input.coordination.acquire(input.context, tableIds, 'exclusive');
  if (exclusive.isErr()) return err(exclusive.error);
  try {
    const table = await input.loadTable();
    if (table.isErr()) return err(table.error);
    const actorStorage = assertRecordActorStorageEnabled(input.context, table.value);
    return actorStorage.isErr() ? err(actorStorage.error) : await input.execute(table.value);
  } finally {
    await exclusive.value.release();
  }
}
