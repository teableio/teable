import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../fields/FieldId';
import { Table } from '../Table';
import type { View } from '../views/View';
import {
  keepPrimaryFieldVisible,
  ViewColumnMeta,
  type ViewColumnMetaChange,
} from '../views/ViewColumnMeta';
import type { ViewId } from '../views/ViewId';
import { CloneViewVisitor } from '../views/visitors/CloneViewVisitor';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export type TableViewColumnMetaUpdate = {
  viewId: ViewId;
  fieldId: FieldId;
  columnMeta: ViewColumnMeta;
  changes?: ReadonlyArray<ViewColumnMetaChange>;
  previousOptions?: unknown;
  nextOptions?: unknown;
  optionsChanged?: boolean;
};

// Every producer builds this spec through `create(table, updates)`, so the persisted
// payload and the mutated aggregate both carry invariant-preserving metadata.

export class TableUpdateViewColumnMetaSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(private readonly updatesValue: ReadonlyArray<TableViewColumnMetaUpdate>) {
    super();
  }

  static create(
    table: Table,
    updates: ReadonlyArray<TableViewColumnMetaUpdate>
  ): TableUpdateViewColumnMetaSpec {
    return new TableUpdateViewColumnMetaSpec(
      updates.map((update) => TableUpdateViewColumnMetaSpec.normalizeUpdate(table, update))
    );
  }

  /**
   * A gallery primary column is never hidden in persisted metadata. The value object
   * owns the rule; this method only applies it to the payload and to the reported
   * changes so events and rows stay identical.
   */
  private static normalizeUpdate(
    table: Table,
    update: TableViewColumnMetaUpdate
  ): TableViewColumnMetaUpdate {
    const view = table.getView(update.viewId);
    if (view.isErr()) return update;

    const viewType = view.value.type();
    const primaryFieldId = table.primaryFieldId();
    const columnMeta = update.columnMeta.withPrimaryFieldVisible(viewType, primaryFieldId);
    const changes = update.changes
      ?.map((change) =>
        change.fieldId.equals(primaryFieldId)
          ? { ...change, nextColumnMeta: keepPrimaryFieldVisible(viewType, change.nextColumnMeta) }
          : change
      )
      .filter(
        (change) =>
          JSON.stringify(change.previousColumnMeta) !== JSON.stringify(change.nextColumnMeta)
      );

    return { ...update, columnMeta, ...(changes ? { changes } : {}) };
  }

  static fromTableWithFieldId(
    table: Table,
    fieldId: FieldId
  ): Result<TableUpdateViewColumnMetaSpec, DomainError> {
    return this.fromTableWithFieldIds(table, [fieldId]);
  }

  static forFieldPlacement(params: {
    table: Table;
    fieldId: FieldId;
    targetViewId: ViewId;
    order: number;
  }): Result<TableUpdateViewColumnMetaSpec, DomainError> {
    const { table, fieldId, targetViewId, order } = params;

    return this.fromTableWithFieldId(table, fieldId).andThen((spec) => {
      const fieldKey = fieldId.toString();
      const updatesResult = spec.updates().reduce<Result<TableViewColumnMetaUpdate[], DomainError>>(
        (acc, update) =>
          acc.andThen((updates) => {
            if (!update.viewId.equals(targetViewId)) {
              return ok([...updates, update]);
            }

            return ViewColumnMeta.create({
              ...update.columnMeta.toDto(),
              [fieldKey]: {
                ...update.columnMeta.toDto()[fieldKey],
                order,
              },
            }).map((columnMeta) => [
              ...updates,
              {
                ...update,
                columnMeta,
              },
            ]);
          }),
        ok([])
      );

      return updatesResult.map((updates) => this.create(table, updates));
    });
  }

  static fromTableWithFieldIds(
    table: Table,
    fieldIds: ReadonlyArray<FieldId>
  ): Result<TableUpdateViewColumnMetaSpec, DomainError> {
    if (fieldIds.length === 0) {
      return ok(new TableUpdateViewColumnMetaSpec([]));
    }

    const updatesResult = table
      .views()
      .reduce<Result<ReadonlyArray<TableViewColumnMetaUpdate>, DomainError>>(
        (acc, view) =>
          acc.andThen((updates) =>
            view.columnMeta().map((columnMeta) => [
              ...updates,
              ...fieldIds.map((fieldId) => ({
                viewId: view.id(),
                fieldId,
                columnMeta,
              })),
            ])
          ),
        ok([])
      );

    return updatesResult.map((updates) => this.create(table, updates));
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
                  ...raw[newFieldKey],
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

    return updatesResult.map((updates) => this.create(table, updates));
  }

  updates(): ReadonlyArray<TableViewColumnMetaUpdate> {
    return this.updatesValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    if (this.updatesValue.length === 0) {
      return ok(t);
    }

    const updatesByViewId = new Map<string, TableViewColumnMetaUpdate>();
    for (const update of this.updatesValue) {
      updatesByViewId.set(update.viewId.toString(), update);
    }

    const nextViews: View[] = [];
    for (const view of t.views()) {
      const update = updatesByViewId.get(view.id().toString());
      if (!update) {
        nextViews.push(view);
        continue;
      }

      const cloneResult = view.accept(
        new CloneViewVisitor(update.optionsChanged ? { options: update.nextOptions } : undefined)
      );
      if (cloneResult.isErr()) {
        return err(cloneResult.error);
      }

      const clone = cloneResult.value;
      const setColumnMetaResult = clone.setColumnMeta(update.columnMeta);
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

      const auditMetadataResult = view.auditMetadata();
      if (auditMetadataResult.isOk()) {
        const setAuditMetadataResult = clone.setAuditMetadata(auditMetadataResult.value);
        if (setAuditMetadataResult.isErr()) {
          return err(setAuditMetadataResult.error);
        }
      }

      nextViews.push(clone);
    }

    const dbTableNameResult = t.dbTableName();
    return Table.rehydrate({
      id: t.id(),
      baseId: t.baseId(),
      name: t.name(),
      properties: t.properties(),
      fields: t.getFields(),
      views: nextViews,
      primaryFieldId: t.primaryFieldId(),
      searchIndex: t.searchIndex(),
      dbTableName: dbTableNameResult.isOk() ? dbTableNameResult.value : undefined,
    });
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableUpdateViewColumnMeta(this).map(() => undefined);
  }
}
