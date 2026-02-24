import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { NumberField } from '../../fields/types/NumberField';
import type { NumberFormatting } from '../../fields/types/NumberFormatting';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a number field's formatting.
 */
export class UpdateNumberFormattingSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousFormattingValue: NumberFormatting,
    private readonly nextFormattingValue: NumberFormatting
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousFormatting: NumberFormatting,
    nextFormatting: NumberFormatting
  ): UpdateNumberFormattingSpec {
    return new UpdateNumberFormattingSpec(fieldId, previousFormatting, nextFormatting);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousFormatting(): NumberFormatting {
    return this.previousFormattingValue;
  }

  nextFormatting(): NumberFormatting {
    return this.nextFormattingValue;
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
      formatting: this.nextFormattingValue,
      showAs: field.showAs(),
      defaultValue: field.defaultValue(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateNumberFormatting(this).map(() => undefined);
  }
}
