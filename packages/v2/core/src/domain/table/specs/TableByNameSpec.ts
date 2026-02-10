import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { ISpecification } from '../../shared/specification/ISpecification';
import type { Table } from '../Table';
import type { TableName } from '../TableName';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableByNameSpec<V extends ITableSpecVisitor = ITableSpecVisitor>
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

  mutate(t: Table): Result<Table, DomainError> {
    return t.rename(this.tableNameValue);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableByName(this).map(() => undefined);
  }
}
