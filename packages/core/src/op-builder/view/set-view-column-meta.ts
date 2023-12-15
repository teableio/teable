import type { IColumnMeta, IOtOperation, IColumn } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetViewColumnMetaOpContext {
  name: OpName.SetViewColumnMeta;
  fieldId: string;
  newColumnMeta?: IColumnMeta | null;
  oldColumnMeta?: IColumnMeta | null;
}

export class SetViewColumnMetaBuilder implements IOpBuilder {
  name: OpName.SetViewColumnMeta = OpName.SetViewColumnMeta;

  build(params: {
    fieldId: string;
    newColumnMeta: IColumn | null;
    oldColumnMeta?: IColumn;
  }): IOtOperation {
    const { fieldId, newColumnMeta, oldColumnMeta } = params;

    return {
      p: ['columnMeta', fieldId],
      ...(newColumnMeta ? { oi: newColumnMeta } : {}),
      ...(oldColumnMeta ? { od: oldColumnMeta } : {}),
    };
  }

  detect(op: IOtOperation): ISetViewColumnMetaOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['columnMeta', ':fieldId']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      fieldId: result.fieldId,
      newColumnMeta: oi,
      oldColumnMeta: od,
    };
  }
}
