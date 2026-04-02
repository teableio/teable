import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { ButtonField } from '../../fields/types/ButtonField';
import type { FieldColor } from '../../fields/types/FieldColor';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a button field's color.
 */
export class UpdateButtonColorSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousColorValue: FieldColor,
    private readonly nextColorValue: FieldColor
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousColor: FieldColor,
    nextColor: FieldColor
  ): UpdateButtonColorSpec {
    return new UpdateButtonColorSpec(fieldId, previousColor, nextColor);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousColor(): FieldColor {
    return this.previousColorValue;
  }

  nextColor(): FieldColor {
    return this.nextColorValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof ButtonField)) {
      return err(domainError.validation({ message: 'Field is not a button field' }));
    }

    const updatedFieldResult = ButtonField.create({
      id: field.id(),
      name: field.name(),
      label: field.label(),
      color: this.nextColorValue,
      maxCount: field.maxCount(),
      resetCount: field.resetCount(),
      workflow: field.workflow(),
      confirm: field.confirm(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateButtonColor(this).map(() => undefined);
  }
}
