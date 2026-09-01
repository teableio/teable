import { err, ok, type Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { FieldId } from '../fields/FieldId';
import { LinkField } from '../fields/types/LinkField';
import { RecordId } from '../records/RecordId';
import type { Table } from '../Table';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import type { ViewSourceFilterDTO } from '../views/ViewSourceFilter';

export type ViewFilterLinkReference = {
  readonly foreignTableId: TableId;
  readonly lookupFieldId: FieldId;
  readonly recordIds: ReadonlyArray<RecordId>;
};

type MutableViewFilterLinkReference = {
  foreignTableId: TableId;
  lookupFieldId: FieldId;
  recordIdsByValue: Map<string, RecordId>;
};

const collectRecordIds = (
  value: unknown
): {
  readonly hasReferenceValue: boolean;
  readonly recordIds: ReadonlyArray<RecordId>;
} => {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.startsWith('rec')
      ? [value]
      : [];
  const recordIds: RecordId[] = [];

  for (const candidate of values) {
    const recordIdResult = RecordId.create(candidate);
    if (recordIdResult.isOk()) {
      recordIds.push(recordIdResult.value);
    }
  }

  return {
    hasReferenceValue: Array.isArray(value) || values.length > 0,
    recordIds,
  };
};

export const collectFilterLinkReferences = (
  table: Table,
  sourceFilter: ViewSourceFilterDTO
): ReadonlyArray<ViewFilterLinkReference> => {
  const linkFields = table.getFields((field): field is LinkField => field instanceof LinkField);
  const linkFieldById = new Map(linkFields.map((field) => [field.id().toString(), field] as const));
  const lookupFieldByForeignTableId = new Map(
    linkFields.map(
      (field) =>
        [
          field.foreignTableId().toString(),
          {
            foreignTableId: field.foreignTableId(),
            lookupFieldId: field.lookupFieldId(),
          },
        ] as const
    )
  );
  const referencesByForeignTableId = new Map<string, MutableViewFilterLinkReference>();

  const visit = (group: ViewSourceFilterDTO): void => {
    for (const item of group.filterSet) {
      if ('filterSet' in item) {
        visit(item);
        continue;
      }

      const linkField = linkFieldById.get(item.fieldId);
      if (!linkField) continue;

      const collected = collectRecordIds(item.value);
      if (!collected.hasReferenceValue) continue;

      const foreignTableId = linkField.foreignTableId().toString();
      const lookup = lookupFieldByForeignTableId.get(foreignTableId);
      if (!lookup) continue;

      let reference = referencesByForeignTableId.get(foreignTableId);
      if (!reference) {
        reference = {
          ...lookup,
          recordIdsByValue: new Map(),
        };
        referencesByForeignTableId.set(foreignTableId, reference);
      }

      for (const recordId of collected.recordIds) {
        reference.recordIdsByValue.set(recordId.toString(), recordId);
      }
    }
  };

  visit(sourceFilter);

  return [...referencesByForeignTableId.values()].map((reference) => ({
    foreignTableId: reference.foreignTableId,
    lookupFieldId: reference.lookupFieldId,
    recordIds: [...reference.recordIdsByValue.values()],
  }));
};

export const viewFilterLinkReferences = function (
  this: Table,
  viewId: ViewId
): Result<ReadonlyArray<ViewFilterLinkReference>, DomainError> {
  const viewResult = this.getView(viewId);
  if (viewResult.isErr()) return err(viewResult.error);

  const queryDefaultsResult = viewResult.value.queryDefaults();
  if (queryDefaultsResult.isErr()) return err(queryDefaultsResult.error);

  const sourceFilter = queryDefaultsResult.value.sourceFilter();
  if (!sourceFilter) return ok([]);

  return ok(collectFilterLinkReferences(this, sourceFilter));
};
