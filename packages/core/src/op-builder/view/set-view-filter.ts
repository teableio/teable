import type { IFilter, IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetViewFilterOpContext {
  name: OpName.SetViewFilter;
  newFilter?: IFilter | null;
  oldFilter?: IFilter | null;
}

export class SetViewFilterBuilder implements IOpBuilder {
  name: OpName.SetViewFilter = OpName.SetViewFilter;

  build(params: { newFilter?: IFilter | null; oldFilter?: IFilter | null }): IOtOperation {
    const { newFilter, oldFilter } = params;

    return {
      p: ['view', 'filter'],
      ...(newFilter ? { oi: newFilter } : {}),
      ...(oldFilter ? { od: oldFilter } : {}),
    };
  }

  detect(op: IOtOperation): ISetViewFilterOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['view', 'filter']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newFilter: oi,
      oldFilter: od,
    };
  }
}
