import type { IOtOperation, IRow } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface IDeleteRowOpContext {
  name: OpName.DeleteRow;
  viewId: string;
  recordId: string;
  rowIndex: number;
}

export class DeleteRowBuilder implements IOpBuilder {
  name: OpName.DeleteRow = OpName.DeleteRow;

  build(params: { viewId: string; rowIndex: number; oldRow: IRow }): IOtOperation {
    const { viewId, rowIndex, oldRow } = params;
    return {
      p: ['viewMap', viewId, 'rows', rowIndex],
      ld: oldRow,
    };
  }

  detect(op: IOtOperation): IDeleteRowOpContext | null {
    const { p, li, ld } = op;
    if (li || !ld) {
      return null;
    }

    const result = pathMatcher<{ viewId: string; rowIndex: number }>(p, [
      'viewMap',
      ':viewId',
      'rows',
      ':rowIndex',
    ]);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      viewId: result.viewId,
      rowIndex: result.rowIndex,
      recordId: ld.recordId,
    };
  }
}
