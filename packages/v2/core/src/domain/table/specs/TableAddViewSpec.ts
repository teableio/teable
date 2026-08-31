import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { Table } from '../Table';
import type { View } from '../views/View';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableAddViewSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(private readonly viewValue: View) {
    super();
  }

  static create(view: View): TableAddViewSpec {
    return new TableAddViewSpec(view);
  }

  view(): View {
    return this.viewValue;
  }

  mutate(table: Table): Result<Table, DomainError> {
    return table.addView(this.viewValue);
  }

  accept(visitor: V): Result<void, DomainError> {
    return visitor.visitTableAddView(this).map(() => undefined);
  }
}
