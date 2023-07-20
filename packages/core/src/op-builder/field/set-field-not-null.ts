import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetFieldNotNullOpContext {
  name: OpName.SetFieldNotNull;
  newNotNull: string;
  oldNotNull: string;
}

export class SetFieldNotNullBuilder implements IOpBuilder {
  name: OpName.SetFieldNotNull = OpName.SetFieldNotNull;

  build(params: { newNotNull: string; oldNotNull: string }): IOtOperation {
    const { newNotNull, oldNotNull } = params;

    return {
      p: ['notNull'],
      oi: newNotNull,
      od: oldNotNull,
    };
  }

  detect(op: IOtOperation): ISetFieldNotNullOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['notNull']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newNotNull: oi,
      oldNotNull: od,
    };
  }
}
