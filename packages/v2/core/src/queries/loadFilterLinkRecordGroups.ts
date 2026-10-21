import { err, ok, type Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { ViewFilterLinkReference } from '../domain/table/methods/viewFilterLinkReferences';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { TableRecord } from '../domain/table/records/TableRecord';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRecordQueryRepository } from '../ports/TableRecordQueryRepository';
import type { ITableRepository } from '../ports/TableRepository';

export type ViewFilterLinkRecord = {
  readonly id: string;
  readonly title?: string;
};

export type ViewFilterLinkRecordGroup = {
  readonly tableId: string;
  readonly records: ReadonlyArray<ViewFilterLinkRecord>;
};

export const loadFilterLinkRecordGroups = async (
  context: IExecutionContext,
  tableRepository: ITableRepository,
  tableRecordQueryRepository: ITableRecordQueryRepository,
  references: ReadonlyArray<ViewFilterLinkReference>
): Promise<Result<ViewFilterLinkRecordGroup[], DomainError>> => {
  const groups: ViewFilterLinkRecordGroup[] = [];
  for (const reference of references) {
    const foreignSpecResult = Table.specs().byId(reference.foreignTableId).build();
    if (foreignSpecResult.isErr()) return err(foreignSpecResult.error);

    const foreignTableResult = await tableRepository.findOne(context, foreignSpecResult.value);
    if (foreignTableResult.isErr()) return err(foreignTableResult.error);

    const lookupFieldResult = foreignTableResult.value.getField((field) =>
      field.id().equals(reference.lookupFieldId)
    );
    if (lookupFieldResult.isErr()) continue;

    if (reference.recordIds.length === 0) {
      groups.push({
        tableId: reference.foreignTableId.toString(),
        records: [],
      });
      continue;
    }

    const recordsResult = await tableRecordQueryRepository.find(
      context,
      foreignTableResult.value,
      RecordByIdsSpec.create(reference.recordIds),
      {
        mode: 'stored',
        orderBy: [{ column: '__auto_number', direction: 'asc' }],
        projectionFieldIds: [reference.lookupFieldId],
        includeTotal: false,
      }
    );
    if (recordsResult.isErr()) return err(recordsResult.error);

    const records: ViewFilterLinkRecord[] = [];
    for (const record of recordsResult.value.records) {
      const domainRecordResult = TableRecord.fromRawFieldValues({
        id: record.id,
        tableId: foreignTableResult.value.id(),
        fields: record.fields,
      });
      if (domainRecordResult.isErr()) return err(domainRecordResult.error);

      const titleResult = domainRecordResult.value.displayValue(
        foreignTableResult.value,
        reference.lookupFieldId
      );
      if (titleResult.isErr()) return err(titleResult.error);

      records.push({
        id: record.id,
        ...(titleResult.value ? { title: titleResult.value } : {}),
      });
    }

    groups.push({
      tableId: reference.foreignTableId.toString(),
      records,
    });
  }

  return ok(groups);
};
