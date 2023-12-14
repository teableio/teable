import type { IOtOperation, ITablePropertyKey } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetTablePropertyOpContext {
  name: OpName.SetTableProperty;
  key: ITablePropertyKey;
  newValue: unknown;
  oldValue: unknown;
}

export class SetTablePropertyBuilder implements IOpBuilder {
  name: OpName.SetTableProperty = OpName.SetTableProperty;

  build(params: { key: ITablePropertyKey; oldValue: unknown; newValue: unknown }): IOtOperation {
    const { key, newValue, oldValue } = params;

    return {
      p: [key],
      oi: newValue,
      od: oldValue,
    };
  }

  detect(op: IOtOperation): ISetTablePropertyOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['*']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      key: p[0] as ITablePropertyKey,
      newValue: oi,
      oldValue: od,
    };
  }
}
