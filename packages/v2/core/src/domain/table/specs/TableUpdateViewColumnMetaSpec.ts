import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../fields/FieldId';
import type { Table } from '../Table';
import type { ViewColumnMeta } from '../views/ViewColumnMeta';
import type { ViewId } from '../views/ViewId';
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

  updates(): ReadonlyArray<TableViewColumnMetaUpdate> {
    return this.updatesValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    return ok(t);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableUpdateViewColumnMeta(this).map(() => undefined);
  }
}
