import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { ISpecification } from '../../shared/specification/ISpecification';
import type { FieldId } from '../fields/FieldId';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

/**
 * Narrows repository hydration to the requested Field children without changing
 * which Table aggregate root matches the query.
 */
export class TableWithFieldIdsSpec<V extends ITableSpecVisitor = ITableSpecVisitor>
  implements ISpecification<Table, V>
{
  private constructor(private readonly fieldIdsValue: ReadonlyArray<FieldId>) {}

  static create(fieldIds: ReadonlyArray<FieldId>): TableWithFieldIdsSpec {
    return new TableWithFieldIdsSpec([...fieldIds]);
  }

  fieldIds(): ReadonlyArray<FieldId> {
    return this.fieldIdsValue;
  }

  isSatisfiedBy(_table: Table): boolean {
    return true;
  }

  mutate(table: Table): Result<Table, DomainError> {
    return ok(table);
  }

  accept(visitor: V): Result<void, DomainError> {
    return visitor.visitTableWithFieldIds(this).map(() => undefined);
  }
}
