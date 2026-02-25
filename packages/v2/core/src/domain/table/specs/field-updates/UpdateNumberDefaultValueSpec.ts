import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { NumberField } from '../../fields/types/NumberField';
import type { NumberDefaultValue } from '../../fields/types/NumberDefaultValue';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a number field's default value.
 */
export class UpdateNumberDefaultValueSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousDefaultValueValue: NumberDefaultValue | undefined,
    private readonly nextDefaultValueValue: NumberDefaultValue | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousDefaultValue: NumberDefaultValue | undefined,
    nextDefaultValue: NumberDefaultValue | undefined
  ): UpdateNumberDefaultValueSpec {
    return new UpdateNumberDefaultValueSpec(fieldId, previousDefaultValue, nextDefaultValue);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousDefaultValue(): NumberDefaultValue | undefined {
    return this.previousDefaultValueValue;
  }

  nextDefaultValue(): NumberDefaultValue | undefined {
    return this.nextDefaultValueValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof NumberField)) {
      return err(domainError.validation({ message: 'Field is not a number field' }));
    }

    const updatedFieldResult = NumberField.create({
      id: field.id(),
      name: field.name(),
      formatting: field.formatting(),
      showAs: field.showAs(),
      defaultValue: this.nextDefaultValueValue,
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateNumberDefaultValue(this).map(() => undefined);
  }
}
