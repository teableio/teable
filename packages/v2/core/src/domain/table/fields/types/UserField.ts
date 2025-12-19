import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';

export class UserField extends Field {
  private constructor(id: FieldId, name: FieldName) {
    super(id, name, FieldType.user());
  }

  static create(params: { id: FieldId; name: FieldName }): Result<UserField, string> {
    return ok(new UserField(params.id, params.name));
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitUserField(this);
  }
}
