import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetFieldDefaultValueOpContext {
  name: OpName.SetFieldDefaultValue;
  newDefaultValue: unknown;
  oldDefaultValue: unknown;
}

export class SetFieldDefaultValueBuilder implements IOpBuilder {
  name: OpName.SetFieldDefaultValue = OpName.SetFieldDefaultValue;

  build(params: { newDefaultValue: unknown; oldDefaultValue: unknown }): IOtOperation {
    const { newDefaultValue, oldDefaultValue } = params;

    return {
      p: ['field', 'defaultValue'],
      oi: newDefaultValue,
      od: oldDefaultValue,
    };
  }

  detect(op: IOtOperation): ISetFieldDefaultValueOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['field', 'defaultValue']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newDefaultValue: oi,
      oldDefaultValue: od,
    };
  }
}
