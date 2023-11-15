import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetViewEnableShareOpContext {
  name: OpName.SetViewEnableShare;
  newEnableShare: boolean;
  oldEnableShare?: boolean;
}

export class SetViewEnableShareBuilder implements IOpBuilder {
  name: OpName.SetViewEnableShare = OpName.SetViewEnableShare;

  build(params: { newEnableShare: boolean; oldEnableShare?: boolean }): IOtOperation {
    const { newEnableShare, oldEnableShare } = params;

    return {
      p: ['enableShare'],
      oi: newEnableShare,
      ...(oldEnableShare == undefined ? { od: oldEnableShare } : {}),
    };
  }

  detect(op: IOtOperation): ISetViewEnableShareOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['enableShare']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newEnableShare: oi,
      oldEnableShare: od,
    };
  }
}
