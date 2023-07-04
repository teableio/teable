import { CellValueType } from '../../models/field/constant';
import type { TypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';

abstract class SystemFunc extends FormulaFunc {
  readonly type = FormulaFuncType.System;
}

export class Rollup extends SystemFunc {
  name = FunctionName.Rollup;

  acceptValueType = new Set([CellValueType.String]);

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Rollup} only allow 1 param`);
    }

    return true;
  }

  getReturnType(params: TypedValue[]) {
    if (params[0].isMultiple) {
      return { type: CellValueType.String, isMultiple: true };
    }
    return { type: CellValueType.String };
  }

  eval(params: TypedValue[]): boolean | number | string | string[] | null {
    const param = params[0];
    if (param.isMultiple) {
      return param.value ? (param.value as string[]).map((p) => p || '') : null;
    }

    return param.value || null;
  }
}
