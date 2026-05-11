import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { ButtonField } from '../../fields/types/ButtonField';
import type { ButtonResetCount } from '../../fields/types/ButtonResetCount';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

export class UpdateButtonResetCountSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousResetCountValue: ButtonResetCount | undefined,
    private readonly nextResetCountValue: ButtonResetCount | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousResetCount: ButtonResetCount | undefined,
    nextResetCount: ButtonResetCount | undefined
  ): UpdateButtonResetCountSpec {
    return new UpdateButtonResetCountSpec(fieldId, previousResetCount, nextResetCount);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousResetCount(): ButtonResetCount | undefined {
    return this.previousResetCountValue;
  }

  nextResetCount(): ButtonResetCount | undefined {
    return this.nextResetCountValue;
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
      color: field.color(),
      maxCount: field.maxCount(),
      resetCount: this.nextResetCountValue,
      workflow: field.workflow(),
      confirm: field.confirm(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateButtonResetCount(this).map(() => undefined);
  }
}
