import type { FieldType, IFieldBase, IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface IAddFieldOpContext {
  name: OpName.AddField;
  fieldId: string;
  fieldName: string;
  fieldType: FieldType;
  description?: string;
  options?: unknown;
  notNull?: boolean;
  unique?: boolean;
  defaultValue?: unknown;
}

export class AddFieldBuilder implements IOpBuilder {
  name: OpName.AddField = OpName.AddField;

  build(field: IFieldBase): IOtOperation {
    return {
      p: ['fieldMap', field.id],
      oi: field,
    };
  }

  detect(op: IOtOperation): IAddFieldOpContext | null {
    const { p, oi, od } = op;
    if (!oi || od) {
      return null;
    }

    const result = pathMatcher<{ fieldId: string }>(p, ['fieldMap', ':fieldId']);

    if (!result) {
      return null;
    }

    const field: IFieldBase = oi;
    return {
      name: this.name,
      fieldId: field.id,
      fieldName: field.name,
      fieldType: field.type,
      description: field.description,
      options: field.options,
      notNull: field.notNull,
      unique: field.unique,
      defaultValue: field.defaultValue,
    };
  }
}
