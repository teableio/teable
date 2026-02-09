import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';

export class AttachmentField extends Field {
  private constructor(id: FieldId, name: FieldName) {
    super(id, name, FieldType.attachment());
  }

  static create(params: { id: FieldId; name: FieldName }): Result<AttachmentField, DomainError> {
    return ok(new AttachmentField(params.id, params.name));
  }

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    return AttachmentField.create({ id: params.newId, name: params.newName });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitAttachmentField(this);
  }
}
