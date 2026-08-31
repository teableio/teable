import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldKeyResolverService } from '../application/services/FieldKeyResolverService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import type { Table } from '../domain/table/Table';
import type { RecordQueryPluginScope } from '../ports/RecordQueryPlugin';
import type { IRecordReadQuerySource } from '../ports/TableRecordQueryRepository';
import {
  isRecordFilterCondition,
  isRecordFilterFieldReferenceValue,
  isRecordFilterGroup,
  isRecordFilterNot,
  type RecordFilter,
  type RecordFilterCondition,
  type RecordFilterNode,
} from './RecordFilterDto';

export type UnreadableFilterFieldPolicy = 'reject' | 'strip';

export type TableRecordQueryScopeInput = {
  readonly queryScope?: RecordQueryPluginScope;
  readonly recordReadQuerySource?: IRecordReadQuerySource;
};

/**
 * Resolve field keys in filter to field IDs.
 * Recursively walks the filter tree and resolves fieldId keys.
 */
export const resolveFilterFieldKeys = (
  table: Table,
  filter: RecordFilter,
  fieldKeyType: FieldKeyType
): Result<RecordFilter, DomainError> => {
  if (!filter) {
    return ok(null);
  }

  return resolveFilterNodeFieldKeys(table, filter, fieldKeyType);
};

const resolveFilterNodeFieldKeys = (
  table: Table,
  node: RecordFilterNode,
  fieldKeyType: FieldKeyType
): Result<RecordFilterNode, DomainError> => {
  if (fieldKeyType === FieldKeyType.Id) {
    return ok(node);
  }

  if (isRecordFilterCondition(node)) {
    const fieldIdResult = FieldKeyResolverService.resolveFieldKey(
      table,
      node.fieldId,
      fieldKeyType
    );
    if (fieldIdResult.isErr()) {
      return err(fieldIdResult.error);
    }

    const resolvedCondition: RecordFilterCondition = {
      ...node,
      fieldId: fieldIdResult.value,
    };

    if (
      node.value &&
      typeof node.value === 'object' &&
      isRecordFilterFieldReferenceValue(node.value)
    ) {
      const valueFieldIdResult = FieldKeyResolverService.resolveFieldKey(
        table,
        node.value.fieldId,
        fieldKeyType
      );
      if (valueFieldIdResult.isErr()) {
        return err(valueFieldIdResult.error);
      }

      return ok({
        ...resolvedCondition,
        value: {
          ...node.value,
          fieldId: valueFieldIdResult.value,
        },
      });
    }

    return ok(resolvedCondition);
  }

  if (isRecordFilterGroup(node)) {
    const resolvedItems: RecordFilterNode[] = [];
    for (const item of node.items) {
      const resolved = resolveFilterNodeFieldKeys(table, item, fieldKeyType);
      if (resolved.isErr()) {
        return resolved;
      }
      resolvedItems.push(resolved.value);
    }

    return ok({
      conjunction: node.conjunction,
      items: resolvedItems,
    });
  }

  if (isRecordFilterNot(node)) {
    return resolveFilterNodeFieldKeys(table, node.not, fieldKeyType).map((resolvedNot) => ({
      not: resolvedNot,
    }));
  }

  return ok(node);
};

export const getEnabledFieldIdSet = (
  query: TableRecordQueryScopeInput
): ReadonlySet<string> | undefined => {
  if (query.queryScope?.readableFieldIds != null) {
    return query.queryScope.readableFieldIds;
  }
  const enabledFieldIds = query.recordReadQuerySource?.enabledFieldIds;
  return enabledFieldIds ? new Set(enabledFieldIds) : undefined;
};

/**
 * Explicit client filters reject unreadable fields so the query cannot silently
 * broaden. Persisted view defaults strip stale unreadable fields so permission
 * changes do not make the view unusable.
 */
export const sanitizeFilterByEnabledFieldIds = (
  filter: RecordFilter | undefined,
  enabledFieldIds: ReadonlySet<string> | undefined,
  maskedFieldIds: ReadonlySet<string> | undefined,
  unreadableFieldPolicy: UnreadableFilterFieldPolicy
): Result<RecordFilter | undefined, DomainError> => {
  if (!filter || (enabledFieldIds == null && maskedFieldIds == null)) {
    return ok(filter);
  }

  const unreadableFieldResult = (): Result<undefined, DomainError> =>
    unreadableFieldPolicy === 'reject'
      ? err(
          domainError.validation({
            code: 'record.filter.unreadable_field',
            message: 'Filter references a field that is not readable',
          })
        )
      : ok(undefined);

  const sanitizeNode = (
    node: RecordFilterNode
  ): Result<RecordFilterNode | undefined, DomainError> => {
    if (isRecordFilterCondition(node)) {
      if (
        enabledFieldIds != null &&
        !enabledFieldIds.has(node.fieldId) &&
        !maskedFieldIds?.has(node.fieldId)
      ) {
        return unreadableFieldResult();
      }
      if (isRecordFilterFieldReferenceValue(node.value)) {
        if (
          enabledFieldIds != null &&
          !enabledFieldIds.has(node.value.fieldId) &&
          !maskedFieldIds?.has(node.value.fieldId)
        ) {
          return unreadableFieldResult();
        }
        if (maskedFieldIds?.has(node.value.fieldId)) {
          return err(
            domainError.validation({
              code: 'record.filter.masked_field_reference',
              message:
                'Filter field reference to a conditionally masked field is not allowed until mask-aware SQL is available',
            })
          );
        }
        if (maskedFieldIds?.has(node.fieldId)) {
          return err(
            domainError.validation({
              code: 'record.filter.masked_field_reference_lhs',
              message:
                'Filter comparing a conditionally masked field to another field is not allowed until mask-aware SQL CASE WHEN is available',
            })
          );
        }
      }
      return ok(node);
    }

    if (isRecordFilterGroup(node)) {
      const items: RecordFilterNode[] = [];
      for (const item of node.items) {
        const next = sanitizeNode(item);
        if (next.isErr()) return err(next.error);
        if (next.value != null) items.push(next.value);
      }
      return ok(
        items.length
          ? {
              conjunction: node.conjunction,
              items,
            }
          : undefined
      );
    }

    if (isRecordFilterNot(node)) {
      return sanitizeNode(node.not).map((nextNode) => (nextNode ? { not: nextNode } : undefined));
    }

    return ok(node);
  };

  return sanitizeNode(filter);
};

export const mergeFilterWithViewDefaults = (
  defaultFilter: RecordFilter | null | undefined,
  queryFilter: RecordFilter | undefined
): RecordFilter | undefined => {
  if (!defaultFilter && !queryFilter) {
    return undefined;
  }

  if (queryFilter) {
    return defaultFilter
      ? {
          conjunction: 'and',
          items: [defaultFilter, queryFilter],
        }
      : queryFilter;
  }

  return defaultFilter ?? undefined;
};

export const filterFieldIdsByEnabledFieldIds = (
  fieldIds: ReadonlyArray<FieldId>,
  enabledFieldIds: ReadonlySet<string> | undefined
): ReadonlyArray<FieldId> => {
  if (enabledFieldIds == null) {
    return fieldIds;
  }

  return fieldIds.filter((fieldId) => enabledFieldIds.has(fieldId.toString()));
};

/**
 * Query-access fields are the response projection allow-list plus masked
 * fields. A masked field is queryable because filter/sort/group/search compile
 * against its CTE-equivalent masked value; it remains absent from the response
 * projection when readableFieldIds excludes it (T6997).
 */
export const filterFieldIdsByQueryAccess = (
  fieldIds: ReadonlyArray<FieldId>,
  enabledFieldIds: ReadonlySet<string> | undefined,
  maskedFieldIds: ReadonlySet<string> | undefined
): ReadonlyArray<FieldId> => {
  if (enabledFieldIds == null) {
    return fieldIds;
  }
  return fieldIds.filter(
    (fieldId) => enabledFieldIds.has(fieldId.toString()) || maskedFieldIds?.has(fieldId.toString())
  );
};

export const resolveProjectionFieldIds = (
  table: Table,
  projection: ReadonlyArray<string> | undefined,
  fieldKeyType: FieldKeyType,
  enabledFieldIds?: ReadonlySet<string>
): Result<ReadonlyArray<FieldId> | undefined, DomainError> => {
  if (projection === undefined) {
    if (enabledFieldIds == null) {
      return ok(undefined);
    }
    const fieldIds: FieldId[] = [];
    for (const fieldIdText of enabledFieldIds) {
      const fieldId = FieldId.create(fieldIdText);
      if (fieldId.isOk()) {
        fieldIds.push(fieldId.value);
      }
    }
    return ok(fieldIds);
  }

  const fieldIds: FieldId[] = [];
  const seen = new Set<string>();
  for (const fieldKey of projection) {
    const resolvedFieldId = FieldKeyResolverService.resolveFieldKey(table, fieldKey, fieldKeyType);
    if (resolvedFieldId.isErr()) {
      return err(resolvedFieldId.error);
    }
    if (enabledFieldIds != null && !enabledFieldIds.has(resolvedFieldId.value)) {
      continue;
    }
    if (seen.has(resolvedFieldId.value)) {
      continue;
    }
    const fieldId = FieldId.create(resolvedFieldId.value);
    if (fieldId.isErr()) {
      return err(fieldId.error);
    }
    seen.add(resolvedFieldId.value);
    fieldIds.push(fieldId.value);
  }

  return ok(fieldIds);
};
