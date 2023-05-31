import { CellValueType } from '../../models/field/constant';
import type { ITypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';

abstract class NumericFunc extends FormulaFunc {
  readonly type = FormulaFuncType.Numeric;
}

export class Sum extends NumericFunc {
  name = FunctionName.Sum;

  acceptValueType = new Set([CellValueType.Array, CellValueType.Boolean, CellValueType.Number]);

  validateParams(params: ITypedValue[]) {
    if (!params.length) {
      throw new Error('Sum need at least 1 param');
    }
    params.forEach((param, i) => {
      if ('elementType' in param && param.elementType === CellValueType.String) {
        throw new Error(`Sum can'\t process string type param at ${i + 1}`);
      }
    });
    return true;
  }

  getReturnType() {
    return { type: CellValueType.Number };
  }

  eval(params: ITypedValue<number>[]): number {
    return params.reduce((result, param) => {
      if (param.type === CellValueType.Array && 'elementType' in param) {
        result += (param.value || [])?.reduce((r, p) => {
          r += p.value || 0;
          return r;
        }, 0);
        return result;
      }
      result += param.value || 0;
      return result;
    }, 0);
  }
}
