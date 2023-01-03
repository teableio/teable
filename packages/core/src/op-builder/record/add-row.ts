import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface IAddRowOpContext {
  name: OpName.AddRow;
  viewId: string;
  recordId: string;
  rowIndex: number;
}

export class AddRowBuilder implements IOpBuilder {
  name: OpName.AddRow = OpName.AddRow;

  build(params: { recordId: string; viewId: string; rowIndex: number }): IOtOperation {
    const { recordId, viewId, rowIndex } = params;
    return {
      p: ['viewMap', viewId, 'rows', rowIndex],
      li: { recordId },
    };
  }

  detect(op: IOtOperation): IAddRowOpContext | null {
    const { p, li, ld } = op;
    if (!li || ld) {
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
      recordId: li.recordId,
    };
  }
}
