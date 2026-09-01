import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { ISpecification } from '../../shared/specification/ISpecification';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

/**
 * Narrows repository hydration to the primary Field without changing
 * which Table aggregate root matches the query.
 */
export class TableWithPrimaryFieldSpec<V extends ITableSpecVisitor = ITableSpecVisitor>
  implements ISpecification<Table, V>
{
  static create(): TableWithPrimaryFieldSpec {
    return new TableWithPrimaryFieldSpec();
  }

  isSatisfiedBy(_table: Table): boolean {
    return true;
  }

  mutate(table: Table): Result<Table, DomainError> {
    return ok(table);
  }

  accept(visitor: V): Result<void, DomainError> {
    return visitor.visitTableWithPrimaryField(this).map(() => undefined);
  }
}
