import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { SelectAutoNewOptions } from './SelectAutoNewOptions';
import type { SelectDefaultValue } from './SelectDefaultValue';
import type { SelectOption } from './SelectOption';
import { validateSelectOptions } from './SelectOptions';

export class MultipleSelectField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly optionsValue: ReadonlyArray<SelectOption>,
    private readonly defaultValueValue: SelectDefaultValue | undefined,
    private readonly preventAutoNewOptionsValue: SelectAutoNewOptions
  ) {
    super(id, name, FieldType.multipleSelect());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    options: ReadonlyArray<SelectOption>;
    defaultValue?: SelectDefaultValue;
    preventAutoNewOptions?: SelectAutoNewOptions;
  }): Result<MultipleSelectField, DomainError> {
    return validateSelectOptions(params.options, params.defaultValue, 'multiple').map(
      (options) =>
        new MultipleSelectField(
          params.id,
          params.name,
          options,
          params.defaultValue,
          params.preventAutoNewOptions ?? SelectAutoNewOptions.allow()
        )
    );
  }

  selectOptions(): ReadonlyArray<SelectOption> {
    return [...this.optionsValue];
  }

  defaultValue(): SelectDefaultValue | undefined {
    return this.defaultValueValue;
  }

  preventAutoNewOptions(): SelectAutoNewOptions {
    return this.preventAutoNewOptionsValue;
  }

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    return MultipleSelectField.create({
      id: params.newId,
      name: params.newName,
      options: this.selectOptions(),
      defaultValue: this.defaultValue(),
      preventAutoNewOptions: this.preventAutoNewOptions(),
    });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitMultipleSelectField(this);
  }
}
