import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';

export const toTableRecord = (
  table: Table,
  readModel: TableRecordReadModel
): Result<TableRecord, DomainError> =>
  TableRecord.fromRawFieldValues({
    id: readModel.id,
    tableId: table.id(),
    fields: readModel.fields,
  });
