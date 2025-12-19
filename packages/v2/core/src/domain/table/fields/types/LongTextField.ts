import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';

export class LongTextField extends Field {
  private constructor(id: FieldId, name: FieldName) {
    super(id, name, FieldType.longText());
  }

  static create(params: { id: FieldId; name: FieldName }): Result<LongTextField, string> {
    return ok(new LongTextField(params.id, params.name));
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitLongTextField(this);
  }
}
