import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { CheckboxField } from '../../fields/types/CheckboxField';
import type { CheckboxDefaultValue } from '../../fields/types/CheckboxDefaultValue';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a checkbox field's default value.
 */
export class UpdateCheckboxDefaultValueSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousDefaultValueValue: CheckboxDefaultValue | undefined,
    private readonly nextDefaultValueValue: CheckboxDefaultValue | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousDefaultValue: CheckboxDefaultValue | undefined,
    nextDefaultValue: CheckboxDefaultValue | undefined
  ): UpdateCheckboxDefaultValueSpec {
    return new UpdateCheckboxDefaultValueSpec(fieldId, previousDefaultValue, nextDefaultValue);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousDefaultValue(): CheckboxDefaultValue | undefined {
    return this.previousDefaultValueValue;
  }

  nextDefaultValue(): CheckboxDefaultValue | undefined {
    return this.nextDefaultValueValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof CheckboxField)) {
      return err(domainError.validation({ message: 'Field is not a checkbox field' }));
    }

    const updatedFieldResult = CheckboxField.create({
      id: field.id(),
      name: field.name(),
      defaultValue: this.nextDefaultValueValue,
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateCheckboxDefaultValue(this).map(() => undefined);
  }
}
