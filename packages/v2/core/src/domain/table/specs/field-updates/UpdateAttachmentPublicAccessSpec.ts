import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { AttachmentField } from '../../fields/types/AttachmentField';
import type { AttachmentPublicAccess } from '../../fields/types/AttachmentPublicAccess';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for switching public links on or off for an attachment field.
 */
export class UpdateAttachmentPublicAccessSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousPublicAccessValue: AttachmentPublicAccess,
    private readonly nextPublicAccessValue: AttachmentPublicAccess
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousPublicAccess: AttachmentPublicAccess,
    nextPublicAccess: AttachmentPublicAccess
  ): UpdateAttachmentPublicAccessSpec {
    return new UpdateAttachmentPublicAccessSpec(fieldId, previousPublicAccess, nextPublicAccess);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousPublicAccess(): AttachmentPublicAccess {
    return this.previousPublicAccessValue;
  }

  nextPublicAccess(): AttachmentPublicAccess {
    return this.nextPublicAccessValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof AttachmentField)) {
      return err(domainError.validation({ message: 'Field is not an attachment field' }));
    }

    const updatedFieldResult = AttachmentField.create({
      id: field.id(),
      name: field.name(),
      isPublic: this.nextPublicAccessValue,
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);
    const updatedField = updatedFieldResult.value;

    // the rebuilt field keeps what the switch does not touch
    const keptResult = updatedField
      .setDescription(field.description())
      .andThen(() => updatedField.setAiConfig(field.aiConfig()))
      .andThen(() => updatedField.setNotNull(field.notNull()))
      .andThen(() => updatedField.setUnique(field.unique()));
    if (keptResult.isErr()) return err(keptResult.error);

    return t.replaceField(this.fieldIdValue, updatedField);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateAttachmentPublicAccess(this).map(() => undefined);
  }
}
