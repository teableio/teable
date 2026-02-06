import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { Field } from '../fields/Field';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableAddFieldSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(private readonly fieldValue: Field) {
    super();
  }

  static create(field: Field): TableAddFieldSpec {
    return new TableAddFieldSpec(field);
  }

  field(): Field {
    return this.fieldValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    return t.addField(this.fieldValue);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableAddField(this).map(() => undefined);
  }
}
