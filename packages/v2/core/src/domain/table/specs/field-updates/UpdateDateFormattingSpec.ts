import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { DateField } from '../../fields/types/DateField';
import type { DateTimeFormatting } from '../../fields/types/DateTimeFormatting';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a date field's formatting.
 */
export class UpdateDateFormattingSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousFormattingValue: DateTimeFormatting,
    private readonly nextFormattingValue: DateTimeFormatting
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousFormatting: DateTimeFormatting,
    nextFormatting: DateTimeFormatting
  ): UpdateDateFormattingSpec {
    return new UpdateDateFormattingSpec(fieldId, previousFormatting, nextFormatting);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousFormatting(): DateTimeFormatting {
    return this.previousFormattingValue;
  }

  nextFormatting(): DateTimeFormatting {
    return this.nextFormattingValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof DateField)) {
      return err(domainError.validation({ message: 'Field is not a date field' }));
    }

    const updatedFieldResult = DateField.create({
      id: field.id(),
      name: field.name(),
      formatting: this.nextFormattingValue,
      defaultValue: field.defaultValue(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateDateFormatting(this).map(() => undefined);
  }
}
