import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { DbFieldName } from '../../fields/DbFieldName';
import type { FieldId } from '../../fields/FieldId';
import { UserField } from '../../fields/types/UserField';
import type { UserMultiplicity } from '../../fields/types/UserMultiplicity';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a user field's multiplicity (single vs multiple).
 */
export class UpdateUserMultiplicitySpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly dbFieldNameValue: DbFieldName,
    private readonly previousMultiplicityValue: UserMultiplicity,
    private readonly nextMultiplicityValue: UserMultiplicity
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    dbFieldName: DbFieldName,
    previousMultiplicity: UserMultiplicity,
    nextMultiplicity: UserMultiplicity
  ): UpdateUserMultiplicitySpec {
    return new UpdateUserMultiplicitySpec(
      fieldId,
      dbFieldName,
      previousMultiplicity,
      nextMultiplicity
    );
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  dbFieldName(): DbFieldName {
    return this.dbFieldNameValue;
  }

  previousMultiplicity(): UserMultiplicity {
    return this.previousMultiplicityValue;
  }

  nextMultiplicity(): UserMultiplicity {
    return this.nextMultiplicityValue;
  }

  /**
   * Check if changing from multiple to single (requires extracting first element)
   */
  isMultipleToSingle(): boolean {
    return this.previousMultiplicityValue.toBoolean() && !this.nextMultiplicityValue.toBoolean();
  }

  /**
   * Check if changing from single to multiple (requires wrapping in array)
   */
  isSingleToMultiple(): boolean {
    return !this.previousMultiplicityValue.toBoolean() && this.nextMultiplicityValue.toBoolean();
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
      isMultiple: this.nextMultiplicityValue,
      shouldNotify: field.notification(),
      defaultValue: field.defaultValue(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateUserMultiplicity(this).map(() => undefined);
  }
}
