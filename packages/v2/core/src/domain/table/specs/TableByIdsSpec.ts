import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { ISpecification } from '../../shared/specification/ISpecification';
import type { Table } from '../Table';
import type { TableId } from '../TableId';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableByIdsSpec<V extends ITableSpecVisitor = ITableSpecVisitor>
  implements ISpecification<Table, V>
{
  private constructor(private readonly tableIdsValue: ReadonlyArray<TableId>) {}

  static create(tableIds: ReadonlyArray<TableId>): TableByIdsSpec {
    // TODO: unique tableIds
    return new TableByIdsSpec([...tableIds]);
  }

  tableIds(): ReadonlyArray<TableId> {
    return [...this.tableIdsValue];
  }

  isSatisfiedBy(t: Table): boolean {
    return this.tableIdsValue.some((id) => id.equals(t.id()));
  }

  mutate(t: Table): Result<Table, DomainError> {
    return ok(t);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableByIds(this).map(() => undefined);
  }
}
