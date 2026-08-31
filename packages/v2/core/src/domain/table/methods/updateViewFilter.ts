import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  isRecordFilterCondition,
  isRecordFilterDateValue,
  isRecordFilterFieldReferenceValue,
  isRecordFilterGroup,
  isRecordFilterNot,
  type RecordFilterNode,
  type RecordFilterValue,
} from '../../../queries/RecordFilterDto';
import { domainError, type DomainError } from '../../shared/DomainError';
import type { Field } from '../fields/Field';
import { FieldId } from '../fields/FieldId';
import { FieldType } from '../fields/FieldType';
import {
  RecordConditionDateValue,
  RecordConditionFieldReferenceValue,
  RecordConditionLiteralListValue,
  RecordConditionLiteralValue,
  type RecordConditionValue,
} from '../records/specs/RecordConditionValues';
import type { Table } from '../Table';
import { TableId } from '../TableId';
import type { TableUpdateResult } from '../TableMutator';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';
import { ViewQueryDefaults } from '../views/ViewQueryDefaults';
import { ViewSourceFilter, type ViewSourceFilterDTO } from '../views/ViewSourceFilter';

export type UpdateViewFilterMethodResult = {
  readonly view: View;
  readonly previousQueryDefaults: ViewQueryDefaults;
  readonly nextQueryDefaults: ViewQueryDefaults;
  readonly updateResult?: TableUpdateResult;
};

const filterFieldNotFound = (table: Table, fieldId: string): DomainError =>
  domainError.notFound({
    code: 'field.not_found',
    message: `Filter field ${fieldId} not found in table ${table.id().toString()}`,
  });

const resolveOwnedField = (table: Table, rawFieldId: string): Result<Field, DomainError> =>
  FieldId.create(rawFieldId).andThen((fieldId) =>
    table
      .getField((candidate) => candidate.id().equals(fieldId))
      .mapErr(() => filterFieldNotFound(table, rawFieldId))
  );

const validateSourceReferences = (
  table: Table,
  sourceFilter: ViewSourceFilterDTO | null
): Result<void, DomainError> => {
  if (sourceFilter == null) return ok(undefined);

  const visit = (group: ViewSourceFilterDTO): Result<void, DomainError> => {
    for (const item of group.filterSet) {
      if ('filterSet' in item) {
        const nested = visit(item);
        if (nested.isErr()) return nested;
        continue;
      }
      const fieldResult = resolveOwnedField(table, item.fieldId);
      if (fieldResult.isErr()) return err(fieldResult.error);
      if (fieldResult.value.type().equals(FieldType.button())) {
        return err(
          domainError.validation({
            code: 'view.filter_unsupported_field_type',
            message: `Filter field ${item.fieldId} has unsupported Button type`,
          })
        );
      }
      const value = item.value;
      if (
        value == null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !('type' in value) ||
        value.type !== 'field'
      ) {
        continue;
      }
      const reference = resolveOwnedField(table, value.fieldId);
      if (reference.isErr()) return err(reference.error);
      if (value.tableId !== undefined) {
        const tableId = TableId.create(value.tableId);
        if (tableId.isErr()) return err(tableId.error);
        if (!tableId.value.equals(table.id())) {
          return err(
            domainError.validation({
              code: 'view.filter_field_table_mismatch',
              message: `Filter field reference ${value.fieldId} belongs to another table`,
            })
          );
        }
      }
    }
    return ok(undefined);
  };
  return visit(sourceFilter);
};

const toConditionValue = (
  table: Table,
  rawValue: RecordFilterValue
): Result<RecordConditionValue | undefined, DomainError> => {
  if (rawValue === null) return ok(undefined);
  if (isRecordFilterFieldReferenceValue(rawValue)) {
    return resolveOwnedField(table, rawValue.fieldId).andThen((field) => {
      if (rawValue.tableId !== undefined) {
        const tableId = TableId.create(rawValue.tableId);
        if (tableId.isErr()) return err(tableId.error);
        if (!tableId.value.equals(table.id())) {
          return err(
            domainError.validation({
              code: 'view.filter_field_table_mismatch',
              message: `Filter field reference ${rawValue.fieldId} belongs to another table`,
            })
          );
        }
      }
      return RecordConditionFieldReferenceValue.create(field);
    });
  }
  if (isRecordFilterDateValue(rawValue)) return RecordConditionDateValue.create(rawValue);
  if (Array.isArray(rawValue)) return RecordConditionLiteralListValue.create(rawValue);
  return RecordConditionLiteralValue.create(rawValue);
};

const validateCanonicalNode = (table: Table, node: RecordFilterNode): Result<void, DomainError> => {
  if (isRecordFilterNot(node)) return validateCanonicalNode(table, node.not);
  if (isRecordFilterGroup(node)) {
    for (const item of node.items) {
      const result = validateCanonicalNode(table, item);
      if (result.isErr()) return result;
    }
    return ok(undefined);
  }
  if (!isRecordFilterCondition(node)) {
    return err(domainError.validation({ message: 'Invalid View filter condition' }));
  }
  return resolveOwnedField(table, node.fieldId).andThen((field) => {
    if (node.value === null && (node.operator === 'is' || node.operator === 'isNot')) {
      return ok(undefined);
    }
    return toConditionValue(table, node.value).andThen((value) =>
      field
        .spec()
        .create({ operator: node.operator, value })
        .map(() => undefined)
    );
  });
};

export function updateViewFilter(
  this: Table,
  viewId: ViewId,
  rawFilter: unknown
): Result<UpdateViewFilterMethodResult, DomainError> {
  const table = this;
  return safeTry<UpdateViewFilterMethodResult, DomainError>(function* () {
    const view = yield* table.getView(viewId);
    const sourceFilter = yield* ViewSourceFilter.create(rawFilter);
    yield* validateSourceReferences(table, sourceFilter.toDto());
    const canonicalFilter = sourceFilter.toCanonical();
    if (canonicalFilter !== null) yield* validateCanonicalNode(table, canonicalFilter);

    const previousQueryDefaults = yield* view.queryDefaults();
    const nextQueryDefaults = yield* ViewQueryDefaults.rehydrate(
      { ...previousQueryDefaults.toDto(), filter: canonicalFilter },
      { sourceFilter: sourceFilter.toDto() }
    );
    if (previousQueryDefaults.equals(nextQueryDefaults)) {
      return ok({ view, previousQueryDefaults, nextQueryDefaults });
    }
    const updateResult = yield* table.update((mutator) =>
      mutator.updateViewQueryDefaults({
        viewId,
        previousQueryDefaults,
        queryDefaults: nextQueryDefaults,
      })
    );
    const nextView = yield* updateResult.table.getView(viewId);
    return ok({ view: nextView, previousQueryDefaults, nextQueryDefaults, updateResult });
  });
}
