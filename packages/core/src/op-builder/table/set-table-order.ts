import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetTableOrderOpContext {
  name: OpName.SetTableOrder;
  newOrder: number;
  oldOrder: number;
}

export class SetTableOrderBuilder implements IOpBuilder {
  name: OpName.SetTableOrder = OpName.SetTableOrder;

  build(params: { newOrder: number; oldOrder: number }): IOtOperation {
    const { newOrder, oldOrder } = params;

    return {
      p: ['table', 'order'],
      oi: newOrder,
      od: oldOrder,
    };
  }

  detect(op: IOtOperation): ISetTableOrderOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['table', 'order']);

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
