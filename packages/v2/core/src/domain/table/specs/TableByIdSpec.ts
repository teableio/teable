import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ISpecification } from '../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../shared/specification/ISpecVisitor';
import type { Table } from '../Table';
import type { TableId } from '../TableId';

export class TableByIdSpec<V extends ISpecVisitor = ISpecVisitor>
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

  mutate(t: Table): Result<Table, string> {
    return ok(t);
  }

  accept(v: V): Result<void, string> {
    return v.visit(this).map(() => undefined);
  }
}
