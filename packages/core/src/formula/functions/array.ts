import { CellValueType } from '../../models/field/constant';
import type { TypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';

abstract class ArrayFunc extends FormulaFunc {
  readonly type = FormulaFuncType.Array;
}

export class CountAll extends ArrayFunc {
  name = FunctionName.CountAll;

  acceptValueType = new Set([
    CellValueType.Boolean,
    CellValueType.DateTime,
    CellValueType.Number,
    CellValueType.String,
  ]);

  acceptMultipleValue = true;

  validateParams(_params: TypedValue[]) {
    // validation logic here if necessary
  }

  getReturnType(params: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eval(params: TypedValue<any | any[] | null[]>[]): number {
    if (params.length === 1 && params[0].value == null) {
      return 0;
    }
    return params.reduce((result, param) => {
      if (param.isMultiple) {
        if (!Array.isArray(param.value) || param.value === null) {
          return result;
        }
        result += param.value.reduce((pre, v) => {
          if (!Array.isArray(v)) {
            pre += 1;
            return pre;
          }
          pre += v.length;
          return pre;
        }, 0);
        return result;
      }
      result += 1;
      return result;
    }, 0);
  }
}
