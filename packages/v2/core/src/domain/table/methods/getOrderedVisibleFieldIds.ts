import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { DomainError } from '../../shared/DomainError';
import type { FieldId } from '../fields/FieldId';
import type { Table } from '../Table';
import type { ViewColumnMetaEntry } from '../views/ViewColumnMeta';

/**
 * Check if a field is visible in the given view type based on its columnMeta entry.
 *
 * - Grid view uses `hidden` property (default visible)
 * - Form, Kanban, Gallery, Calendar, Plugin views use `visible` property
 */
function isFieldVisible(meta: ViewColumnMetaEntry | undefined, viewType: string): boolean {
  // Form, Kanban, Gallery, Calendar, Plugin views use visible property
  if (['form', 'kanban', 'gallery', 'calendar', 'plugin'].includes(viewType)) {
    return meta?.visible === true;
  }
  // Grid view uses hidden property (default visible)
  return meta?.hidden !== true;
}

export interface GetOrderedVisibleFieldIdsOptions {
  /** Custom field order. If provided, ignores view's columnMeta visibility. */
  projection?: ReadonlyArray<string>;
}

/**
 * Get ordered visible field IDs for a view.
 *
 * - If projection is provided, uses the projection's field order
 * - Otherwise filters hidden fields based on view type and sorts by columnMeta order
 */
export function getOrderedVisibleFieldIds(
  this: Table,
  viewId: string,
  options?: GetOrderedVisibleFieldIdsOptions
): Result<ReadonlyArray<FieldId>, DomainError> {
  // If projection is provided, use the projection's order
  if (options?.projection && options.projection.length > 0) {
    const result: FieldId[] = [];
    for (const fieldIdStr of options.projection) {
      const fieldResult = this.getField((f) => f.id().toString() === fieldIdStr);
      if (fieldResult.isOk()) {
        result.push(fieldResult.value.id());
      }
    }
    return ok(result);
  }

  // Get view and columnMeta
  const viewResult = this.getViewById(viewId);
  if (viewResult.isErr()) return err(viewResult.error);

  const view = viewResult.value;
  const columnMetaResult = view.columnMeta();
  if (columnMetaResult.isErr()) return err(columnMetaResult.error);

  const columnMeta = columnMetaResult.value.toDto();
  const viewType = view.type().toString();
  const fields = this.getFields();

  if (fields.length === 0) {
    return ok([]);
  }

  // Build order map
  const orderMap = new Map<string, number>();
  for (const [fieldIdStr, meta] of Object.entries(columnMeta)) {
    if (typeof meta.order === 'number') {
      orderMap.set(fieldIdStr, meta.order);
    }
  }

  const indexMap = new Map(fields.map((field, index) => [field.id().toString(), index]));

  // Filter visible fields, sort by order, return ID list
  const orderedVisibleFieldIds = fields
    .filter((field) => {
      const fieldIdStr = field.id().toString();
      const meta = columnMeta[fieldIdStr];
      return isFieldVisible(meta, viewType);
    })
    .map((field) => {
      const fieldId = field.id();
      const fieldIdStr = fieldId.toString();
      return {
        id: fieldId,
        order: orderMap.get(fieldIdStr),
        index: indexMap.get(fieldIdStr) ?? 0,
      };
    })
    .sort((a, b) => {
      const orderA = a.order ?? Number.POSITIVE_INFINITY;
      const orderB = b.order ?? Number.POSITIVE_INFINITY;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.id);

  return ok(orderedVisibleFieldIds);
}
