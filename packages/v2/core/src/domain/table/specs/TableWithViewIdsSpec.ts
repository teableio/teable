import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { ISpecification } from '../../shared/specification/ISpecification';
import type { Table } from '../Table';
import type { ViewId } from '../views/ViewId';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

/**
 * Narrows repository hydration to the requested View children without changing
 * which Table aggregate root matches the query.
 */
export class TableWithViewIdsSpec<V extends ITableSpecVisitor = ITableSpecVisitor>
  implements ISpecification<Table, V>
{
  private constructor(private readonly viewIdsValue: ReadonlyArray<ViewId>) {}

  static create(viewIds: ReadonlyArray<ViewId>): TableWithViewIdsSpec {
    return new TableWithViewIdsSpec([...viewIds]);
  }

  viewIds(): ReadonlyArray<ViewId> {
    return this.viewIdsValue;
  }

  isSatisfiedBy(_table: Table): boolean {
    return true;
  }

  mutate(table: Table): Result<Table, DomainError> {
    return ok(table);
  }

  accept(visitor: V): Result<void, DomainError> {
    return visitor.visitTableWithViewIds(this).map(() => undefined);
  }
}
