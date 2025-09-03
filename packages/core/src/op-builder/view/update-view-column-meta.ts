import type { IOtOperation, IColumn } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface IUpdateViewColumnMetaOpContext {
  name: OpName.UpdateViewColumnMeta;
  fieldId: string;
  newColumnMeta?: IColumn | null;
  oldColumnMeta?: IColumn | null;
}

export class UpdateViewColumnMetaBuilder implements IOpBuilder {
  name: OpName.UpdateViewColumnMeta = OpName.UpdateViewColumnMeta;

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

  detect(op: IOtOperation): IUpdateViewColumnMetaOpContext | null {
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
