import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetFieldNameOpContext {
  name: OpName.SetFieldName;
  newName: string;
  oldName: string;
}

export class SetFieldNameBuilder implements IOpBuilder {
  name: OpName.SetFieldName = OpName.SetFieldName;

  build(params: { newName: string; oldName: string }): IOtOperation {
    const { newName, oldName } = params;

    return {
      p: ['field', 'name'],
      oi: newName,
      od: oldName,
    };
  }

  detect(op: IOtOperation): ISetFieldNameOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['field', 'name']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newName: oi,
      oldName: od,
    };
  }
}
