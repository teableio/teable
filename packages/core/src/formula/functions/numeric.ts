import { CellValueType } from '../../models/field/constant';
import type { TypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';

abstract class NumericFunc extends FormulaFunc {
  readonly type = FormulaFuncType.Numeric;
}

export class Sum extends NumericFunc {
  name = FunctionName.Sum;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (!params.length) {
      throw new Error('Sum need at least 1 param');
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`Sum can'\t process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType() {
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number | null | (number | null)[]>[]): number | null {
    return params.reduce((result, param) => {
      if (param.isMultiple) {
        if (!Array.isArray(param.value)) {
          return result;
        }
        result += param.value
          ? (param.value as (number | null)[]).reduce<number>((r, p) => {
              r += p || 0;
              return r;
            }, 0)
          : 0;
        return result;
      }
      result += (param.value as number) || 0;
      return result;
    }, 0);
  }
}
