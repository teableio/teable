import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { SingleLineTextField } from '../../fields/types/SingleLineTextField';
import type { SingleLineTextShowAs } from '../../fields/types/SingleLineTextShowAs';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a single line text field's showAs property.
 */
export class UpdateSingleLineTextShowAsSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousShowAsValue: SingleLineTextShowAs | undefined,
    private readonly nextShowAsValue: SingleLineTextShowAs | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousShowAs: SingleLineTextShowAs | undefined,
    nextShowAs: SingleLineTextShowAs | undefined
  ): UpdateSingleLineTextShowAsSpec {
    return new UpdateSingleLineTextShowAsSpec(fieldId, previousShowAs, nextShowAs);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousShowAs(): SingleLineTextShowAs | undefined {
    return this.previousShowAsValue;
  }

  nextShowAs(): SingleLineTextShowAs | undefined {
    return this.nextShowAsValue;
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
      showAs: this.nextShowAsValue,
      defaultValue: field.defaultValue(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateSingleLineTextShowAs(this).map(() => undefined);
  }
}
