import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import type { SingleLineTextShowAs } from './SingleLineTextShowAs';
import type { TextDefaultValue } from './TextDefaultValue';

export class SingleLineTextField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly showAsValue: SingleLineTextShowAs | undefined,
    private readonly defaultValueValue: TextDefaultValue | undefined
  ) {
    super(id, name, FieldType.singleLineText());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    showAs?: SingleLineTextShowAs;
    defaultValue?: TextDefaultValue;
  }): Result<SingleLineTextField, DomainError> {
    return ok(new SingleLineTextField(params.id, params.name, params.showAs, params.defaultValue));
  }

  showAs(): SingleLineTextShowAs | undefined {
    return this.showAsValue;
  }

  defaultValue(): TextDefaultValue | undefined {
    return this.defaultValueValue;
  }

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    return SingleLineTextField.create({
      id: params.newId,
      name: params.newName,
      showAs: this.showAs(),
      defaultValue: this.defaultValue(),
    });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitSingleLineTextField(this);
  }
}
