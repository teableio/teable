import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { RatingField } from '../../fields/types/RatingField';
import type { RatingColor } from '../../fields/types/RatingColor';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a rating field's color.
 */
export class UpdateRatingColorSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousColorValue: RatingColor,
    private readonly nextColorValue: RatingColor
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousColor: RatingColor,
    nextColor: RatingColor
  ): UpdateRatingColorSpec {
    return new UpdateRatingColorSpec(fieldId, previousColor, nextColor);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousColor(): RatingColor {
    return this.previousColorValue;
  }

  nextColor(): RatingColor {
    return this.nextColorValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof RatingField)) {
      return err(domainError.validation({ message: 'Field is not a rating field' }));
    }

    const updatedFieldResult = RatingField.create({
      id: field.id(),
      name: field.name(),
      max: field.ratingMax(),
      icon: field.ratingIcon(),
      color: this.nextColorValue,
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateRatingColor(this).map(() => undefined);
  }
}
