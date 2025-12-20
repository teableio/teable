import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { SelectAutoNewOptions } from './SelectAutoNewOptions';
import type { SelectDefaultValue } from './SelectDefaultValue';
import type { SelectOption } from './SelectOption';
import { validateSelectOptions } from './SelectOptions';

export class SingleSelectField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly optionsValue: ReadonlyArray<SelectOption>,
    private readonly defaultValueValue: SelectDefaultValue | undefined,
    private readonly preventAutoNewOptionsValue: SelectAutoNewOptions
  ) {
    super(id, name, FieldType.singleSelect());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    options: ReadonlyArray<SelectOption>;
    defaultValue?: SelectDefaultValue;
    preventAutoNewOptions?: SelectAutoNewOptions;
  }): Result<SingleSelectField, string> {
    return validateSelectOptions(params.options, params.defaultValue, 'single').map(
      (options) =>
        new SingleSelectField(
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

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitSingleSelectField(this);
  }
}
