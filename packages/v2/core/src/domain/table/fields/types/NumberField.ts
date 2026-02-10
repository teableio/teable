import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import type { NumberDefaultValue } from './NumberDefaultValue';
import { NumberFormatting } from './NumberFormatting';
import type { NumberShowAs } from './NumberShowAs';

export class NumberField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly formattingValue: NumberFormatting,
    private readonly showAsValue: NumberShowAs | undefined,
    private readonly defaultValueValue: NumberDefaultValue | undefined
  ) {
    super(id, name, FieldType.number());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    formatting?: NumberFormatting;
    showAs?: NumberShowAs;
    defaultValue?: NumberDefaultValue;
  }): Result<NumberField, DomainError> {
    return ok(
      new NumberField(
        params.id,
        params.name,
        params.formatting ?? NumberFormatting.default(),
        params.showAs,
        params.defaultValue
      )
    );
  }

  formatting(): NumberFormatting {
    return this.formattingValue;
  }

  showAs(): NumberShowAs | undefined {
    return this.showAsValue;
  }

  defaultValue(): NumberDefaultValue | undefined {
    return this.defaultValueValue;
  }

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    return NumberField.create({
      id: params.newId,
      name: params.newName,
      formatting: this.formatting(),
      showAs: this.showAs(),
      defaultValue: this.defaultValue(),
    });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitNumberField(this);
  }
}
