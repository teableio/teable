import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { FieldId } from '../fields/FieldId';
import { LinkField } from '../fields/types/LinkField';
import { LinkFieldConfig } from '../fields/types/LinkFieldConfig';
import { UpdateLinkConfigSpec } from '../specs/field-updates/UpdateLinkConfigSpec';
import type { Table } from '../Table';
import type { TableId } from '../TableId';
import type { TableUpdateResult } from '../TableMutator';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';

export type ViewDeletionLinkDependency = {
  readonly foreignTableId: TableId;
  readonly symmetricFieldId: FieldId;
};

export type DeleteViewMethodResult = {
  readonly deletedView: View;
  readonly linkDependencies: ReadonlyArray<ViewDeletionLinkDependency>;
  readonly updateResult: TableUpdateResult;
};

export const deleteView = function (
  this: Table,
  viewId: ViewId
): Result<DeleteViewMethodResult, DomainError> {
  // Validate through the aggregate root first so the last-View invariant keeps
  // precedence over target lookup, matching the legacy transaction.
  const removalResult = this.removeView(viewId);
  if (removalResult.isErr()) return err(removalResult.error);

  const deletedViewResult = this.getView(viewId);
  if (deletedViewResult.isErr()) return err(deletedViewResult.error);

  const linkDependencies = this.getFields(
    (field): field is LinkField => field instanceof LinkField
  ).flatMap((field) => {
    const symmetricFieldId = field.symmetricFieldId();
    return symmetricFieldId
      ? [
          {
            foreignTableId: field.foreignTableId(),
            symmetricFieldId,
          },
        ]
      : [];
  });

  return this.update((mutator) => mutator.removeView(viewId)).map((updateResult) => ({
    deletedView: deletedViewResult.value,
    linkDependencies,
    updateResult,
  }));
};

export const clearViewFilterDependencies = function (
  this: Table,
  viewId: ViewId,
  fieldIds: ReadonlyArray<FieldId>
): Result<TableUpdateResult | undefined, DomainError> {
  const specs: UpdateLinkConfigSpec[] = [];

  for (const fieldId of fieldIds) {
    const fieldResult = this.getField((field) => field.id().equals(fieldId));
    if (fieldResult.isErr() || !(fieldResult.value instanceof LinkField)) continue;

    const field = fieldResult.value;
    const filterByViewId = field.filterByViewId();
    if (!filterByViewId || !filterByViewId.equals(viewId)) continue;

    const nextConfigResult = field
      .configDto()
      .andThen((config) => LinkFieldConfig.create({ ...config, filterByViewId: null }));
    if (nextConfigResult.isErr()) return err(nextConfigResult.error);

    specs.push(UpdateLinkConfigSpec.create(field.id(), field.config(), nextConfigResult.value));
  }

  if (specs.length === 0) return ok(undefined);
  return this.update((mutator) => mutator.applySpecs(specs)).map((result) => result);
};
