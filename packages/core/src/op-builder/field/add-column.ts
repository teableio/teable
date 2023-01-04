import type { IColumn, IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface IAddColumnOpContext {
  name: OpName.AddColumn;
  columnIndex: number;
  viewId: string;
  column: IColumn;
}

export class AddColumnBuilder implements IOpBuilder {
  name: OpName.AddColumn = OpName.AddColumn;

  build(params: { columnIndex: number; viewId: string; column: IColumn }): IOtOperation {
    const { viewId, columnIndex, column } = params;

    return {
      p: ['viewMap', viewId, 'columns', columnIndex],
      li: column,
    };
  }

  detect(op: IOtOperation): IAddColumnOpContext | null {
    const { p, li, ld } = op;
    if (!li || ld) {
      return null;
    }

    const result = pathMatcher<{ viewId: string; columnIndex: number }>(p, [
      'viewMap',
      ':viewId',
      'columns',
      ':columnIndex',
    ]);

    if (!result) {
      return null;
    }

    const column: IColumn = li;
    return {
      name: this.name,
      columnIndex: result.columnIndex,
      viewId: result.viewId,
      column,
    };
  }
}
