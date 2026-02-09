import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import type { CheckboxDefaultValue } from './CheckboxDefaultValue';

export class CheckboxField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly defaultValueValue: CheckboxDefaultValue | undefined
  ) {
    super(id, name, FieldType.checkbox());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    defaultValue?: CheckboxDefaultValue;
  }): Result<CheckboxField, DomainError> {
    return ok(new CheckboxField(params.id, params.name, params.defaultValue));
  }

  defaultValue(): CheckboxDefaultValue | undefined {
    return this.defaultValueValue;
  }

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    return CheckboxField.create({
      id: params.newId,
      name: params.newName,
      defaultValue: this.defaultValue(),
    });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitCheckboxField(this);
  }
}
