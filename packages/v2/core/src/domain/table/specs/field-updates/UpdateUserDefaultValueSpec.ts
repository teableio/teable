import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { UserField } from '../../fields/types/UserField';
import type { UserDefaultValue } from '../../fields/types/UserDefaultValue';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a user field's default value.
 */
export class UpdateUserDefaultValueSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousDefaultValueValue: UserDefaultValue | undefined,
    private readonly nextDefaultValueValue: UserDefaultValue | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousDefaultValue: UserDefaultValue | undefined,
    nextDefaultValue: UserDefaultValue | undefined
  ): UpdateUserDefaultValueSpec {
    return new UpdateUserDefaultValueSpec(fieldId, previousDefaultValue, nextDefaultValue);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousDefaultValue(): UserDefaultValue | undefined {
    return this.previousDefaultValueValue;
  }

  nextDefaultValue(): UserDefaultValue | undefined {
    return this.nextDefaultValueValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof UserField)) {
      return err(domainError.validation({ message: 'Field is not a user field' }));
    }

    const updatedFieldResult = UserField.create({
      id: field.id(),
      name: field.name(),
      isMultiple: field.multiplicity(),
      shouldNotify: field.notification(),
      defaultValue: this.nextDefaultValueValue,
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateUserDefaultValue(this).map(() => undefined);
  }
}
