import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetTableIconOpContext {
  name: OpName.SetTableIcon;
  newIcon: string;
  oldIcon: string;
}

export class SetTableIconBuilder implements IOpBuilder {
  name: OpName.SetTableIcon = OpName.SetTableIcon;

  build(params: { newIcon: string; oldIcon?: string | null }): IOtOperation {
    const { newIcon, oldIcon = null } = params;

    return {
      p: ['icon'],
      oi: newIcon,
      od: oldIcon,
    };
  }

  detect(op: IOtOperation): ISetTableIconOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['icon']);
    console.log('detect ', op, result);
    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newIcon: oi,
      oldIcon: od,
    };
  }
}
