import { err, type Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import { Table } from '../Table';
import type { ITableBuildProps } from '../TableBuilder';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';
import type { ViewShareMetaValue } from '../views/ViewProperties';
import { CloneViewVisitor } from '../views/visitors/CloneViewVisitor';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableUpdateViewShareMetaSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly viewIdValue: ViewId,
    private readonly previousShareMetaValue: ViewShareMetaValue | undefined,
    private readonly nextShareMetaValue: ViewShareMetaValue | undefined
  ) {
    super();
  }

  static create(
    viewId: ViewId,
    previousShareMeta: ViewShareMetaValue | undefined,
    nextShareMeta: ViewShareMetaValue | undefined
  ): TableUpdateViewShareMetaSpec {
    return new TableUpdateViewShareMetaSpec(viewId, previousShareMeta, nextShareMeta);
  }

  viewId(): ViewId {
    return this.viewIdValue;
  }

  previousShareMeta(): ViewShareMetaValue | undefined {
    return this.previousShareMetaValue;
  }

  nextShareMeta(): ViewShareMetaValue | undefined {
    return this.nextShareMetaValue;
  }

  mutate(table: Table): Result<Table, DomainError> {
    const targetResult = table.getView(this.viewIdValue);
    if (targetResult.isErr()) return err(targetResult.error);

    const nextPropertiesResult = targetResult.value
      .properties()
      .withShareMeta(this.nextShareMetaValue);
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
    return Table.rehydrate(props);
  }

  accept(visitor: V): Result<void, DomainError> {
    return visitor.visitTableUpdateViewShareMeta(this).map(() => undefined);
  }
}
