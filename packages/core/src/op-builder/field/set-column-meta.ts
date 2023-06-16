import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetColumnMetaOpContext {
  name: OpName.SetColumnMeta;
  newMetaValue: number;
  oldMetaValue?: number;
}

export class SetColumnMetaBuilder implements IOpBuilder {
  name: OpName.SetColumnMeta = OpName.SetColumnMeta;

  build(params: { newMetaValue: unknown; oldMetaValue?: unknown }): IOtOperation {
    const { newMetaValue, oldMetaValue } = params;

    return {
      p: ['field', 'columnMeta'],
      oi: newMetaValue,
      ...(oldMetaValue ? { od: oldMetaValue } : {}),
    };
  }

  detect(op: IOtOperation): ISetColumnMetaOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['field', 'columnMeta']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newMetaValue: oi,
      oldMetaValue: od,
    };
  }
}
