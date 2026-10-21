import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import type { Field } from '../fields/Field';
import type { FieldId } from '../fields/FieldId';
import type { Table } from '../Table';
import type { ViewId } from '../views/ViewId';

export type ViewSelectionCopyRangeType = 'columns' | 'rows' | undefined;
export type ViewSelectionCopyRange = readonly [number, number];

export type CreateViewSelectionCopyPlanParams = {
  readonly viewId: ViewId;
  readonly canCopyAsEditor?: boolean;
  readonly sharedView?: boolean;
  readonly ranges: ReadonlyArray<ViewSelectionCopyRange>;
  readonly type?: ViewSelectionCopyRangeType;
  readonly projection?: ReadonlyArray<FieldId>;
  readonly queryFieldIds?: ReadonlyArray<string>;
};

export type ViewSelectionCopyRecordWindow = {
  readonly offset: number;
  readonly limit?: number;
};

export class ViewSelectionCopyPlan {
  private constructor(
    readonly type: ViewSelectionCopyRangeType,
    readonly fields: ReadonlyArray<Field>,
    readonly searchFieldIds: ReadonlyArray<FieldId>,
    readonly recordWindows: ReadonlyArray<ViewSelectionCopyRecordWindow>,
    readonly requestedRowCount: number | undefined,
    readonly recordsIncluded: boolean
  ) {}

  static create(params: {
    type: ViewSelectionCopyRangeType;
    fields: ReadonlyArray<Field>;
    searchFieldIds: ReadonlyArray<FieldId>;
    recordWindows: ReadonlyArray<ViewSelectionCopyRecordWindow>;
    requestedRowCount?: number;
    recordsIncluded?: boolean;
  }): ViewSelectionCopyPlan {
    return new ViewSelectionCopyPlan(
      params.type,
      params.fields,
      params.searchFieldIds,
      params.recordWindows,
      params.requestedRowCount,
      params.recordsIncluded ?? true
    );
  }

  requestedCellCount(totalRows?: number): Result<number, DomainError> {
    const rowCount = this.type === 'columns' ? totalRows : this.requestedRowCount;
    if (rowCount == null) {
      return err(
        domainError.invariant({
          code: 'view_selection_copy.total_rows_required',
          message: 'Total rows are required for a column selection',
        })
      );
    }
    return ok(rowCount * this.fields.length);
  }
}

const validateRanges = (
  ranges: ReadonlyArray<ViewSelectionCopyRange>,
  type: ViewSelectionCopyRangeType
): Result<void, DomainError> => {
  const expectedLength = type ? undefined : 2;
  if (ranges.length === 0 || (expectedLength !== undefined && ranges.length !== expectedLength)) {
    return err(
      domainError.validation({
        code: 'view_selection_copy.invalid_ranges',
        message: type
          ? 'Row and column selections require at least one range'
          : 'Cell selections require exactly two coordinates',
      })
    );
  }

  for (const range of ranges) {
    const [start, end] = range;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < 0 ||
      (type !== undefined && start > end)
    ) {
      return err(
        domainError.validation({
          code: 'view_selection_copy.invalid_ranges',
          message: 'Selection ranges must contain ascending non-negative integer coordinates',
          details: { range },
        })
      );
    }
  }
  if (type === undefined && (ranges[0]![0] > ranges[1]![0] || ranges[0]![1] > ranges[1]![1])) {
    return err(
      domainError.validation({
        code: 'view_selection_copy.invalid_ranges',
        message: 'Cell selection coordinates must be ordered from top-left to bottom-right',
      })
    );
  }
  return ok(undefined);
};

const selectProjectedVisibleFields = (
  table: Table,
  visibleFieldIds: ReadonlyArray<FieldId>,
  projection: ReadonlyArray<FieldId> | undefined
): ReadonlyArray<Field> => {
  const visible = new Set(visibleFieldIds.map((fieldId) => fieldId.toString()));
  const requested = projection?.length ? projection : visibleFieldIds;
  const byId = new Map(table.getFields().map((field) => [field.id().toString(), field]));
  const selected: Field[] = [];
  const seen = new Set<string>();

  for (const fieldId of requested) {
    const id = fieldId.toString();
    if (!visible.has(id) || seen.has(id)) continue;
    const field = byId.get(id);
    if (!field) continue;
    seen.add(id);
    selected.push(field);
  }
  return selected;
};

/**
 * Build the immutable copy plan for a View owned by this Table.
 *
 * Share authorization, visible-field ordering, projection bounding and range semantics
 * belong to the aggregate. The query handler only executes the returned record windows.
 */
export function createViewSelectionCopyPlan(
  this: Table,
  params: CreateViewSelectionCopyPlanParams
): Result<ViewSelectionCopyPlan, DomainError> {
  return safeTry<ViewSelectionCopyPlan, DomainError>(
    function* (this: Table) {
      yield* validateRanges(params.ranges, params.type);
      const view = yield* this.getView(params.viewId);
      const requireShare = params.sharedView !== false;
      if (requireShare && (view.enableShare() !== true || !view.shareId())) {
        return err(
          domainError.forbidden({
            code: 'view_selection_copy.share_disabled',
            message: 'Shared view is disabled',
          })
        );
      }
      const shareMeta = view.shareMeta();
      if (requireShare && !shareMeta?.allowCopy && !params.canCopyAsEditor) {
        return err(
          domainError.forbidden({
            code: 'view_selection_copy.not_allowed',
            message: 'not allowed to copy',
          })
        );
      }
      const visibleFieldIds = yield* this.getOrderedVisibleFieldIds(params.viewId.toString(), {
        includeHiddenFields: requireShare ? shareMeta?.includeHiddenField === true : false,
      });
      const visibleFieldIdSet = new Set(visibleFieldIds.map((fieldId) => fieldId.toString()));
      for (const fieldId of params.queryFieldIds ?? []) {
        if (!visibleFieldIdSet.has(fieldId)) {
          return err(
            domainError.forbidden({
              code: 'view_selection_copy.query_field_hidden',
              message: 'Copy query references a field outside the shared View',
              details: { fieldId },
            })
          );
        }
      }
      const availableFields = selectProjectedVisibleFields(
        this,
        visibleFieldIds,
        params.projection
      );

      if (params.type === 'columns') {
        const fields = params.ranges.flatMap(([start, end]) =>
          availableFields.slice(start, end + 1)
        );
        return ok(
          ViewSelectionCopyPlan.create({
            type: params.type,
            fields,
            searchFieldIds: visibleFieldIds,
            recordWindows: [{ offset: 0 }],
            recordsIncluded: shareMeta?.includeRecords !== false,
          })
        );
      }

      if (params.type === 'rows') {
        const recordWindows = params.ranges.map(([start, end]) => ({
          offset: start,
          limit: end - start + 1,
        }));
        return ok(
          ViewSelectionCopyPlan.create({
            type: params.type,
            fields: availableFields,
            searchFieldIds: visibleFieldIds,
            recordWindows,
            requestedRowCount: recordWindows.reduce((total, window) => total + window.limit!, 0),
            recordsIncluded: shareMeta?.includeRecords !== false,
          })
        );
      }

      const [start, end] = params.ranges;
      const fields = availableFields.slice(start[0], end[0] + 1);
      return ok(
        ViewSelectionCopyPlan.create({
          type: undefined,
          fields,
          searchFieldIds: visibleFieldIds,
          recordWindows: [{ offset: start[1], limit: end[1] - start[1] + 1 }],
          requestedRowCount: end[1] - start[1] + 1,
          recordsIncluded: shareMeta?.includeRecords !== false,
        })
      );
    }.bind(this)
  );
}
