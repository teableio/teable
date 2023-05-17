import type { FieldType, IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetFieldTypeOpContext {
  name: OpName.SetFieldType;
  newType: FieldType;
  oldType: FieldType;
}

export class SetFieldTypeBuilder implements IOpBuilder {
  name: OpName.SetFieldType = OpName.SetFieldType;

  build(params: { newType: FieldType; oldType: FieldType }): IOtOperation {
    const { newType, oldType } = params;

    return {
      p: ['field', 'type'],
      oi: newType,
      od: oldType,
    };
  }

  detect(op: IOtOperation): ISetFieldTypeOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['field', 'type']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newType: oi,
      oldType: od,
    };
  }
}
