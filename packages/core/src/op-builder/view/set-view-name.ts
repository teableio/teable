import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetViewNameOpContext {
  name: OpName.SetViewName;
  newName: string;
  oldName: string;
}

export class SetViewNameBuilder implements IOpBuilder {
  name: OpName.SetViewName = OpName.SetViewName;

  build(params: { newName: string; oldName: string }): IOtOperation {
    const { newName, oldName } = params;

    return {
      p: ['view', 'name'],
      oi: newName,
      od: oldName,
    };
  }

  detect(op: IOtOperation): ISetViewNameOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['view', 'name']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newName: oi,
      oldName: od,
    };
  }
}
