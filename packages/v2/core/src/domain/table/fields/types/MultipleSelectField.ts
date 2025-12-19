import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import type { SelectOptionName } from './SelectOptionName';
import { validateSelectOptions } from './SelectOptions';

export class MultipleSelectField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly options: ReadonlyArray<SelectOptionName>
  ) {
    super(id, name, FieldType.multipleSelect());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    options: ReadonlyArray<SelectOptionName>;
  }): Result<MultipleSelectField, string> {
    return validateSelectOptions(params.options).map(
      (options) => new MultipleSelectField(params.id, params.name, options)
    );
  }

  selectOptions(): ReadonlyArray<SelectOptionName> {
    return [...this.options];
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitMultipleSelectField(this);
  }
}
