import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { FieldId } from '../fields/FieldId';
import { TableUpdateViewQueryDefaultsSpec } from '../specs/TableUpdateViewQueryDefaultsSpec';
import type { Table } from '../Table';
import type { TableUpdateResult } from '../TableMutator';
import type { View } from '../views/View';
import type { ViewColumnMetaChange, ViewColumnMetaValue } from '../views/ViewColumnMeta';

const jsonEquals = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const buildColumnMetaChanges = (
  fieldIdByValue: ReadonlyMap<string, FieldId>,
  previous: ViewColumnMetaValue,
  next: ViewColumnMetaValue
): ReadonlyArray<ViewColumnMetaChange> => {
  const changes: ViewColumnMetaChange[] = [];
  for (const fieldId of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const typedFieldId = fieldIdByValue.get(fieldId);
    if (!typedFieldId || jsonEquals(previous[fieldId], next[fieldId])) continue;
    changes.push({
      fieldId: typedFieldId,
      ...(previous[fieldId] !== undefined ? { previousColumnMeta: previous[fieldId] } : {}),
      nextColumnMeta: next[fieldId] ?? {},
    });
  }
  return changes;
};

export type ApplyViewSnapshotMethodResult = {
  readonly updateResult?: TableUpdateResult;
};

export const applyViewSnapshot = function (
  this: Table,
  snapshotView: View
): Result<ApplyViewSnapshotMethodResult, DomainError> {
  const table = this;
  return safeTry<ApplyViewSnapshotMethodResult, DomainError>(function* () {
    const currentResult = table.getView(snapshotView.id());
    if (currentResult.isErr()) {
      const updateResult = yield* table.update((mutator) => mutator.addView(snapshotView));
      return ok({ updateResult });
    }

    const current = currentResult.value;
    const previousMeta = yield* current.columnMeta();
    const nextMeta = yield* snapshotView.columnMeta();
    const previousQuery = yield* current.queryDefaults();
    const nextQuery = yield* snapshotView.queryDefaults();
    const previousOrder = current.order();
    const nextOrder = snapshotView.order();
    const fieldIdByValue = new Map(
      table.getFields().map((field) => [field.id().toString(), field.id()] as const)
    );
    const changes = buildColumnMetaChanges(fieldIdByValue, previousMeta.toDto(), nextMeta.toDto());
    const optionsChanged = !jsonEquals(current.options(), snapshotView.options());
    const shareMetaChanged = !jsonEquals(current.shareMeta(), snapshotView.shareMeta());
    const queryChanged =
      !previousQuery.equals(nextQuery) ||
      !jsonEquals(previousQuery.sourceFilter(), nextQuery.sourceFilter());
    const orderChanged =
      previousOrder.isOk() && nextOrder.isOk() && !previousOrder.value.equals(nextOrder.value);

    const hasChanges =
      !current.name().equals(snapshotView.name()) ||
      current.description() !== snapshotView.description() ||
      current.isLocked() !== snapshotView.isLocked() ||
      changes.length > 0 ||
      optionsChanged ||
      shareMetaChanged ||
      queryChanged ||
      orderChanged;
    if (!hasChanges) return ok({});

    const updateResult = yield* table.update((mutator) => {
      if (!current.name().equals(snapshotView.name())) {
        mutator.renameView(snapshotView.id(), snapshotView.name());
      }
      if (current.description() !== snapshotView.description()) {
        mutator.updateViewDescription(snapshotView.id(), snapshotView.description());
      }
      if (current.isLocked() !== snapshotView.isLocked()) {
        mutator.updateViewLocked(snapshotView.id(), snapshotView.isLocked());
      }
      if (shareMetaChanged) {
        mutator.updateViewShareMeta(snapshotView.id(), snapshotView.shareMeta());
      }
      if (changes.length > 0 || optionsChanged) {
        mutator.updateViewColumnMeta({
          viewId: snapshotView.id(),
          fieldId: changes[0]?.fieldId ?? table.primaryFieldId(),
          columnMeta: nextMeta,
          changes,
          ...(optionsChanged
            ? {
                previousOptions: current.options(),
                nextOptions: snapshotView.options(),
                optionsChanged: true,
              }
            : {}),
        });
      }
      if (queryChanged) {
        mutator.applySpecs([
          TableUpdateViewQueryDefaultsSpec.create([
            {
              viewId: snapshotView.id(),
              previousQueryDefaults: previousQuery,
              queryDefaults: nextQuery,
            },
          ]),
        ]);
      }
      if (orderChanged && previousOrder.isOk() && nextOrder.isOk()) {
        mutator.updateViewOrder([
          {
            viewId: snapshotView.id(),
            previousOrder: previousOrder.value,
            nextOrder: nextOrder.value,
          },
        ]);
      }
      return mutator;
    });

    return ok({ updateResult });
  });
};
