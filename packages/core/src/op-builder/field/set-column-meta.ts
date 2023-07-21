import type { IOtOperation, IColumn } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

type IMetaKey = keyof IColumn;
export interface ISetColumnMetaOpContext {
  name: OpName.SetColumnMeta;
  viewId: string;
  metaKey: IMetaKey;
  newMetaValue: unknown;
  oldMetaValue?: unknown;
}

export class SetColumnMetaBuilder implements IOpBuilder {
  name: OpName.SetColumnMeta = OpName.SetColumnMeta;

  build(params: {
    viewId: string;
    metaKey: IMetaKey;
    newMetaValue: unknown;
    oldMetaValue?: unknown;
  }): IOtOperation {
    const { viewId, metaKey, newMetaValue, oldMetaValue } = params;

    return {
      p: ['columnMeta', viewId, metaKey],
      oi: newMetaValue,
      ...(oldMetaValue ? { od: oldMetaValue } : {}),
    };
  }

  detect(op: IOtOperation): ISetColumnMetaOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<{ viewId: string; metaKey: IMetaKey }>(p, [
      'columnMeta',
      ':viewId',
      ':metaKey',
    ]);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      viewId: result.viewId,
      metaKey: result.metaKey,
      newMetaValue: oi,
      oldMetaValue: od,
    };
  }
}
