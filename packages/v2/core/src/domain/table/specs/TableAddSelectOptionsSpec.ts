import type { Result } from 'neverthrow';

import type { IDomainContext } from '../../shared/DomainContext';
import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../fields/FieldId';
import type { SelectOption } from '../fields/types/SelectOption';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableAddSelectOptionsSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly optionsValue: ReadonlyArray<SelectOption>,
    private readonly domainContextValue: IDomainContext | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    options: ReadonlyArray<SelectOption>,
    domainContext?: IDomainContext
  ): TableAddSelectOptionsSpec {
    return new TableAddSelectOptionsSpec(fieldId, options, domainContext);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  options(): ReadonlyArray<SelectOption> {
    return [...this.optionsValue];
  }

  mutate(t: Table): Result<Table, DomainError> {
    return t.addSelectOptions(this.fieldIdValue, this.optionsValue, this.domainContextValue);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableAddSelectOptions(this).map(() => undefined);
  }
}
