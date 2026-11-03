import type { Result } from 'neverthrow';

import type { IDomainContext } from '../../shared/DomainContext';
import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { Field } from '../fields/Field';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableAddFieldsSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldsValue: ReadonlyArray<Field>,
    private readonly options?: {
      domainContext?: IDomainContext;
    }
  ) {
    super();
  }

  static create(
    fields: ReadonlyArray<Field>,
    options?: {
      domainContext?: IDomainContext;
    }
  ): TableAddFieldsSpec {
    return new TableAddFieldsSpec([...fields], options);
  }

  fields(): ReadonlyArray<Field> {
    return [...this.fieldsValue];
  }

  mutate(t: Table): Result<Table, DomainError> {
    return t.addFields(this.fieldsValue, {
      domainContext: this.options?.domainContext,
    });
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableAddFields(this).map(() => undefined);
  }
}
