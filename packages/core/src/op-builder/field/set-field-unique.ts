import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetFieldUniqueOpContext {
  name: OpName.SetFieldUnique;
  newUnique: boolean;
  oldUnique: boolean;
}

export class SetFieldUniqueBuilder implements IOpBuilder {
  name: OpName.SetFieldUnique = OpName.SetFieldUnique;

  build(params: { newUnique: boolean; oldUnique: boolean }): IOtOperation {
    const { newUnique, oldUnique } = params;

    return {
      p: ['unique'],
      oi: newUnique,
      od: oldUnique,
    };
  }

  detect(op: IOtOperation): ISetFieldUniqueOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['unique']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newUnique: oi,
      oldUnique: od,
    };
  }
}
