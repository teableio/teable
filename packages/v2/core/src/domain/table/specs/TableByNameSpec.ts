import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ISpecification } from '../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../shared/specification/ISpecVisitor';
import type { Table } from '../Table';
import type { TableName } from '../TableName';

export class TableByNameSpec<V extends ISpecVisitor = ISpecVisitor>
  implements ISpecification<Table, V>
{
  private constructor(private readonly tableNameValue: TableName) {}

  static create(tableName: TableName): TableByNameSpec {
    return new TableByNameSpec(tableName);
  }

  tableName(): TableName {
    return this.tableNameValue;
  }

  isSatisfiedBy(t: Table): boolean {
    return t.name().equals(this.tableNameValue);
  }

  mutate(t: Table): Result<Table, string> {
    return ok(t);
  }

  accept(v: V): Result<void, string> {
    return v.visit(this).map(() => undefined);
  }
}
