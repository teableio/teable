import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import { Table } from '../Table';
import type { ITableBuildProps } from '../TableBuilder';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';
import type { ViewOrder } from '../views/ViewOrder';
import { CloneViewVisitor } from '../views/visitors/CloneViewVisitor';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export type TableViewOrderChange = {
  readonly viewId: ViewId;
  readonly previousOrder: ViewOrder;
  readonly nextOrder: ViewOrder;
};

export class TableUpdateViewOrderSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(private readonly changesValue: ReadonlyArray<TableViewOrderChange>) {
    super();
  }

  static create(changes: ReadonlyArray<TableViewOrderChange>): TableUpdateViewOrderSpec {
    return new TableUpdateViewOrderSpec([...changes]);
  }

  changes(): ReadonlyArray<TableViewOrderChange> {
    return [...this.changesValue];
  }

  mutate(table: Table): Result<Table, DomainError> {
    let views = [...table.views()];

    for (const change of this.changesValue) {
      const targetIndex = views.findIndex((view) => view.id().equals(change.viewId));
      if (targetIndex === -1) {
        return err(
          domainError.notFound({
            code: 'view.not_found',
            message: `View not found: ${change.viewId.toString()}`,
          })
        );
      }

      const source = views[targetIndex]!;
      const cloneResult = source.accept(new CloneViewVisitor({ order: change.nextOrder }));
      if (cloneResult.isErr()) return err(cloneResult.error);
      const clone = cloneResult.value;

      const columnMetaResult = source.columnMeta();
      if (columnMetaResult.isErr()) return err(columnMetaResult.error);
      const setColumnMetaResult = clone.setColumnMeta(columnMetaResult.value);
      if (setColumnMetaResult.isErr()) return err(setColumnMetaResult.error);

      const queryDefaultsResult = source.queryDefaults();
      if (queryDefaultsResult.isErr()) return err(queryDefaultsResult.error);
      const setQueryDefaultsResult = clone.setQueryDefaults(queryDefaultsResult.value);
      if (setQueryDefaultsResult.isErr()) return err(setQueryDefaultsResult.error);

      const auditMetadataResult = source.auditMetadata();
      if (auditMetadataResult.isOk()) {
        const setAuditMetadataResult = clone.setAuditMetadata(auditMetadataResult.value);
        if (setAuditMetadataResult.isErr()) return err(setAuditMetadataResult.error);
      }

      views[targetIndex] = clone;
    }

    const orderedViews: Array<{ view: View; order: number }> = [];
    for (const view of views) {
      const orderResult = view.order();
      if (orderResult.isErr()) return err(orderResult.error);
      orderedViews.push({ view, order: orderResult.value.toNumber() });
    }
    orderedViews.sort((left, right) => left.order - right.order);
    views = orderedViews.map(({ view }) => view);

    const props: ITableBuildProps = {
      id: table.id(),
      baseId: table.baseId(),
      name: table.name(),
      properties: table.properties(),
      fields: table.getFields(),
      views: views as ReadonlyArray<View>,
      primaryFieldId: table.primaryFieldId(),
    };
    const dbTableNameResult = table.dbTableName();
    if (dbTableNameResult.isOk()) props.dbTableName = dbTableNameResult.value;
    return Table.rehydrate(props);
  }

  accept(visitor: V): Result<void, DomainError> {
    return visitor.visitTableUpdateViewOrder(this).map(() => undefined);
  }
}
