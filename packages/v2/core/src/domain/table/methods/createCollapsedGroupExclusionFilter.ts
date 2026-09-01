import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type {
  RecordFilter,
  RecordFilterCondition,
  RecordFilterNode,
} from '../../../queries/RecordFilterDto';
import { type DomainError } from '../../shared/DomainError';
import { FieldValueTypeVisitor } from '../fields/visitors/FieldValueTypeVisitor';
import type { Table } from '../Table';
import type { ViewQueryGroupItem } from '../views/ViewQueryDefaults';

export type CollapsedGroupValueRow = {
  readonly groupValues: ReadonlyArray<unknown>;
};

const stringifyGroupValue = (value: unknown): number | string | null => {
  if (typeof value === 'bigint' || typeof value === 'number') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (value == null) return null;
  return JSON.stringify(value);
};

const hashGroupFlag = (value: string): number => {
  let hash = 5381;
  let index = value.length;
  while (index) hash = (hash * 33) ^ value.charCodeAt(--index);
  return hash >>> 0;
};

const structuredIds = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(structuredIds);
  if (value && typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id);
  }
  return value;
};

/**
 * Translate collapsed group headers into the v1-compatible exclusion filter.
 *
 * The repository supplies grouped values, while the Table aggregate owns the Field
 * semantics needed to turn each collapsed path into a safe record predicate.
 */
export function createCollapsedGroupExclusionFilter(
  this: Table,
  groupBy: ReadonlyArray<ViewQueryGroupItem>,
  groupedRows: ReadonlyArray<CollapsedGroupValueRow>,
  collapsedGroupIds: ReadonlySet<string>
): Result<RecordFilter | undefined, DomainError> {
  return safeTry<RecordFilter | undefined, DomainError>(
    function* (this: Table) {
      if (!groupBy.length || !collapsedGroupIds.size) return ok(undefined);

      const previousValues: unknown[] = Array.from({ length: groupBy.length }, () => Symbol());
      const pathByGroupId = new Map<string, ReadonlyArray<unknown>>();
      for (const row of groupedRows) {
        for (let depth = 0; depth < Math.min(groupBy.length, row.groupValues.length); depth++) {
          const stringified = stringifyGroupValue(row.groupValues[depth]);
          if (previousValues[depth] === stringified) continue;
          previousValues[depth] = stringified;
          for (let inner = depth + 1; inner < previousValues.length; inner++) {
            previousValues[inner] = Symbol();
          }
          const groupId = String(
            hashGroupFlag(
              `${groupBy[depth]!.fieldId}_${[...previousValues.slice(0, depth), stringified].join(
                '_'
              )}`
            )
          );
          pathByGroupId.set(groupId, row.groupValues.slice(0, depth + 1));
        }
      }

      const collapsedPaths: RecordFilterNode[] = [];
      for (const groupId of collapsedGroupIds) {
        const path = pathByGroupId.get(groupId);
        if (!path) continue;
        const conditions: RecordFilterCondition[] = [];
        for (let depth = 0; depth < path.length; depth++) {
          const group = groupBy[depth];
          if (!group) continue;
          const field = yield* this.getField(
            (candidate) => candidate.id().toString() === group.fieldId
          );
          const valueType = yield* field.accept(new FieldValueTypeVisitor());
          const fieldType = field.type().toString();
          let value = path[depth];
          let operator: RecordFilterCondition['operator'] = 'isNot';

          if (
            fieldType === 'checkbox' ||
            (fieldType === 'formula' && valueType.cellValueType.toString() === 'boolean')
          ) {
            operator = 'is';
            value = value ? false : null;
          } else if (value == null) {
            operator = 'isNotEmpty';
          } else if (
            valueType.isMultipleCellValue.isMultiple() &&
            [
              'singleSelect',
              'multipleSelect',
              'user',
              'createdBy',
              'lastModifiedBy',
              'link',
            ].includes(fieldType)
          ) {
            operator = 'isNotExactly';
            value = structuredIds(value);
          } else if (['user', 'createdBy', 'lastModifiedBy', 'link'].includes(fieldType)) {
            value = structuredIds(value);
          }

          conditions.push({ fieldId: group.fieldId, operator, value: value as never });
        }
        if (conditions.length) collapsedPaths.push({ conjunction: 'or', items: conditions });
      }

      const filter: RecordFilter | undefined = collapsedPaths.length
        ? { conjunction: 'and', items: collapsedPaths }
        : undefined;
      return ok(filter);
    }.bind(this)
  );
}
