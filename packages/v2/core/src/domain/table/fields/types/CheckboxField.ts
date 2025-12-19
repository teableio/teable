import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';

export class CheckboxField extends Field {
  private constructor(id: FieldId, name: FieldName) {
    super(id, name, FieldType.checkbox());
  }

  static create(params: { id: FieldId; name: FieldName }): Result<CheckboxField, string> {
    return ok(new CheckboxField(params.id, params.name));
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitCheckboxField(this);
  }
}
