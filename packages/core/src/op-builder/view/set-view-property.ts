import type { IOtOperation, IViewPropertyKeys } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetViewPropertyOpContext {
  name: OpName.SetViewProperty;
  key: IViewPropertyKeys;
  newValue?: unknown | null;
  oldValue?: unknown | null;
}

export class SetViewPropertyBuilder implements IOpBuilder {
  name: OpName.SetViewProperty = OpName.SetViewProperty;

  build(params: {
    key: IViewPropertyKeys;
    newValue?: unknown | null;
    oldValue?: unknown | null;
  }): IOtOperation {
    const { key, newValue, oldValue } = params;

    return {
      p: [key],
      ...(newValue == null ? {} : { oi: newValue }),
      ...(oldValue == null ? {} : { od: oldValue }),
    };
  }

  detect(op: IOtOperation): ISetViewPropertyOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['*']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      key: p[0] as IViewPropertyKeys,
      newValue: oi,
      oldValue: od,
    };
  }
}
