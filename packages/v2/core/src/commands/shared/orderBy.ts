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
 * Always appends a stable row order column for consistent pagination.
 * The repository will fall back to `__auto_number` if the row order column doesn't exist.
 */
export const mergeOrderBy = (
  groupByOrderBy: ReadonlyArray<TableRecordQueryRepositoryPort.FieldOrderBy> | undefined,
  sortOrderBy: ReadonlyArray<TableRecordQueryRepositoryPort.FieldOrderBy> | undefined,
  viewId: string | undefined
): ReadonlyArray<TableRecordQueryRepositoryPort.TableRecordOrderBy> | undefined => {
  const result: TableRecordQueryRepositoryPort.TableRecordOrderBy[] = [];
  if (groupByOrderBy) result.push(...groupByOrderBy);
  if (sortOrderBy) result.push(...sortOrderBy);

  // Always append stable row order to match v1 pagination behavior.
  // The repository will fall back to __auto_number if the view order column doesn't exist.
  if (viewId) {
    result.push({ column: `__row_${viewId}`, direction: 'asc' });
  }

  return result.length > 0 ? result : undefined;
};
