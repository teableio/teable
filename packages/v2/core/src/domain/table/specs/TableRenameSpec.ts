import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { Table } from '../Table';
import type { TableName } from '../TableName';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableRenameSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly previousNameValue: TableName,
    private readonly nextNameValue: TableName
  ) {
    super();
  }

  static create(previousName: TableName, nextName: TableName): TableRenameSpec {
    return new TableRenameSpec(previousName, nextName);
  }

  previousName(): TableName {
    return this.previousNameValue;
  }

  nextName(): TableName {
    return this.nextNameValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    return t.rename(this.nextNameValue);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableRename(this).map(() => undefined);
  }
}
