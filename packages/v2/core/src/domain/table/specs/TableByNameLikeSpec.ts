import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ISpecification } from '../../shared/specification/ISpecification';
import type { Table } from '../Table';
import type { TableName } from '../TableName';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableByNameLikeSpec<V extends ITableSpecVisitor = ITableSpecVisitor>
  implements ISpecification<Table, V>
{
  private constructor(private readonly tableNameValue: TableName) {}

  static create(tableName: TableName): TableByNameLikeSpec {
    return new TableByNameLikeSpec(tableName);
  }

  tableName(): TableName {
    return this.tableNameValue;
  }

  isSatisfiedBy(t: Table): boolean {
    return t.name().toString().includes(this.tableNameValue.toString());
  }

  mutate(t: Table): Result<Table, string> {
    return ok(t);
  }

  accept(v: V): Result<void, string> {
    return v.visitTableByNameLike(this).map(() => undefined);
  }
}
