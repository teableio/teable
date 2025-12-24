import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { Table } from '../Table';
import type { ViewColumnMeta } from '../views/ViewColumnMeta';
import type { ViewId } from '../views/ViewId';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export type TableViewColumnMetaUpdate = {
  viewId: ViewId;
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

  static fromTable(table: Table): Result<TableUpdateViewColumnMetaSpec, string> {
    const updatesResult = table
      .views()
      .reduce<
        Result<ReadonlyArray<TableViewColumnMetaUpdate>, string>
      >((acc, view) => acc.andThen((updates) => view.columnMeta().map((columnMeta) => [...updates, { viewId: view.id(), columnMeta }])), ok([]));

    return updatesResult.map((updates) => new TableUpdateViewColumnMetaSpec(updates));
  }

  updates(): ReadonlyArray<TableViewColumnMetaUpdate> {
    return this.updatesValue;
  }

  mutate(t: Table): Result<Table, string> {
    return ok(t);
  }

  accept(v: V): Result<void, string> {
    return v.visitTableUpdateViewColumnMeta(this).map(() => undefined);
  }
}
