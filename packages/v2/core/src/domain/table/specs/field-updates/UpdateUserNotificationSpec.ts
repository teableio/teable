import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { UserField } from '../../fields/types/UserField';
import type { UserNotification } from '../../fields/types/UserNotification';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a user field's notification setting.
 */
export class UpdateUserNotificationSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousNotificationValue: UserNotification,
    private readonly nextNotificationValue: UserNotification
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousNotification: UserNotification,
    nextNotification: UserNotification
  ): UpdateUserNotificationSpec {
    return new UpdateUserNotificationSpec(fieldId, previousNotification, nextNotification);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousNotification(): UserNotification {
    return this.previousNotificationValue;
  }

  nextNotification(): UserNotification {
    return this.nextNotificationValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof UserField)) {
      return err(domainError.validation({ message: 'Field is not a user field' }));
    }

    const updatedFieldResult = UserField.create({
      id: field.id(),
      name: field.name(),
      isMultiple: field.multiplicity(),
      shouldNotify: this.nextNotificationValue,
      defaultValue: field.defaultValue(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateUserNotification(this).map(() => undefined);
  }
}
