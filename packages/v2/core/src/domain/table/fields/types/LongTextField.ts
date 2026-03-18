import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import type { LongTextShowAs } from './LongTextShowAs';
import type { TextDefaultValue } from './TextDefaultValue';

export class LongTextField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly showAsValue: LongTextShowAs | undefined,
    private readonly defaultValueValue: TextDefaultValue | undefined
  ) {
    super(id, name, FieldType.longText());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    showAs?: LongTextShowAs;
    defaultValue?: TextDefaultValue;
  }): Result<LongTextField, DomainError> {
    return ok(new LongTextField(params.id, params.name, params.showAs, params.defaultValue));
  }

  showAs(): LongTextShowAs | undefined {
    return this.showAsValue;
  }

  defaultValue(): TextDefaultValue | undefined {
    return this.defaultValueValue;
  }

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    return LongTextField.create({
      id: params.newId,
      name: params.newName,
      showAs: this.showAs(),
      defaultValue: this.defaultValue(),
    });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitLongTextField(this);
  }
}
