import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { LongTextField } from '../../fields/types/LongTextField';
import type { LongTextShowAs } from '../../fields/types/LongTextShowAs';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a long text field's showAs property.
 */
export class UpdateLongTextShowAsSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousShowAsValue: LongTextShowAs | undefined,
    private readonly nextShowAsValue: LongTextShowAs | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousShowAs: LongTextShowAs | undefined,
    nextShowAs: LongTextShowAs | undefined
  ): UpdateLongTextShowAsSpec {
    return new UpdateLongTextShowAsSpec(fieldId, previousShowAs, nextShowAs);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousShowAs(): LongTextShowAs | undefined {
    return this.previousShowAsValue;
  }

  nextShowAs(): LongTextShowAs | undefined {
    return this.nextShowAsValue;
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
      showAs: this.nextShowAsValue,
      defaultValue: field.defaultValue(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateLongTextShowAs(this).map(() => undefined);
  }
}
