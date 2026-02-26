import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { DateField } from '../../fields/types/DateField';
import type { DateDefaultValue } from '../../fields/types/DateDefaultValue';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a date field's default value.
 */
export class UpdateDateDefaultValueSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousDefaultValueValue: DateDefaultValue | undefined,
    private readonly nextDefaultValueValue: DateDefaultValue | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousDefaultValue: DateDefaultValue | undefined,
    nextDefaultValue: DateDefaultValue | undefined
  ): UpdateDateDefaultValueSpec {
    return new UpdateDateDefaultValueSpec(fieldId, previousDefaultValue, nextDefaultValue);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousDefaultValue(): DateDefaultValue | undefined {
    return this.previousDefaultValueValue;
  }

  nextDefaultValue(): DateDefaultValue | undefined {
    return this.nextDefaultValueValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof DateField)) {
      return err(domainError.validation({ message: 'Field is not a date field' }));
    }

    const updatedFieldResult = DateField.create({
      id: field.id(),
      name: field.name(),
      formatting: field.formatting(),
      defaultValue: this.nextDefaultValueValue,
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateDateDefaultValue(this).map(() => undefined);
  }
}
