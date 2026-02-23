import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { RatingField } from '../../fields/types/RatingField';
import type { RatingIcon } from '../../fields/types/RatingIcon';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a rating field's icon.
 */
export class UpdateRatingIconSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousIconValue: RatingIcon,
    private readonly nextIconValue: RatingIcon
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousIcon: RatingIcon,
    nextIcon: RatingIcon
  ): UpdateRatingIconSpec {
    return new UpdateRatingIconSpec(fieldId, previousIcon, nextIcon);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousIcon(): RatingIcon {
    return this.previousIconValue;
  }

  nextIcon(): RatingIcon {
    return this.nextIconValue;
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
      icon: this.nextIconValue,
      color: field.ratingColor(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateRatingIcon(this).map(() => undefined);
  }
}
