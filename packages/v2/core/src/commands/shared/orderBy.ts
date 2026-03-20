import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { FieldId } from '../../domain/table/fields/FieldId';
import type * as TableRecordQueryRepositoryPort from '../../ports/TableRecordQueryRepository';

/**
 * Helpers for translating view query sort/group config into repository orderBy.
 *
 * Example:
 * ```ts
 * const group = [{ fieldId: 'fld0000000000000001', order: 'asc' }];
 * const sort = [{ fieldId: 'fld0000000000000002', order: 'desc' }];
 * const groupBy = resolveGroupByToOrderBy(group).value;
 * const sortBy = resolveOrderBy(sort).value;
 * const orderBy = mergeOrderBy(groupBy, sortBy, 'viw0000000000000001');
 * // orderBy -> [{ fieldId: ... }, { fieldId: ... }, { column: '__row_viw...' }]
 * ```
 */
export type SortLike = {
  fieldId: string;
  order: 'asc' | 'desc';
};

/**
 * Convert sort items to repository orderBy.
 * Invalid field IDs are ignored.
 */
export const resolveOrderBy = (
  sort: ReadonlyArray<SortLike> | undefined
): Result<ReadonlyArray<TableRecordQueryRepositoryPort.FieldOrderBy> | undefined, DomainError> => {
  if (!sort || sort.length === 0) return ok(undefined);
  const orderBy: TableRecordQueryRepositoryPort.FieldOrderBy[] = [];
  for (const item of sort) {
    const fieldIdResult = FieldId.create(item.fieldId);
    if (fieldIdResult.isErr()) continue;
    orderBy.push({ fieldId: fieldIdResult.value, direction: item.order });
  }
  return ok(orderBy.length > 0 ? orderBy : undefined);
};

/**
 * Convert groupBy items to repository orderBy.
 * Invalid field IDs are ignored.
 */
export const resolveGroupByToOrderBy = (
  groupBy: ReadonlyArray<SortLike> | undefined
): Result<ReadonlyArray<TableRecordQueryRepositoryPort.FieldOrderBy> | undefined, DomainError> => {
  if (!groupBy || groupBy.length === 0) return ok(undefined);
  const orderBy: TableRecordQueryRepositoryPort.FieldOrderBy[] = [];
  for (const item of groupBy) {
    const fieldIdResult = FieldId.create(item.fieldId);
    if (fieldIdResult.isErr()) continue;
    orderBy.push({ fieldId: fieldIdResult.value, direction: item.order });
  }
  return ok(orderBy.length > 0 ? orderBy : undefined);
};

/**
 * Merge groupBy + sort order into a single orderBy list.
 * Always appends a stable tie-breaker for consistent pagination.
 * Use view row order only when the caller did not request any field/group sorting;
 * otherwise fall back to `__auto_number` to match v1's tie-breaking semantics.
 */
export const mergeOrderBy = (
  groupByOrderBy: ReadonlyArray<TableRecordQueryRepositoryPort.FieldOrderBy> | undefined,
  sortOrderBy: ReadonlyArray<TableRecordQueryRepositoryPort.FieldOrderBy> | undefined,
  viewId: string | undefined
): ReadonlyArray<TableRecordQueryRepositoryPort.TableRecordOrderBy> | undefined => {
  const result: TableRecordQueryRepositoryPort.TableRecordOrderBy[] = [];
  const seen = new Set<string>();

  const pushUnique = (item: TableRecordQueryRepositoryPort.TableRecordOrderBy) => {
    const key =
      'fieldId' in item ? `field:${item.fieldId.toString()}` : `column:${String(item.column)}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  };

  groupByOrderBy?.forEach(pushUnique);
  sortOrderBy?.forEach(pushUnique);

  const hasExplicitOrder = result.length > 0;

  // Use view row order only for pure manual row ordering. Once a field/group sort is active,
  // v1 falls back to auto number within ties instead of reusing the view row column.
  pushUnique({
    column: !hasExplicitOrder && viewId ? `__row_${viewId}` : '__auto_number',
    direction: 'asc',
  });

  return result.length > 0 ? result : undefined;
};

/**
 * Merge groupBy + sort order for offset-targeted range commands.
 * Range commands address visible rows, so ties must continue to respect the view row order
 * before falling back to auto number for a final deterministic ordering.
 */
export const mergeOrderByWithViewRowTieBreaker = (
  groupByOrderBy: ReadonlyArray<TableRecordQueryRepositoryPort.FieldOrderBy> | undefined,
  sortOrderBy: ReadonlyArray<TableRecordQueryRepositoryPort.FieldOrderBy> | undefined,
  viewId: string | undefined
): ReadonlyArray<TableRecordQueryRepositoryPort.TableRecordOrderBy> | undefined => {
  const result: TableRecordQueryRepositoryPort.TableRecordOrderBy[] = [];
  const seen = new Set<string>();

  const pushUnique = (item: TableRecordQueryRepositoryPort.TableRecordOrderBy) => {
    const key =
      'fieldId' in item ? `field:${item.fieldId.toString()}` : `column:${String(item.column)}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  };

  groupByOrderBy?.forEach(pushUnique);
  sortOrderBy?.forEach(pushUnique);

  if (viewId) {
    pushUnique({
      column: `__row_${viewId}`,
      direction: 'asc',
    });
  }

  pushUnique({
    column: '__auto_number',
    direction: 'asc',
  });

  return result.length > 0 ? result : undefined;
};
