import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import { Table } from '../Table';
import type { ITableBuildProps } from '../TableBuilder';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';
import type { ViewName } from '../views/ViewName';
import { CloneViewVisitor } from '../views/visitors/CloneViewVisitor';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableRenameViewSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly viewIdValue: ViewId,
    private readonly previousNameValue: ViewName,
    private readonly nextNameValue: ViewName
  ) {
    super();
  }

  static create(viewId: ViewId, previousName: ViewName, nextName: ViewName): TableRenameViewSpec {
    return new TableRenameViewSpec(viewId, previousName, nextName);
  }

  viewId(): ViewId {
    return this.viewIdValue;
  }

  previousName(): ViewName {
    return this.previousNameValue;
  }

  nextName(): ViewName {
    return this.nextNameValue;
  }

  mutate(table: Table): Result<Table, DomainError> {
    const targetResult = table.getView(this.viewIdValue);
    if (targetResult.isErr()) return err(targetResult.error);

    if (
      table
        .views()
        .some(
          (view) => !view.id().equals(this.viewIdValue) && view.name().equals(this.nextNameValue)
        )
    ) {
      return err(domainError.conflict({ message: 'View names must be unique' }));
    }

    const nextViews: View[] = [];
    for (const view of table.views()) {
      if (!view.id().equals(this.viewIdValue)) {
        nextViews.push(view);
        continue;
      }

      const cloneResult = view.accept(new CloneViewVisitor({ name: this.nextNameValue }));
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

    const props: ITableBuildProps = {
      id: table.id(),
      baseId: table.baseId(),
      name: table.name(),
      properties: table.properties(),
      fields: table.getFields(),
      views: nextViews,
      primaryFieldId: table.primaryFieldId(),
    };
    const dbTableNameResult = table.dbTableName();
    if (dbTableNameResult.isOk()) props.dbTableName = dbTableNameResult.value;

    return Table.rehydrate(props).andThen((nextTable) => {
      const renamedView = nextTable.views().find((view) => view.id().equals(this.viewIdValue));
      if (!renamedView) {
        return err(
          domainError.invariant({
            message: `Renamed View missing from Table: ${this.viewIdValue.toString()}`,
          })
        );
      }
      return ok(nextTable);
    });
  }

  accept(visitor: V): Result<void, DomainError> {
    return visitor.visitTableRenameView(this).map(() => undefined);
  }
}
