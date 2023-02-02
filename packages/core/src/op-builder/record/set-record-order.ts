import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface IAddRowOpContext {
  name: OpName.SetRecordOrder;
  viewId: string;
  newOrder: number;
  oldOrder?: number;
}

export class SetRecordOrderBuilder implements IOpBuilder {
  name: OpName.SetRecordOrder = OpName.SetRecordOrder;

  build(params: { viewId: string; newOrder: number; oldOrder?: number }): IOtOperation {
    const { viewId, newOrder, oldOrder } = params;
    return {
      p: ['recordOrder', viewId],
      oi: { newOrder },
      ...(oldOrder ? { od: oldOrder } : {}),
    };
  }

  detect(op: IOtOperation): IAddRowOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<{ viewId: string }>(p, ['recordOrder', ':viewId']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      viewId: result.viewId,
      newOrder: oi,
      oldOrder: od,
    };
  }
}
