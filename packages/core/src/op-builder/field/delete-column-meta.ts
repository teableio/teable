import type { Column, IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface IDeleteColumnMetaOpContext {
  name: OpName.DeleteColumnMeta;
  viewId: string;
  oldMetaValue: Column;
}

export class DeleteColumnMetaBuilder implements IOpBuilder {
  name: OpName.DeleteColumnMeta = OpName.DeleteColumnMeta;

  build(params: { viewId: string; oldMetaValue: Column }): IOtOperation {
    const { viewId, oldMetaValue } = params;
    return {
      p: ['field', 'columnMeta', viewId],
      od: oldMetaValue,
    };
  }

  detect(op: IOtOperation): IDeleteColumnMetaOpContext | null {
    const { p, od, oi } = op;

    if (!od || oi) {
      return null;
    }

    const result = pathMatcher<{ viewId: string }>(p, ['field', 'columnMeta', ':viewId']);

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
