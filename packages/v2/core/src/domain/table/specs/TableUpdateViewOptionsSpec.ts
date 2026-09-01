import { err, ok, type Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import { Table } from '../Table';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';
import { CloneViewVisitor } from '../views/visitors/CloneViewVisitor';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export type TableViewOptionsUpdate = {
  readonly viewId: ViewId;
  readonly previousOptions: unknown;
  readonly nextOptions: unknown;
};

export class TableUpdateViewOptionsSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(private readonly updateValue: TableViewOptionsUpdate) {
    super();
  }

  static create(update: TableViewOptionsUpdate): TableUpdateViewOptionsSpec {
    return new TableUpdateViewOptionsSpec(update);
  }

  update(): TableViewOptionsUpdate {
    return this.updateValue;
  }

  mutate(table: Table): Result<Table, DomainError> {
    const nextViews: View[] = [];
    let found = false;

    for (const view of table.views()) {
      if (!view.id().equals(this.updateValue.viewId)) {
        nextViews.push(view);
        continue;
      }
      found = true;
      const cloneResult = view.accept(
        new CloneViewVisitor({ options: this.updateValue.nextOptions })
      );
      if (cloneResult.isErr()) return err(cloneResult.error);
      const clone = cloneResult.value;

      const columnMetaResult = view.columnMeta();
      if (columnMetaResult.isErr()) return err(columnMetaResult.error);
      const setColumnMetaResult = clone.setColumnMeta(columnMetaResult.value);
      if (setColumnMetaResult.isErr()) return err(setColumnMetaResult.error);

      const queryDefaultsResult = view.queryDefaults();
      if (queryDefaultsResult.isErr()) return err(queryDefaultsResult.error);
      const setQueryDefaultsResult = clone.setQueryDefaults(queryDefaultsResult.value);
      if (setQueryDefaultsResult.isErr()) return err(setQueryDefaultsResult.error);

      const auditMetadataResult = view.auditMetadata();
      if (auditMetadataResult.isOk()) {
        const setAuditMetadataResult = clone.setAuditMetadata(auditMetadataResult.value);
        if (setAuditMetadataResult.isErr()) return err(setAuditMetadataResult.error);
      }
      nextViews.push(clone);
    }

    if (!found) return ok(table);
    const nextTableResult = Table.rehydrate({
      id: table.id(),
      baseId: table.baseId(),
      name: table.name(),
      properties: table.properties(),
      fields: table.getFields(),
      views: nextViews,
      primaryFieldId: table.primaryFieldId(),
    });
    if (nextTableResult.isErr()) return nextTableResult;

    const dbTableNameResult = table.dbTableName();
    if (dbTableNameResult.isErr()) return ok(nextTableResult.value);
    return nextTableResult.value
      .setDbTableName(dbTableNameResult.value)
      .map(() => nextTableResult.value);
  }

  accept(visitor: V): Result<void, DomainError> {
    return visitor.visitTableUpdateViewOptions(this).map(() => undefined);
  }
}
