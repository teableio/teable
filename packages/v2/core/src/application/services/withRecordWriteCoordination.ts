import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableSchemaCoordination } from '../../ports/TableSchemaCoordination';
import type { RecordWriteCoordinationPlan } from './RecordWriteCoordinationPlan';

export async function withRecordWriteCoordination<T>(input: {
  context: IExecutionContext;
  tableId: TableId;
  coordination: ITableSchemaCoordination;
  initialPlan: RecordWriteCoordinationPlan;
  loadTable: () => Promise<Result<Table, DomainError>>;
  planForTable: (table: Table) => RecordWriteCoordinationPlan;
  execute: (table: Table) => Promise<Result<T, DomainError>>;
}): Promise<Result<T, DomainError>> {
  if (input.initialPlan.mode === 'none') {
    const table = await input.loadTable();
    return table.isErr() ? err(table.error) : input.execute(table.value);
  }

  const tableIds = [input.tableId.toString()];
  const shared = await input.coordination.acquire(input.context, tableIds, 'shared');
  if (shared.isErr()) return err(shared.error);
  try {
    const table = await input.loadTable();
    if (table.isErr()) return err(table.error);
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
    return table.isErr() ? err(table.error) : await input.execute(table.value);
  } finally {
    await exclusive.value.release();
  }
}
