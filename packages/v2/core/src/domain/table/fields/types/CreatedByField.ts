import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { FieldComputed } from './FieldComputed';

export class CreatedByField extends Field {
  private constructor(id: FieldId, name: FieldName) {
    super(id, name, FieldType.createdBy(), undefined, [], FieldComputed.computed());
  }

  static create(params: { id: FieldId; name: FieldName }): Result<CreatedByField, string> {
    return ok(new CreatedByField(params.id, params.name));
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitCreatedByField(this);
  }
}
