import type { ISort, IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetViewSortOpContext {
  name: OpName.SetViewSort;
  newSort?: ISort | null;
  oldSort?: ISort | null;
}

export class SetViewSortBuilder implements IOpBuilder {
  name: OpName.SetViewSort = OpName.SetViewSort;

  build(params: { newSort?: ISort | null; oldSort?: ISort | null }): IOtOperation {
    const { newSort, oldSort } = params;

    return {
      p: ['sort'],
      ...(newSort ? { oi: newSort } : {}),
      ...(oldSort ? { od: oldSort } : {}),
    };
  }

  detect(op: IOtOperation): ISetViewSortOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['sort']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newSort: oi,
      oldSort: od,
    };
  }
}
