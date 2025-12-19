import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import type { RatingMax } from './RatingMax';

export class RatingField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly max: RatingMax
  ) {
    super(id, name, FieldType.rating());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    max: RatingMax;
  }): Result<RatingField, string> {
    return ok(new RatingField(params.id, params.name, params.max));
  }

  ratingMax(): RatingMax {
    return this.max;
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitRatingField(this);
  }
}
