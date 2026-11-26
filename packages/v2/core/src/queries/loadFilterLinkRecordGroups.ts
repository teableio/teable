import { err, ok, type Result } from 'neverthrow';

import type { RecordQueryPluginRunner } from '../application/services/RecordQueryPluginRunner';
import { andSpec } from '../domain/shared/specification/AndSpec';
import { isForbiddenError, type DomainError } from '../domain/shared/DomainError';
import type { ViewFilterLinkReference } from '../domain/table/methods/viewFilterLinkReferences';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { FieldId } from '../domain/table/fields/FieldId';
import { TableRecord } from '../domain/table/records/TableRecord';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { RecordQueryOperationKind } from '../ports/RecordQueryPlugin';
import type { ITableRecordQueryRepository } from '../ports/TableRecordQueryRepository';
import type { ITableRepository } from '../ports/TableRepository';
import { applyFieldMasksToRecords, collectMaskDependencyFieldIds } from './tableRecordFieldMasks';

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
  references: ReadonlyArray<ViewFilterLinkReference>,
  recordQueryPluginRunner: RecordQueryPluginRunner,
  options?: { readonly omitForbiddenGroups?: boolean }
): Promise<Result<ViewFilterLinkRecordGroup[], DomainError>> => {
  const groups: ViewFilterLinkRecordGroup[] = [];
  for (const reference of references) {
    const foreignSpecResult = Table.specs().byId(reference.foreignTableId).build();
    if (foreignSpecResult.isErr()) return err(foreignSpecResult.error);

    const foreignTableResult = await tableRepository.findOne(context, foreignSpecResult.value);
    if (foreignTableResult.isErr()) return err(foreignTableResult.error);

    const executionResult = await recordQueryPluginRunner.prepare({
      kind: RecordQueryOperationKind.getByIds,
      executionContext: context,
      table: foreignTableResult.value,
      payload: {
        recordIds: reference.recordIds.map((id) => id.toString()),
        projectionFieldIds: [reference.lookupFieldId.toString()],
      },
    });
    if (executionResult.isErr()) return err(executionResult.error);
    const guardResult = await executionResult.value.guard();
    if (guardResult.isErr()) {
      if (options?.omitForbiddenGroups && isForbiddenError(guardResult.error)) continue;
      return err(guardResult.error);
    }
    const scopeResult = executionResult.value.getScope();
    if (scopeResult.isErr()) return err(scopeResult.error);
    const scope = scopeResult.value;

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

    const idsSpec = RecordByIdsSpec.create(reference.recordIds);
    const specResult = scope?.recordSpec ? andSpec(idsSpec, scope.recordSpec) : ok(idsSpec);
    if (specResult.isErr()) return err(specResult.error);
    const canReadTitle =
      scope?.readableFieldIds == null ||
      scope.readableFieldIds.has(reference.lookupFieldId.toString());
    const fieldMasks = scope?.fieldMasks?.filter(
      (mask) => mask.fieldId === reference.lookupFieldId.toString()
    );
    const projectionIds = new Set([
      ...(canReadTitle ? [reference.lookupFieldId.toString()] : []),
      ...collectMaskDependencyFieldIds(fieldMasks),
    ]);
    const projectionFieldIds: FieldId[] = [];
    for (const fieldId of projectionIds) {
      const fieldIdResult = FieldId.create(fieldId);
      if (fieldIdResult.isErr()) return err(fieldIdResult.error);
      projectionFieldIds.push(fieldIdResult.value);
    }

    const recordsResult = await tableRecordQueryRepository.find(
      context,
      foreignTableResult.value,
      specResult.value,
      {
        mode: 'stored',
        orderBy: [{ column: '__auto_number', direction: 'asc' }],
        projectionFieldIds,
        fieldMasks,
        includeTotal: false,
      }
    );
    if (recordsResult.isErr()) return err(recordsResult.error);

    const records: ViewFilterLinkRecord[] = [];
    const visibleRecords = applyFieldMasksToRecords(
      foreignTableResult.value,
      recordsResult.value.records,
      fieldMasks,
      projectionIds
    );
    for (const record of visibleRecords) {
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
        ...(canReadTitle && titleResult.value ? { title: titleResult.value } : {}),
      });
    }

    groups.push({
      tableId: reference.foreignTableId.toString(),
      records,
    });
  }

  return ok(groups);
};
