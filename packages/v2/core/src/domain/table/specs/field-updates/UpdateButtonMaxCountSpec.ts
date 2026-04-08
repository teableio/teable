import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { ButtonField } from '../../fields/types/ButtonField';
import type { ButtonMaxCount } from '../../fields/types/ButtonMaxCount';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a button field's max count.
 */
export class UpdateButtonMaxCountSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousMaxCountValue: ButtonMaxCount | undefined,
    private readonly nextMaxCountValue: ButtonMaxCount | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousMaxCount: ButtonMaxCount | undefined,
    nextMaxCount: ButtonMaxCount | undefined
  ): UpdateButtonMaxCountSpec {
    return new UpdateButtonMaxCountSpec(fieldId, previousMaxCount, nextMaxCount);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousMaxCount(): ButtonMaxCount | undefined {
    return this.previousMaxCountValue;
  }

  nextMaxCount(): ButtonMaxCount | undefined {
    return this.nextMaxCountValue;
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
      maxCount: this.nextMaxCountValue,
      resetCount: field.resetCount(),
      workflow: field.workflow(),
      confirm: field.confirm(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateButtonMaxCount(this).map(() => undefined);
  }
}
