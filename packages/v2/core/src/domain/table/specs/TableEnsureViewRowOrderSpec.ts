import { ok, type Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { Table } from '../Table';
import type { View } from '../views/View';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

/**
 * Declares that an existing aggregate-owned Grid View needs physical row-order
 * storage. The specification does not add or mutate the View itself.
 */
export class TableEnsureViewRowOrderSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(private readonly viewValue: View) {
    super();
  }

  static create(view: View): TableEnsureViewRowOrderSpec {
    return new TableEnsureViewRowOrderSpec(view);
  }

  view(): View {
    return this.viewValue;
  }

  mutate(table: Table): Result<Table, DomainError> {
    return ok(table);
  }

  accept(visitor: V): Result<void, DomainError> {
    return visitor.visitTableEnsureViewRowOrder(this).map(() => undefined);
  }
}
