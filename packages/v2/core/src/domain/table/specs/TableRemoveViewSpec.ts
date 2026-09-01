import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { Table } from '../Table';
import type { View } from '../views/View';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableRemoveViewSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(private readonly viewValue: View) {
    super();
  }

  static create(view: View): TableRemoveViewSpec {
    return new TableRemoveViewSpec(view);
  }

  view(): View {
    return this.viewValue;
  }

  mutate(table: Table): Result<Table, DomainError> {
    return table.removeView(this.viewValue.id());
  }

  accept(visitor: V): Result<void, DomainError> {
    return visitor.visitTableRemoveView(this).map(() => undefined);
  }
}
