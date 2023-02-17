import type { FieldType, IFieldVo, IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface IDeleteFieldOpContext {
  name: OpName.DeleteField;
  id: string;
  fieldName: string;
  type: FieldType;
  description?: string;
  options?: unknown;
  notNull?: boolean;
  unique?: boolean;
  defaultValue?: unknown;
}

export class DeleteFieldBuilder implements IOpBuilder {
  name: OpName.DeleteField = OpName.DeleteField;

  build(field: IFieldVo): IOtOperation {
    return {
      p: ['fieldMap', field.id],
      od: field,
    };
  }

  detect(op: IOtOperation): IDeleteFieldOpContext | null {
    const { p, oi, od } = op;
    if (!od || oi) {
      return null;
    }

    const result = pathMatcher<{ fieldId: string }>(p, ['fieldMap', ':fieldId']);

    if (!result) {
      return null;
    }

    const field: IFieldVo = oi;
    return {
      name: this.name,
      id: field.id,
      fieldName: field.name,
      type: field.type,
      description: field.description,
      options: field.options,
      notNull: field.notNull,
      unique: field.unique,
      defaultValue: field.defaultValue,
    };
  }
}
