import type { FormViewOptions, GridViewOptions, IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetViewOptionsOpContext {
  name: OpName.SetViewOptions;
  newOptions: GridViewOptions | FormViewOptions;
  oldOptions?: GridViewOptions | FormViewOptions;
}

export class SetViewOptionBuilder implements IOpBuilder {
  name: OpName.SetViewOptions = OpName.SetViewOptions;

  build(params: Omit<ISetViewOptionsOpContext, 'name'>): IOtOperation {
    const { newOptions, oldOptions } = params;

    return {
      p: ['options'],
      oi: newOptions,
      ...(oldOptions ? { od: oldOptions } : {}),
    };
  }

  detect(op: IOtOperation): ISetViewOptionsOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['options']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newOptions: oi,
      oldOptions: od,
    };
  }
}
