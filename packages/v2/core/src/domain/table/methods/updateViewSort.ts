import { err, ok, safeTry, type Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { FieldId } from '../fields/FieldId';
import { FieldType } from '../fields/FieldType';
import type { Table } from '../Table';
import type { TableUpdateResult } from '../TableMutator';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';
import { ViewQueryDefaults } from '../views/ViewQueryDefaults';
import { ViewSort, viewSortDtoFromQueryDefaults, type ViewSortDTO } from '../views/ViewSort';

export type UpdateViewSortMethodResult = {
  readonly view: View;
  readonly previousSort: ViewSortDTO;
  readonly nextSort: ViewSortDTO;
  readonly previousQueryDefaults: ViewQueryDefaults;
  readonly nextQueryDefaults: ViewQueryDefaults;
  readonly updateResult?: TableUpdateResult;
};

const validateSortFields = (table: Table, sort: ViewSortDTO): Result<void, DomainError> => {
  if (sort === null) return ok(undefined);

  for (const item of sort.sortObjs) {
    const fieldId = FieldId.create(item.fieldId);
    if (fieldId.isErr()) return err(fieldId.error);
    const field = table.getField((candidate) => candidate.id().equals(fieldId.value));
    if (field.isErr()) {
      return err(
        domainError.notFound({
          code: 'field.not_found',
          message: `Sort field ${item.fieldId} not found in table ${table.id().toString()}`,
        })
      );
    }
    if (field.value.type().equals(FieldType.button())) {
      return err(
        domainError.validation({
          code: 'view.sort_unsupported_field_type',
          message: `Sort field ${item.fieldId} has unsupported Button type`,
        })
      );
    }
  }
  return ok(undefined);
};

export function updateViewSort(
  this: Table,
  viewId: ViewId,
  rawSort: unknown
): Result<UpdateViewSortMethodResult, DomainError> {
  const table = this;
  return safeTry<UpdateViewSortMethodResult, DomainError>(function* () {
    const view = yield* table.getView(viewId);
    const sort = yield* ViewSort.create(rawSort);
    const nextSort = sort.toDto();
    yield* validateSortFields(table, nextSort);

    const previousQueryDefaults = yield* view.queryDefaults();
    const previousSort = viewSortDtoFromQueryDefaults(previousQueryDefaults);
    const {
      sort: _previousSort,
      manualSort: _previousManualSort,
      ...preservedDefaults
    } = previousQueryDefaults.toDto();
    const nextQueryDefaults = yield* ViewQueryDefaults.rehydrate(
      nextSort === null
        ? preservedDefaults
        : {
            ...preservedDefaults,
            sort: nextSort.sortObjs,
            ...(nextSort.manualSort !== undefined ? { manualSort: nextSort.manualSort } : {}),
          },
      { sourceFilter: previousQueryDefaults.sourceFilter() }
    );

    if (previousQueryDefaults.equals(nextQueryDefaults)) {
      return ok({
        view,
        previousSort,
        nextSort,
        previousQueryDefaults,
        nextQueryDefaults,
      });
    }

    const updateResult = yield* table.update((mutator) =>
      mutator.updateViewQueryDefaults({
        viewId,
        previousQueryDefaults,
        queryDefaults: nextQueryDefaults,
      })
    );
    const nextView = yield* updateResult.table.getView(viewId);
    return ok({
      view: nextView,
      previousSort,
      nextSort,
      previousQueryDefaults,
      nextQueryDefaults,
      updateResult,
    });
  });
}
