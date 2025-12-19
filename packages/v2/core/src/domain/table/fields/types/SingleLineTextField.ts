import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';

export class SingleLineTextField extends Field {
  private constructor(id: FieldId, name: FieldName) {
    super(id, name, FieldType.singleLineText());
  }

  static create(params: { id: FieldId; name: FieldName }): Result<SingleLineTextField, string> {
    return ok(new SingleLineTextField(params.id, params.name));
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitSingleLineTextField(this);
  }
}
