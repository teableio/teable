import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import type { FieldId } from '../fields/FieldId';
import type { TableViewColumnMetaUpdate } from '../specs/TableUpdateViewColumnMetaSpec';
import type { Table } from '../Table';
import type { TableUpdateResult } from '../TableMutator';
import {
  getDefaultViewColumnOrderByFieldId,
  type ViewColumnMeta,
  type ViewColumnMetaChange,
  type ViewColumnMetaPatch,
  type ViewColumnMetaValue,
} from '../views/ViewColumnMeta';
import type { ViewId } from '../views/ViewId';

export type UpdateViewColumnMetaMethodResult = {
  readonly viewId: ViewId;
  readonly previousColumnMeta: ViewColumnMeta;
  readonly nextColumnMeta: ViewColumnMeta;
  readonly changes: ReadonlyArray<ViewColumnMetaChange>;
  readonly previousOptions?: unknown;
  readonly nextOptions?: unknown;
  readonly updateResult?: TableUpdateResult;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const adjustFrozenFieldOptions = (params: {
  viewType: string;
  options: unknown;
  previousColumnMeta: ViewColumnMetaValue;
  nextColumnMeta: ViewColumnMetaValue;
  patchedFieldIds: ReadonlySet<string>;
}): unknown | undefined => {
  if (params.viewType !== 'grid' || !isRecord(params.options)) return undefined;
  const frozenFieldId = params.options.frozenFieldId;
  if (typeof frozenFieldId !== 'string' || !params.patchedFieldIds.has(frozenFieldId)) {
    return undefined;
  }

  const oldOrder = params.previousColumnMeta[frozenFieldId]?.order;
  const newOrder = params.nextColumnMeta[frozenFieldId]?.order;
  if (
    typeof oldOrder !== 'number' ||
    typeof newOrder !== 'number' ||
    Object.is(oldOrder, newOrder)
  ) {
    return undefined;
  }

  const originFieldIds = Object.keys(params.previousColumnMeta).sort((left, right) => {
    const leftOrder = params.previousColumnMeta[left]?.order;
    const rightOrder = params.previousColumnMeta[right]?.order;
    return (
      (typeof leftOrder === 'number' ? leftOrder : 0) -
      (typeof rightOrder === 'number' ? rightOrder : 0)
    );
  });
  const frozenIndex = originFieldIds.indexOf(frozenFieldId);
  const previousNeighborId = frozenIndex > 0 ? originFieldIds[frozenIndex - 1] : undefined;
  const nextOptions = { ...params.options };
  if (previousNeighborId) {
    nextOptions.frozenFieldId = previousNeighborId;
  } else {
    delete nextOptions.frozenFieldId;
  }
  return nextOptions;
};

const fieldNotFound = (table: Table, fieldIds: ReadonlyArray<FieldId>): DomainError =>
  domainError.notFound({
    code: 'field.not_found',
    message: `Fields ${fieldIds.map((fieldId) => fieldId.toString()).join(', ')} not found in table ${table
      .id()
      .toString()}`,
  });

export function updateViewColumnMeta(
  this: Table,
  viewId: ViewId,
  patches: ReadonlyArray<ViewColumnMetaPatch>
): Result<UpdateViewColumnMetaMethodResult, DomainError> {
  const table = this;
  return safeTry<UpdateViewColumnMetaMethodResult, DomainError>(function* () {
    const view = yield* table.getView(viewId);
    const missingFieldIds = patches
      .map(({ fieldId }) => fieldId)
      .filter((fieldId) => !table.getFields().some((field) => field.id().equals(fieldId)));
    if (missingFieldIds.length) {
      return err(fieldNotFound(table, missingFieldIds));
    }

    const hidesPrimaryField = patches.some(
      ({ fieldId, columnMeta }) =>
        fieldId.equals(table.primaryFieldId()) && columnMeta.hidden === true
    );
    const viewType = view.type().toString();
    if (hidesPrimaryField && viewType !== 'calendar' && viewType !== 'form') {
      return err(
        domainError.validation({
          code: 'view.primary_field_cannot_be_hidden',
          message: `Primary field can not be hidden for view type ${viewType}`,
        })
      );
    }

    const previousColumnMeta = yield* view.columnMeta();
    if (patches.length === 0) {
      return ok({
        viewId,
        previousColumnMeta,
        nextColumnMeta: previousColumnMeta,
        changes: [],
      });
    }

    const previousColumnMetaValue = previousColumnMeta.toDto();
    const defaultOrderByFieldId = getDefaultViewColumnOrderByFieldId(
      table.getFields(),
      table.primaryFieldId()
    );
    const patchesWithOrders = patches.map((patch) => {
      const fieldId = patch.fieldId.toString();
      const patchOrder = patch.columnMeta.order;
      const previousOrder = previousColumnMetaValue[fieldId]?.order;
      return {
        ...patch,
        columnMeta: {
          ...patch.columnMeta,
          order:
            typeof patchOrder === 'number'
              ? patchOrder
              : typeof previousOrder === 'number'
                ? previousOrder
                : defaultOrderByFieldId.get(fieldId)!,
        },
      };
    });
    const patchResult = yield* previousColumnMeta.applyPatches(patchesWithOrders);
    const previousOptions = view.options();
    const nextOptions = adjustFrozenFieldOptions({
      viewType,
      options: previousOptions,
      previousColumnMeta: previousColumnMeta.toDto(),
      nextColumnMeta: patchResult.columnMeta.toDto(),
      patchedFieldIds: new Set(patches.map(({ fieldId }) => fieldId.toString())),
    });
    if (patchResult.changes.length === 0 && nextOptions === undefined) {
      return ok({
        viewId,
        previousColumnMeta,
        nextColumnMeta: patchResult.columnMeta,
        changes: [],
      });
    }
    const update: TableViewColumnMetaUpdate = {
      viewId,
      fieldId: patches[0]!.fieldId,
      columnMeta: patchResult.columnMeta,
      changes: patchResult.changes,
      ...(nextOptions !== undefined ? { previousOptions, nextOptions, optionsChanged: true } : {}),
    };
    const updateResult = yield* table.update((mutator) => mutator.updateViewColumnMeta(update));

    return ok({
      viewId,
      previousColumnMeta,
      nextColumnMeta: patchResult.columnMeta,
      changes: patchResult.changes,
      ...(nextOptions !== undefined ? { previousOptions, nextOptions } : {}),
      updateResult,
    });
  });
}
