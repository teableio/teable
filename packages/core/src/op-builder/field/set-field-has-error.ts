import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetFieldHasErrorOpContext {
  name: OpName.SetFieldHasError;
  oldError: boolean;
  newError: boolean;
}

export class SetFieldHasErrorBuilder implements IOpBuilder {
  name: OpName.SetFieldHasError = OpName.SetFieldHasError;

  build(params: { newError: boolean; oldError: boolean }): IOtOperation {
    const { newError, oldError } = params;

    return {
      p: ['hasError'],
      oi: newError,
      od: oldError,
    };
  }

  detect(op: IOtOperation): ISetFieldHasErrorOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['hasError']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newError: oi,
      oldError: od,
    };
  }
}
