import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';

export class ButtonField extends Field {
  private constructor(id: FieldId, name: FieldName) {
    super(id, name, FieldType.button());
  }

  static create(params: { id: FieldId; name: FieldName }): Result<ButtonField, string> {
    return ok(new ButtonField(params.id, params.name));
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitButtonField(this);
  }
}
