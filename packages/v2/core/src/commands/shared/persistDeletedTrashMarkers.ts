import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type {
  DeletedTrashMarkerInput,
  ITableRecordRepository,
} from '../../ports/TableRecordRepository';

export const persistDeletedTrashMarkers = async (
  repository: ITableRecordRepository,
  context: IExecutionContext,
  table: Table,
  input: DeletedTrashMarkerInput
): Promise<Result<void, DomainError>> => {
  if (!input.recordIds.length || !repository.insertDeletedTrashRows) {
    return ok(undefined);
  }

  return repository.insertDeletedTrashRows(context, table, input);
};
