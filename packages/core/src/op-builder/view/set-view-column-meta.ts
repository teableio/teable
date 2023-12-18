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
    newMetaValue: IColumn | null;
    oldMetaValue?: IColumn;
  }): IOtOperation {
    const { fieldId, newMetaValue, oldMetaValue } = params;

    return {
      p: ['columnMeta', fieldId],
      ...(newMetaValue ? { oi: newMetaValue } : {}),
      ...(oldMetaValue ? { od: oldMetaValue } : {}),
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
