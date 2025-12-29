import type { Result } from 'neverthrow';

import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { Field } from '../fields/Field';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableRemoveFieldSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(private readonly fieldValue: Field) {
    super();
  }

  static create(field: Field): TableRemoveFieldSpec {
    return new TableRemoveFieldSpec(field);
  }

  field(): Field {
    return this.fieldValue;
  }

  mutate(t: Table): Result<Table, string> {
    return t.removeField(this.fieldValue.id());
  }

  accept(v: V): Result<void, string> {
    return v.visitTableRemoveField(this).map(() => undefined);
  }
}
