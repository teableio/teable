import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { AttachmentPublicAccess } from './AttachmentPublicAccess';

export class AttachmentField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly publicAccessValue: AttachmentPublicAccess
  ) {
    super(id, name, FieldType.attachment());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    isPublic?: AttachmentPublicAccess;
  }): Result<AttachmentField, DomainError> {
    return ok(
      new AttachmentField(
        params.id,
        params.name,
        params.isPublic ?? AttachmentPublicAccess.disabled()
      )
    );
  }

  publicAccess(): AttachmentPublicAccess {
    return this.publicAccessValue;
  }

  /** A copy starts private: publishing its files is for the user to confirm. */
  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    return AttachmentField.create({ id: params.newId, name: params.newName });
  }

  /** The same field renamed or replaced keeps publishing. */
  override withName(params: FieldDuplicateParams): Result<Field, DomainError> {
    return AttachmentField.create({
      id: params.newId,
      name: params.newName,
      isPublic: this.publicAccess(),
    });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitAttachmentField(this);
  }
}
