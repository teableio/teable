import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { ButtonField } from '../../fields/types/ButtonField';
import type { ButtonLabel } from '../../fields/types/ButtonLabel';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a button field's label.
 */
export class UpdateButtonLabelSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousLabelValue: ButtonLabel,
    private readonly nextLabelValue: ButtonLabel
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousLabel: ButtonLabel,
    nextLabel: ButtonLabel
  ): UpdateButtonLabelSpec {
    return new UpdateButtonLabelSpec(fieldId, previousLabel, nextLabel);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousLabel(): ButtonLabel {
    return this.previousLabelValue;
  }

  nextLabel(): ButtonLabel {
    return this.nextLabelValue;
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
      label: this.nextLabelValue,
      color: field.color(),
      maxCount: field.maxCount(),
      resetCount: field.resetCount(),
      workflow: field.workflow(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateButtonLabel(this).map(() => undefined);
  }
}
