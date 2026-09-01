import { err, ok, safeTry, type Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { FieldId } from '../fields/FieldId';
import { FieldType } from '../fields/FieldType';
import type { Table } from '../Table';
import type { TableUpdateResult } from '../TableMutator';
import type { View } from '../views/View';
import { ViewGroup, viewGroupDtoFromQueryDefaults, type ViewGroupDTO } from '../views/ViewGroup';
import type { ViewId } from '../views/ViewId';
import { ViewQueryDefaults } from '../views/ViewQueryDefaults';

export type UpdateViewGroupMethodResult = {
  readonly view: View;
  readonly previousGroup: ViewGroupDTO;
  readonly nextGroup: ViewGroupDTO;
  readonly previousQueryDefaults: ViewQueryDefaults;
  readonly nextQueryDefaults: ViewQueryDefaults;
  readonly updateResult?: TableUpdateResult;
};

const validateGroupFields = (table: Table, group: ViewGroupDTO): Result<void, DomainError> => {
  if (group === null) return ok(undefined);

  for (const item of group) {
    const fieldId = FieldId.create(item.fieldId);
    if (fieldId.isErr()) return err(fieldId.error);
    const field = table.getField((candidate) => candidate.id().equals(fieldId.value));
    if (field.isErr()) {
      return err(
        domainError.notFound({
          code: 'field.not_found',
          message: `Group field ${item.fieldId} not found in table ${table.id().toString()}`,
        })
      );
    }
    if (field.value.type().equals(FieldType.button())) {
      return err(
        domainError.validation({
          code: 'view.group_unsupported_field_type',
          message: `Group field ${item.fieldId} has unsupported Button type`,
        })
      );
    }
  }
  return ok(undefined);
};

export function updateViewGroup(
  this: Table,
  viewId: ViewId,
  rawGroup: unknown
): Result<UpdateViewGroupMethodResult, DomainError> {
  const table = this;
  return safeTry<UpdateViewGroupMethodResult, DomainError>(function* () {
    const view = yield* table.getView(viewId);
    const group = yield* ViewGroup.create(rawGroup);
    const nextGroup = group.toDto();
    yield* validateGroupFields(table, nextGroup);

    const previousQueryDefaults = yield* view.queryDefaults();
    const previousGroup = viewGroupDtoFromQueryDefaults(previousQueryDefaults);
    const { group: _previousGroup, ...preservedDefaults } = previousQueryDefaults.toDto();
    const nextQueryDefaults = yield* ViewQueryDefaults.rehydrate(
      nextGroup === null
        ? preservedDefaults
        : {
            ...preservedDefaults,
            group: nextGroup,
          },
      { sourceFilter: previousQueryDefaults.sourceFilter() }
    );

    if (previousQueryDefaults.equals(nextQueryDefaults)) {
      return ok({
        view,
        previousGroup,
        nextGroup,
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
      previousGroup,
      nextGroup,
      previousQueryDefaults,
      nextQueryDefaults,
      updateResult,
    });
  });
}
