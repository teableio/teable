import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { ISpecification } from '../../shared/specification/ISpecification';
import type { Table } from '../Table';
import type { TableId } from '../TableId';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableByIdSpec<V extends ITableSpecVisitor = ITableSpecVisitor>
  implements ISpecification<Table, V>
{
  private constructor(private readonly tableIdValue: TableId) {}

  static create(tableId: TableId): TableByIdSpec {
    return new TableByIdSpec(tableId);
  }

  tableId(): TableId {
    return this.tableIdValue;
  }

  isSatisfiedBy(t: Table): boolean {
    return t.id().equals(this.tableIdValue);
  }

  mutate(t: Table): Result<Table, DomainError> {
    return ok(t);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableById(this).map(() => undefined);
  }
}
