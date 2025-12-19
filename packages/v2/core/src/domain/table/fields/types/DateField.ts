import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { DateFormat } from './DateFormat';

export class DateField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly format: DateFormat
  ) {
    super(id, name, FieldType.date());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    format?: DateFormat;
  }): Result<DateField, string> {
    return ok(new DateField(params.id, params.name, params.format ?? DateFormat.dateTime()));
  }

  dateFormat(): DateFormat {
    return this.format;
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitDateField(this);
  }
}
