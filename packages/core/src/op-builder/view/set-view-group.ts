import type { IGroup, IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetViewGroupOpContext {
  name: OpName.SetViewGroup;
  newGroup?: IGroup | null;
  oldGroup?: IGroup | null;
}

export class SetViewGroupBuilder implements IOpBuilder {
  name: OpName.SetViewGroup = OpName.SetViewGroup;

  build(params: { newGroup?: IGroup | null; oldGroup?: IGroup | null }): IOtOperation {
    const { newGroup, oldGroup } = params;

    return {
      p: ['group'],
      ...(newGroup ? { oi: newGroup } : {}),
      ...(oldGroup ? { od: oldGroup } : {}),
    };
  }

  detect(op: IOtOperation): ISetViewGroupOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['group']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newGroup: oi,
      oldGroup: od,
    };
  }
}
