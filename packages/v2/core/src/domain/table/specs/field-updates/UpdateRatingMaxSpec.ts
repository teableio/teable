import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { DbFieldName } from '../../fields/DbFieldName';
import type { FieldId } from '../../fields/FieldId';
import { RatingField } from '../../fields/types/RatingField';
import type { RatingMax } from '../../fields/types/RatingMax';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a rating field's max value.
 */
export class UpdateRatingMaxSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly dbFieldNameValue: DbFieldName,
    private readonly previousMaxValue: RatingMax,
    private readonly nextMaxValue: RatingMax
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    dbFieldName: DbFieldName,
    previousMax: RatingMax,
    nextMax: RatingMax
  ): UpdateRatingMaxSpec {
    return new UpdateRatingMaxSpec(fieldId, dbFieldName, previousMax, nextMax);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  dbFieldName(): DbFieldName {
    return this.dbFieldNameValue;
  }

  previousMax(): RatingMax {
    return this.previousMaxValue;
  }

  nextMax(): RatingMax {
    return this.nextMaxValue;
  }

  /**
   * Check if max is being reduced (requires clamping values)
   */
  isMaxReducing(): boolean {
    return this.nextMaxValue.toNumber() < this.previousMaxValue.toNumber();
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
      max: this.nextMaxValue,
      icon: field.ratingIcon(),
      color: field.ratingColor(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateRatingMax(this).map(() => undefined);
  }
}
