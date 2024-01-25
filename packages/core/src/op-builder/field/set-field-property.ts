import type { IFieldPropertyKey, IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetFieldPropertyOpContext {
  name: OpName.SetFieldProperty;
  key: IFieldPropertyKey;
  newValue: unknown;
  oldValue: unknown;
}

export class SetFieldPropertyBuilder implements IOpBuilder {
  name: OpName.SetFieldProperty = OpName.SetFieldProperty;

  build(params: { key: IFieldPropertyKey; oldValue: unknown; newValue: unknown }): IOtOperation {
    const { key, newValue, oldValue } = params;

    return {
      p: [key],
      ...(newValue == null ? {} : { oi: newValue }),
      ...(oldValue == null ? {} : { od: oldValue }),
    };
  }

  detect(op: IOtOperation): ISetFieldPropertyOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['*']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      key: p[0] as IFieldPropertyKey,
      newValue: oi,
      oldValue: od,
    };
  }
}
