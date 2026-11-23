import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import { FieldDisplayValueVisitor } from './FieldDisplayValueVisitor';

/** Presentation runs only after permission masking and response projection. */
export const presentRecordReadModels = (
  table: Table,
  records: ReadonlyArray<TableRecordReadModel>,
  cellFormat: 'json' | 'text'
): Result<ReadonlyArray<TableRecordReadModel>, DomainError> => safeTry(function* () {
  const visitor = new FieldDisplayValueVisitor();
  const formatters = new Map(
    table.getFields().filter((field) => cellFormat === 'text' || field.id().equals(table.primaryFieldId()))
      .map((field) => [field.id().toString(), field.accept(visitor)] as const)
  );
  const primaryFieldId = table.primaryFieldId().toString();
  const presented: TableRecordReadModel[] = [];
  for (const record of records) {
    const primaryValue = record.fields[primaryFieldId];
    const primaryFormatter = formatters.get(primaryFieldId);
    const name = primaryValue == null || !primaryFormatter
      ? undefined
      : yield* (yield* primaryFormatter)(primaryValue);
    const fields: Record<string, unknown> = {};
    for (const [fieldId, value] of Object.entries(record.fields)) {
      if (cellFormat === 'json') {
        fields[fieldId] = value;
        continue;
      }
      if (value == null) continue;
      const formatter = formatters.get(fieldId);
      if (formatter) fields[fieldId] = yield* (yield* formatter)(value);
    }
    presented.push({ ...record, ...(name != null ? { name: String(name) } : {}), fields });
  }
  return ok(presented);
});
