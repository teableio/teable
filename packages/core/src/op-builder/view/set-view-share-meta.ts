import { isEmpty } from 'lodash';
import { type IOtOperation, type IShareViewMeta } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetViewShareMetaOpContext {
  name: OpName.SetViewShareMeta;
  newShareMeta: IShareViewMeta;
  oldShareMeta?: IShareViewMeta;
}

export class SetViewShareMetaBuilder implements IOpBuilder {
  name: OpName.SetViewShareMeta = OpName.SetViewShareMeta;

  build(params: { newShareMeta?: IShareViewMeta; oldShareMeta?: IShareViewMeta }): IOtOperation {
    const { newShareMeta, oldShareMeta } = params;
    let oldShareMetaInner: IShareViewMeta | undefined | null = oldShareMeta;
    if (!oldShareMeta || isEmpty(oldShareMeta)) {
      oldShareMetaInner = null;
    }

    return {
      p: ['shareMeta'],
      oi: newShareMeta || null,
      od: oldShareMetaInner,
    };
  }

  detect(op: IOtOperation): ISetViewShareMetaOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['shareMeta']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newShareMeta: oi,
      oldShareMeta: od,
    };
  }
}
