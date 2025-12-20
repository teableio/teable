import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import type { DateDefaultValue } from './DateDefaultValue';
import { DateTimeFormatting } from './DateTimeFormatting';

export class DateField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly formattingValue: DateTimeFormatting,
    private readonly defaultValueValue: DateDefaultValue | undefined
  ) {
    super(id, name, FieldType.date());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    formatting?: DateTimeFormatting;
    defaultValue?: DateDefaultValue;
  }): Result<DateField, string> {
    return ok(
      new DateField(
        params.id,
        params.name,
        params.formatting ?? DateTimeFormatting.default(),
        params.defaultValue
      )
    );
  }

  formatting(): DateTimeFormatting {
    return this.formattingValue;
  }

  defaultValue(): DateDefaultValue | undefined {
    return this.defaultValueValue;
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitDateField(this);
  }
}
