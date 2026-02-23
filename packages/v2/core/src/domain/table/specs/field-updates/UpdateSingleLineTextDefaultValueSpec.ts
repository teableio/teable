import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { SingleLineTextField } from '../../fields/types/SingleLineTextField';
import type { TextDefaultValue } from '../../fields/types/TextDefaultValue';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a single line text field's default value.
 */
export class UpdateSingleLineTextDefaultValueSpec<
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
  ): UpdateSingleLineTextDefaultValueSpec {
    return new UpdateSingleLineTextDefaultValueSpec(
      fieldId,
      previousDefaultValue,
      nextDefaultValue
    );
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
    if (!(field instanceof SingleLineTextField)) {
      return err(domainError.validation({ message: 'Field is not a single line text field' }));
    }

    const updatedFieldResult = SingleLineTextField.create({
      id: field.id(),
      name: field.name(),
      showAs: field.showAs(),
      defaultValue: this.nextDefaultValueValue,
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateSingleLineTextDefaultValue(this).map(() => undefined);
  }
}
