import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { LongTextField } from '../../fields/types/LongTextField';
import type { TextDefaultValue } from '../../fields/types/TextDefaultValue';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a long text field's default value.
 */
export class UpdateLongTextDefaultValueSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousDefaultValueValue: TextDefaultValue | undefined,
    private readonly nextDefaultValueValue: TextDefaultValue | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousDefaultValue: TextDefaultValue | undefined,
    nextDefaultValue: TextDefaultValue | undefined
  ): UpdateLongTextDefaultValueSpec {
    return new UpdateLongTextDefaultValueSpec(fieldId, previousDefaultValue, nextDefaultValue);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousDefaultValue(): TextDefaultValue | undefined {
    return this.previousDefaultValueValue;
  }

  nextDefaultValue(): TextDefaultValue | undefined {
    return this.nextDefaultValueValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof LongTextField)) {
      return err(domainError.validation({ message: 'Field is not a long text field' }));
    }

    const updatedFieldResult = LongTextField.create({
      id: field.id(),
      name: field.name(),
      defaultValue: this.nextDefaultValueValue,
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateLongTextDefaultValue(this).map(() => undefined);
  }
}
