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
 * // orderBy -> [{ fieldId: ... }, { fieldId: ... }, { column: '__row_viw...' }, { column: '__auto_number' }]
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
 * Always appends stable tie-breakers for consistent pagination.
 * Tie-breakers must match the v1 read path that drives the grid's visible
 * order (`buildFilterSortQuery` appends the view row order column after the
 * requested sorts): field/group sorts first, then the view's manual row
 * order, then auto number. Breaking ties by auto number alone makes
 * offset-addressed range commands (paste/clear/delete) resolve different
 * rows than the grid displays whenever the sort has duplicate values.
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

  // The repository falls back per-table to auto number when the view row
  // column does not exist, so the view row tie-breaker is always safe to emit.
  if (viewId) {
    pushUnique({ column: `__row_${viewId}`, direction: 'asc' });
  }
  pushUnique({ column: '__auto_number', direction: 'asc' });

  return result.length > 0 ? result : undefined;
};

/**
 * Merge groupBy + sort order for offset-targeted range commands.
 * Range commands address the same visible rows returned by list queries, so they must use
 * the same final tie-breaker as `mergeOrderBy`. Otherwise grouped views can display rows in
 * one order while clear/paste/delete resolves the selected offset in another order.
 */
export const mergeOrderByWithViewRowTieBreaker = (
  groupByOrderBy: ReadonlyArray<TableRecordQueryRepositoryPort.FieldOrderBy> | undefined,
  sortOrderBy: ReadonlyArray<TableRecordQueryRepositoryPort.FieldOrderBy> | undefined,
  viewId: string | undefined
): ReadonlyArray<TableRecordQueryRepositoryPort.TableRecordOrderBy> | undefined => {
  return mergeOrderBy(groupByOrderBy, sortOrderBy, viewId);
};
