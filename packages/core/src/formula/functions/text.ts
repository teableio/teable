import { CellValueType } from '../../models/field/constant';
import type { TypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';

abstract class TextFunc extends FormulaFunc {
  readonly type = FormulaFuncType.Text;
}

export class Concatenate extends TextFunc {
  name = FunctionName.Concatenate;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      throw new Error('Concatenate needs at least 1 param');
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | number | null | (string | number | null)[]>[]): string | null {
    return params.reduce((result, param) => {
      if (param.isMultiple) {
        if (!Array.isArray(param.value)) {
          return result;
        }
        result += param.value.join('');
        return result;
      }
      result += (param.value as string) || '';
      return result;
    }, '');
  }
}
