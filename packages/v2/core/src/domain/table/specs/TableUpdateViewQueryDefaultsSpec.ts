import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { Table } from '../Table';
import type { ViewId } from '../views/ViewId';
import type { ViewQueryDefaults } from '../views/ViewQueryDefaults';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export type TableViewQueryDefaultsUpdate = {
  viewId: ViewId;
  queryDefaults: ViewQueryDefaults;
};

export class TableUpdateViewQueryDefaultsSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(private readonly updatesValue: ReadonlyArray<TableViewQueryDefaultsUpdate>) {
    super();
  }

  static create(
    updates: ReadonlyArray<TableViewQueryDefaultsUpdate>
  ): TableUpdateViewQueryDefaultsSpec {
    return new TableUpdateViewQueryDefaultsSpec(updates);
  }

  updates(): ReadonlyArray<TableViewQueryDefaultsUpdate> {
    return this.updatesValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    return ok(t);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableUpdateViewQueryDefaults(this).map(() => undefined);
  }
}
