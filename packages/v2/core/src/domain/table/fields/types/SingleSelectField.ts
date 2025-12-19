import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import type { SelectOptionName } from './SelectOptionName';

const isUniqueByStringValue = (values: ReadonlyArray<{ toString(): string }>): boolean => {
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toString();
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
};

export class SingleSelectField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly options: ReadonlyArray<SelectOptionName>
  ) {
    super(id, name, FieldType.singleSelect());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    options: ReadonlyArray<SelectOptionName>;
  }): Result<SingleSelectField, string> {
    if (params.options.length === 0) return err('SelectField requires at least one option');
    if (!isUniqueByStringValue(params.options)) return err('SelectField options must be unique');
    return ok(new SingleSelectField(params.id, params.name, [...params.options]));
  }

  selectOptions(): ReadonlyArray<SelectOptionName> {
    return [...this.options];
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitSingleSelectField(this);
  }
}
