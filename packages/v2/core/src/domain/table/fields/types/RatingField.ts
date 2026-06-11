import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { RatingColor } from './RatingColor';
import { RatingIcon } from './RatingIcon';
import { RatingMax } from './RatingMax';

export class RatingField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly maxValue: RatingMax,
    private readonly iconValue: RatingIcon,
    private readonly colorValue: RatingColor
  ) {
    super(id, name, FieldType.rating());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    max?: RatingMax;
    icon?: RatingIcon;
    color?: RatingColor;
  }): Result<RatingField, DomainError> {
    return ok(
      new RatingField(
        params.id,
        params.name,
        params.max ?? RatingMax.five(),
        params.icon ?? RatingIcon.star(),
        params.color ?? RatingColor.yellowBright()
      )
    );
  }

  ratingMax(): RatingMax {
    return this.maxValue;
  }

  ratingIcon(): RatingIcon {
    return this.iconValue;
  }

  ratingColor(): RatingColor {
    return this.colorValue;
  }

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    return RatingField.create({
      id: params.newId,
      name: params.newName,
      max: this.ratingMax(),
      icon: this.ratingIcon(),
      color: this.ratingColor(),
    });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitRatingField(this);
  }
}
