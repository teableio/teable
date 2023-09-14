import { CellValueType } from '../../models/field/constant';
import type { TypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';
import { convertValueToString } from './text';

abstract class LogicalFunc extends FormulaFunc {
  readonly type = FormulaFuncType.Logical;
}

export class If extends LogicalFunc {
  name = FunctionName.If;

  acceptValueType = new Set([
    CellValueType.String,
    CellValueType.DateTime,
    CellValueType.Number,
    CellValueType.Boolean,
  ]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 3) {
      throw new Error(`${FunctionName.If} needs at least 3 params`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    if (params == null) return { type: CellValueType.String };

    this.validateParams(params);

    if (params[1].isBlank) {
      return {
        type: params[2].type,
        isMultiple: params[2].isMultiple,
      };
    }

    if (params[2].isBlank) {
      return {
        type: params[1].type,
        isMultiple: params[1].isMultiple,
      };
    }

    if (params[1].type === params[2].type) {
      return {
        type: params[1].type,
        isMultiple: params[1].isMultiple && params[2].isMultiple,
      };
    }

    return { type: CellValueType.String };
  }

  eval(
    params: TypedValue<string | number | boolean | (string | number | boolean | null)[]>[]
  ): string | number | boolean | null | (string | number | boolean | null)[] {
    const condition = params[0].value;

    return condition ? params[1]?.value : params[2]?.value;
  }
}

export class Switch extends LogicalFunc {
  name = FunctionName.Switch;

  acceptValueType = new Set([
    CellValueType.String,
    CellValueType.DateTime,
    CellValueType.Number,
    CellValueType.Boolean,
  ]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 2) {
      throw new Error(`${FunctionName.Switch} needs at least 2 params`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    if (params == null) return { type: CellValueType.String };

    this.validateParams(params);

    const paramsLength = params.length;

    if (paramsLength <= 2) return { type: params[1].type, isMultiple: params[1].isMultiple };

    let expectedType = params[2].type;
    let expectedIsMultiple = params[2].isMultiple;

    const checkParam = (param: TypedValue) => {
      const { type, isBlank, isMultiple } = param;
      if (!isBlank) {
        if (expectedType !== type) {
          expectedType = CellValueType.String;
        }
        if (expectedIsMultiple !== isMultiple) {
          expectedIsMultiple = false;
        }
      }
    };

    for (let i = 2; i < paramsLength; i += 2) {
      checkParam(params[i]);
    }

    if (paramsLength % 2 === 0) {
      checkParam(params[paramsLength - 1]);
    }

    return { type: expectedType, isMultiple: expectedIsMultiple };
  }

  eval(
    params: TypedValue<string | number | boolean | (string | number | boolean | null)[]>[]
  ): string | number | boolean | null | (string | number | boolean | null)[] {
    const paramsLength = params.length;
    const expression = params[0].value;

    if (paramsLength % 2 === 0) {
      const defaultValue = params[paramsLength - 1].value;

      for (let i = 1; i < paramsLength - 1; i += 2) {
        const currentCase = params[i].value;
        const currentValue = params[i + 1].value;

        if (expression === currentCase) {
          return currentValue;
        }
      }
      return defaultValue;
    }

    for (let i = 1; i < paramsLength; i += 2) {
      const currentCase = params[i].value;
      const currentValue = params[i + 1].value;

      if (expression === currentCase) {
        return currentValue;
      }
    }
    return null;
  }
}

export class And extends LogicalFunc {
  name = FunctionName.And;

  acceptValueType = new Set([CellValueType.Boolean]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      throw new Error(`${FunctionName.And} needs at least 1 param`);
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

export class Or extends LogicalFunc {
  name = FunctionName.Or;

  acceptValueType = new Set([CellValueType.Boolean]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      throw new Error(`${FunctionName.Or} needs at least 1 param`);
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
          return result;
        }
        return result || (param.value as unknown[]).some((v) => Boolean(v));
      }
      return result || Boolean(param.value);
    }, false);
  }
}

export class Xor extends LogicalFunc {
  name = FunctionName.Xor;

  acceptValueType = new Set([CellValueType.Boolean]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      throw new Error(`${FunctionName.Xor} needs at least 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Boolean };
  }

  eval(params: TypedValue<boolean | boolean[] | null[]>[]): boolean {
    const count = params.reduce((result, param) => {
      if (param.isMultiple) {
        if (!Array.isArray(param.value) || param.value == null) {
          return result;
        }
        (param.value as unknown[]).forEach((v) => {
          if (v) result++;
        });
        return result;
      }
      return param.value ? result + 1 : result;
    }, 0);
    return Boolean(count & 1);
  }
}

export class Not extends LogicalFunc {
  name = FunctionName.Not;

  acceptValueType = new Set([CellValueType.Boolean]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Not} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Boolean };
  }

  eval(params: TypedValue<boolean | boolean[] | null[]>[]): boolean {
    return !params[0].value;
  }
}

export class Blank extends LogicalFunc {
  name = FunctionName.Blank;

  acceptValueType = new Set([]);

  acceptMultipleValue = false;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  validateParams() {}

  getReturnType() {
    return { type: CellValueType.String };
  }

  eval(): null {
    return null;
  }
}

export class FormulaBaseError extends Error {
  constructor(message?: string) {
    super();
    this.message = message ? '#ERROR: ' + message : '#ERROR!';
  }
}

export class FormulaError extends LogicalFunc {
  name = FunctionName.Error;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  validateParams() {}

  getReturnType() {
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | string[] | null[]>[]) {
    const errText = convertValueToString(params[0]);
    throw new FormulaBaseError(errText ?? '');
  }
}

export class IsError extends LogicalFunc {
  name = FunctionName.IsError;

  acceptValueType = new Set([
    CellValueType.String,
    CellValueType.Number,
    CellValueType.Boolean,
    CellValueType.DateTime,
  ]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.IsError} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Boolean };
  }

  eval(params: TypedValue<boolean | boolean[] | null[]>[]): boolean {
    const value = params[0].value;
    return value instanceof FormulaBaseError;
  }
}
