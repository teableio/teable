import { CellValueType } from '../../models/field/constant';
import type { TypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';

abstract class LogicalFunc extends FormulaFunc {
  readonly type = FormulaFuncType.Logical;
}

export class And extends LogicalFunc {
  name = FunctionName.And;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      throw new Error('And needs at least 1 param');
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Boolean };
  }

  eval(params: TypedValue<boolean | boolean[] | null[]>[]): boolean {
    return params.reduce((result, param) => {
      if (param.isMultiple) {
        if (!Array.isArray(param.value) || param.value == null) {
          return false;
        }
        return result && (param.value as unknown[]).every((v) => Boolean(v));
      }
      return result && Boolean(param.value);
    }, true);
  }
}
