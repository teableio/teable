import type { IColumn, IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface IDeleteColumnMetaOpContext {
  name: OpName.DeleteColumnMeta;
  viewId: string;
  oldMetaValue: IColumn;
}

export class DeleteColumnMetaBuilder implements IOpBuilder {
  name: OpName.DeleteColumnMeta = OpName.DeleteColumnMeta;

  build(params: { viewId: string; oldMetaValue: IColumn }): IOtOperation {
    const { viewId, oldMetaValue } = params;
    return {
      p: ['columnMeta', viewId],
      od: oldMetaValue,
    };
  }

  detect(op: IOtOperation): IDeleteColumnMetaOpContext | null {
    const { p, od, oi } = op;

    if (!od || oi) {
      return null;
    }

    const result = pathMatcher<{ viewId: string }>(p, ['columnMeta', ':viewId']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      viewId: result.viewId,
      oldMetaValue: od,
    };
  }
}
