import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { MultipleSelectField } from '../../fields/types/MultipleSelectField';
import type { SelectDefaultValue } from '../../fields/types/SelectDefaultValue';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a multiple select field's default value.
 */
export class UpdateMultipleSelectDefaultValueSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousDefaultValueValue: SelectDefaultValue | undefined,
    private readonly nextDefaultValueValue: SelectDefaultValue | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousDefaultValue: SelectDefaultValue | undefined,
    nextDefaultValue: SelectDefaultValue | undefined
  ): UpdateMultipleSelectDefaultValueSpec {
    return new UpdateMultipleSelectDefaultValueSpec(
      fieldId,
      previousDefaultValue,
      nextDefaultValue
    );
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousDefaultValue(): SelectDefaultValue | undefined {
    return this.previousDefaultValueValue;
  }

  nextDefaultValue(): SelectDefaultValue | undefined {
    return this.nextDefaultValueValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof MultipleSelectField)) {
      return err(domainError.validation({ message: 'Field is not a multiple select field' }));
    }

    const updatedFieldResult = MultipleSelectField.create({
      id: field.id(),
      name: field.name(),
      options: field.selectOptions(),
      defaultValue: this.nextDefaultValueValue,
      preventAutoNewOptions: field.preventAutoNewOptions(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateMultipleSelectDefaultValue(this).map(() => undefined);
  }
}
