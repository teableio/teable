import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { NumberField } from '../../fields/types/NumberField';
import type { NumberShowAs } from '../../fields/types/NumberShowAs';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a number field's showAs property.
 */
export class UpdateNumberShowAsSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousShowAsValue: NumberShowAs | undefined,
    private readonly nextShowAsValue: NumberShowAs | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousShowAs: NumberShowAs | undefined,
    nextShowAs: NumberShowAs | undefined
  ): UpdateNumberShowAsSpec {
    return new UpdateNumberShowAsSpec(fieldId, previousShowAs, nextShowAs);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousShowAs(): NumberShowAs | undefined {
    return this.previousShowAsValue;
  }

  nextShowAs(): NumberShowAs | undefined {
    return this.nextShowAsValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof NumberField)) {
      return err(domainError.validation({ message: 'Field is not a number field' }));
    }

    const updatedFieldResult = NumberField.create({
      id: field.id(),
      name: field.name(),
      formatting: field.formatting(),
      showAs: this.nextShowAsValue,
      defaultValue: field.defaultValue(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateNumberShowAs(this).map(() => undefined);
  }
}
