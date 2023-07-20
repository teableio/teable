import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetFieldOptionsOpContext {
  name: OpName.SetFieldOptions;
  newOptions: unknown;
  oldOptions: unknown;
}

export class SetFieldOptionsBuilder implements IOpBuilder {
  name: OpName.SetFieldOptions = OpName.SetFieldOptions;

  build(params: { newOptions: unknown; oldOptions: unknown }): IOtOperation {
    const { newOptions, oldOptions } = params;

    return {
      p: ['options'],
      oi: newOptions,
      od: oldOptions,
    };
  }

  detect(op: IOtOperation): ISetFieldOptionsOpContext | null {
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
