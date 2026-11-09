import { err, ok, type Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { FieldType } from '../fields/FieldType';
import { LinkField } from '../fields/types/LinkField';
import type { Table } from '../Table';
import type { ViewSortItem } from './ViewSort';

/**
 * Validate explicit pinyin collation against Table-owned field semantics.
 * Field support is always validated, while group conflicts only apply to active automatic sorts.
 * Omitted collation intentionally preserves the existing sort behavior.
 */
export const validateViewSortCollations = (
  table: Table,
  sort: ReadonlyArray<ViewSortItem> | undefined,
  group: ReadonlyArray<{ readonly fieldId: string }> | undefined = undefined,
  manualSort: boolean | undefined = undefined
): Result<void, DomainError> => {
  const groupedFieldIds = new Set(
    manualSort === true ? [] : (group ?? []).map((item) => item.fieldId)
  );

  for (const item of sort ?? []) {
    if (item.collation !== 'zh-pinyin') continue;

    if (groupedFieldIds.has(item.fieldId)) {
      return err(
        domainError.validation({
          code: 'sort.collation_group_conflict',
          message: `Sort field ${item.fieldId} cannot use zh-pinyin collation while grouped`,
        })
      );
    }

    const fieldResult = table.getField((field) => field.id().toString() === item.fieldId);
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    const fieldType = field.type();
    const isNativeText =
      !field.computed().toBoolean() &&
      (fieldType.equals(FieldType.singleLineText()) || fieldType.equals(FieldType.longText()));
    const isSingleValueLink = field instanceof LinkField && !field.isMultipleValue();

    if (!isNativeText && !isSingleValueLink) {
      return err(
        domainError.validation({
          code: 'sort.unsupported_collation',
          message: `Sort field ${item.fieldId} does not support zh-pinyin collation`,
        })
      );
    }
  }

  return ok(undefined);
};
