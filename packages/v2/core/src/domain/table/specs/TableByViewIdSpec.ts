import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { ISpecification } from '../../shared/specification/ISpecification';
import type { Table } from '../Table';
import type { ViewId } from '../views/ViewId';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

/**
 * Selects a Table that contains the requested View and allows repository
 * adapters to hydrate only that child View.
 */
export class TableByViewIdSpec<V extends ITableSpecVisitor = ITableSpecVisitor>
  implements ISpecification<Table, V>
{
  private constructor(private readonly viewIdValue: ViewId) {}

  static create(viewId: ViewId): TableByViewIdSpec {
    return new TableByViewIdSpec(viewId);
  }

  viewId(): ViewId {
    return this.viewIdValue;
  }

  isSatisfiedBy(table: Table): boolean {
    return table.getView(this.viewIdValue).isOk();
  }

  mutate(table: Table): Result<Table, DomainError> {
    return ok(table);
  }

  accept(visitor: V): Result<void, DomainError> {
    return visitor.visitTableByViewId(this).map(() => undefined);
  }
}
