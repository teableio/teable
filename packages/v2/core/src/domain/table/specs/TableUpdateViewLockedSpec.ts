import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import { Table } from '../Table';
import type { ITableBuildProps } from '../TableBuilder';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';
import { CloneViewVisitor } from '../views/visitors/CloneViewVisitor';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableUpdateViewLockedSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly viewIdValue: ViewId,
    private readonly previousIsLockedValue: boolean | undefined,
    private readonly nextIsLockedValue: boolean | undefined
  ) {
    super();
  }

  static create(
    viewId: ViewId,
    previousIsLocked: boolean | undefined,
    nextIsLocked: boolean | undefined
  ): TableUpdateViewLockedSpec {
    return new TableUpdateViewLockedSpec(viewId, previousIsLocked, nextIsLocked);
  }

  viewId(): ViewId {
    return this.viewIdValue;
  }

  previousIsLocked(): boolean | undefined {
    return this.previousIsLockedValue;
  }

  nextIsLocked(): boolean | undefined {
    return this.nextIsLockedValue;
  }

  mutate(table: Table): Result<Table, DomainError> {
    const targetResult = table.getView(this.viewIdValue);
    if (targetResult.isErr()) return err(targetResult.error);

    const nextPropertiesResult = targetResult.value.properties().withLocked(this.nextIsLockedValue);
    if (nextPropertiesResult.isErr()) return err(nextPropertiesResult.error);

    const nextViews: View[] = [];
    for (const view of table.views()) {
      if (!view.id().equals(this.viewIdValue)) {
        nextViews.push(view);
        continue;
      }

      const cloneResult = view.accept(
        new CloneViewVisitor({ properties: nextPropertiesResult.value })
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
      const updatedView = nextTable.views().find((view) => view.id().equals(this.viewIdValue));
      if (!updatedView) {
        return err(
          domainError.invariant({
            message: `Updated View missing from Table: ${this.viewIdValue.toString()}`,
          })
        );
      }
      return ok(nextTable);
    });
  }

  accept(visitor: V): Result<void, DomainError> {
    return visitor.visitTableUpdateViewLocked(this).map(() => undefined);
  }
}
