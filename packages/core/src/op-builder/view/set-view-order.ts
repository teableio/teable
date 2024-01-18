import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetViewOrderOpContext {
  name: OpName.SetViewOrder;
  newOrder?: number;
  oldOrder?: number;
}

export class SetViewOrderBuilder implements IOpBuilder {
  name: OpName.SetViewOrder = OpName.SetViewOrder;

  build(params: { newOrder: number; oldOrder: number }): IOtOperation {
    const { newOrder, oldOrder } = params;

    return {
      p: ['order'],
      oi: newOrder,
      od: oldOrder,
    };
  }

  detect(op: IOtOperation): ISetViewOrderOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['order']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newOrder: oi,
      oldOrder: od,
    };
  }
}
