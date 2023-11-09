import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetViewShareIdOpContext {
  name: OpName.SetViewShareId;
  newShareId: string;
  oldShareId?: string;
}

export class SetViewShareIdBuilder implements IOpBuilder {
  name: OpName.SetViewShareId = OpName.SetViewShareId;

  build(params: { newShareId: string; oldShareId?: string }): IOtOperation {
    const { newShareId, oldShareId } = params;

    return {
      p: ['shareId'],
      oi: newShareId,
      ...(oldShareId ? { od: oldShareId } : {}),
    };
  }

  detect(op: IOtOperation): ISetViewShareIdOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['shareId']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newShareId: oi,
      oldShareId: od,
    };
  }
}
