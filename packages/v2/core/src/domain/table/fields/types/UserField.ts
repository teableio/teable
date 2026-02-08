import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import type { UserDefaultValue } from './UserDefaultValue';
import { UserMultiplicity } from './UserMultiplicity';
import { UserNotification } from './UserNotification';

export class UserField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly multiplicityValue: UserMultiplicity,
    private readonly notificationValue: UserNotification,
    private readonly defaultValueValue: UserDefaultValue | undefined
  ) {
    super(id, name, FieldType.user());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    isMultiple?: UserMultiplicity;
    shouldNotify?: UserNotification;
    defaultValue?: UserDefaultValue;
  }): Result<UserField, DomainError> {
    return ok(
      new UserField(
        params.id,
        params.name,
        params.isMultiple ?? UserMultiplicity.single(),
        params.shouldNotify ?? UserNotification.enabled(),
        params.defaultValue
      )
    );
  }

  multiplicity(): UserMultiplicity {
    return this.multiplicityValue;
  }

  notification(): UserNotification {
    return this.notificationValue;
  }

  defaultValue(): UserDefaultValue | undefined {
    return this.defaultValueValue;
  }

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    return UserField.create({
      id: params.newId,
      name: params.newName,
      isMultiple: this.multiplicity(),
      shouldNotify: this.notification(),
      defaultValue: this.defaultValue(),
    });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitUserField(this);
  }
}
