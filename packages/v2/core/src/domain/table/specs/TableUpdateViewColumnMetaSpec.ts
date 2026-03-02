import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../fields/FieldId';
import { Table } from '../Table';
import type { View } from '../views/View';
import { ViewColumnMeta } from '../views/ViewColumnMeta';
import type { ViewId } from '../views/ViewId';
import { CloneViewVisitor } from '../views/visitors/CloneViewVisitor';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export type TableViewColumnMetaUpdate = {
  viewId: ViewId;
  fieldId: FieldId;
  columnMeta: ViewColumnMeta;
};

export class TableUpdateViewColumnMetaSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(private readonly updatesValue: ReadonlyArray<TableViewColumnMetaUpdate>) {
    super();
  }

  static create(updates: ReadonlyArray<TableViewColumnMetaUpdate>): TableUpdateViewColumnMetaSpec {
    return new TableUpdateViewColumnMetaSpec(updates);
  }

  static fromTableWithFieldId(
    table: Table,
    fieldId: FieldId
  ): Result<TableUpdateViewColumnMetaSpec, DomainError> {
    const updatesResult = table
      .views()
      .reduce<
        Result<ReadonlyArray<TableViewColumnMetaUpdate>, DomainError>
      >((acc, view) => acc.andThen((updates) => view.columnMeta().map((columnMeta) => [...updates, { viewId: view.id(), fieldId, columnMeta }])), ok([]));

    return updatesResult.map((updates) => new TableUpdateViewColumnMetaSpec(updates));
  }

  static forDuplicatePlacement(params: {
    table: Table;
    sourceFieldId: FieldId;
    newFieldId: FieldId;
    targetViewId: ViewId;
  }): Result<TableUpdateViewColumnMetaSpec, DomainError> {
    const { table, sourceFieldId, newFieldId, targetViewId } = params;

    const updatesResult = table
      .views()
      .reduce<Result<ReadonlyArray<TableViewColumnMetaUpdate>, DomainError>>(
        (acc, view) =>
          acc.andThen((updates) =>
            view.columnMeta().andThen((columnMeta) => {
              if (!view.id().equals(targetViewId)) {
                return ok([...updates, { viewId: view.id(), fieldId: newFieldId, columnMeta }]);
              }

              const sourceOrder = columnMeta.toDto()[sourceFieldId.toString()]?.order;
              if (typeof sourceOrder !== 'number') {
                return ok([...updates, { viewId: view.id(), fieldId: newFieldId, columnMeta }]);
              }

              const raw = columnMeta.toDto();
              const newFieldKey = newFieldId.toString();
              const nextGreater = Object.entries(raw)
                .filter(([key, value]) => key !== newFieldKey && typeof value?.order === 'number')
                .map(([, value]) => value.order as number)
                .filter((order) => order > sourceOrder)
                .sort((a, b) => a - b)[0];

              const targetOrder =
                nextGreater !== undefined ? (sourceOrder + nextGreater) / 2 : sourceOrder + 1;

              const nextMetaResult = ViewColumnMeta.create({
                ...raw,
                [newFieldKey]: {
                  ...(raw[newFieldKey] ?? {}),
                  order: targetOrder,
                },
              });
              return nextMetaResult.map((nextMeta) => [
                ...updates,
                {
                  viewId: view.id(),
                  fieldId: newFieldId,
                  columnMeta: nextMeta,
                },
              ]);
            })
          ),
        ok([])
      );

    return updatesResult.map((updates) => new TableUpdateViewColumnMetaSpec(updates));
  }

  updates(): ReadonlyArray<TableViewColumnMetaUpdate> {
    return this.updatesValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    if (this.updatesValue.length === 0) {
      return ok(t);
    }

    const updatesByViewId = new Map<string, ViewColumnMeta>();
    for (const update of this.updatesValue) {
      updatesByViewId.set(update.viewId.toString(), update.columnMeta);
    }

    const nextViews: View[] = [];
    for (const view of t.views()) {
      const nextColumnMeta = updatesByViewId.get(view.id().toString());
      if (!nextColumnMeta) {
        nextViews.push(view);
        continue;
      }

      const cloneResult = view.accept(new CloneViewVisitor());
      if (cloneResult.isErr()) {
        return err(cloneResult.error);
      }

      const clone = cloneResult.value;
      const setColumnMetaResult = clone.setColumnMeta(nextColumnMeta);
      if (setColumnMetaResult.isErr()) {
        return err(setColumnMetaResult.error);
      }

      const queryDefaultsResult = view.queryDefaults();
      if (queryDefaultsResult.isErr()) {
        return err(queryDefaultsResult.error);
      }

      const setQueryDefaultsResult = clone.setQueryDefaults(queryDefaultsResult.value);
      if (setQueryDefaultsResult.isErr()) {
        return err(setQueryDefaultsResult.error);
      }

      nextViews.push(clone);
    }

    const nextTableResult = Table.rehydrate({
      id: t.id(),
      baseId: t.baseId(),
      name: t.name(),
      fields: t.getFields(),
      views: nextViews,
      primaryFieldId: t.primaryFieldId(),
    });
    if (nextTableResult.isErr()) {
      return nextTableResult;
    }

    const dbTableNameResult = t.dbTableName();
    if (dbTableNameResult.isErr()) {
      return ok(nextTableResult.value);
    }

    const setDbTableNameResult = nextTableResult.value.setDbTableName(dbTableNameResult.value);
    if (setDbTableNameResult.isErr()) {
      return err(setDbTableNameResult.error);
    }

    return ok(nextTableResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableUpdateViewColumnMeta(this).map(() => undefined);
  }
}
