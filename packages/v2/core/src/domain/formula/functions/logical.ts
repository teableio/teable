import { err, ok } from 'neverthrow';

import { domainError } from '../../shared/DomainError';
import { CellValueType } from '../CellValueType';
import type { TypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';

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
      return err(domainError.validation({ message: `${FunctionName.If} needs at least 3 params` }));
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => {
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
    });
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
      return err(
        domainError.validation({ message: `${FunctionName.Switch} needs at least 2 params` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => {
      if (params.length <= 2) {
        return { type: params[1].type, isMultiple: params[1].isMultiple };
      }

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

      for (let i = 2; i < params.length; i += 2) {
        checkParam(params[i]);
      }

      if (params.length % 2 === 0) {
        checkParam(params[params.length - 1]);
      }

      return { type: expectedType, isMultiple: expectedIsMultiple };
    });
  }
}

export class And extends LogicalFunc {
  name = FunctionName.And;

  acceptValueType = new Set([CellValueType.Boolean]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      return err(domainError.validation({ message: `${FunctionName.And} needs at least 1 param` }));
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Boolean });
    return this.validateParams(params).map(() => ({ type: CellValueType.Boolean }));
  }
}

export class Or extends LogicalFunc {
  name = FunctionName.Or;

  acceptValueType = new Set([CellValueType.Boolean]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      return err(domainError.validation({ message: `${FunctionName.Or} needs at least 1 param` }));
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Boolean });
    return this.validateParams(params).map(() => ({ type: CellValueType.Boolean }));
  }
}

export class Xor extends LogicalFunc {
  name = FunctionName.Xor;

  acceptValueType = new Set([CellValueType.Boolean]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      return err(domainError.validation({ message: `${FunctionName.Xor} needs at least 1 param` }));
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Boolean });
    return this.validateParams(params).map(() => ({ type: CellValueType.Boolean }));
  }
}

export class Not extends LogicalFunc {
  name = FunctionName.Not;

  acceptValueType = new Set([CellValueType.Boolean]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      return err(domainError.validation({ message: `${FunctionName.Not} only allow 1 param` }));
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Boolean });
    return this.validateParams(params).map(() => ({ type: CellValueType.Boolean }));
  }
}

export class Blank extends LogicalFunc {
  name = FunctionName.Blank;

  acceptValueType = new Set([]);

  acceptMultipleValue = false;

  validateParams(_: TypedValue[]): ReturnType<FormulaFunc['validateParams']> {
    return ok(undefined);
  }

  getReturnType() {
    return ok({ type: CellValueType.String });
  }
}

export class FormulaError extends LogicalFunc {
  name = FunctionName.Error;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(_: TypedValue[]): ReturnType<FormulaFunc['validateParams']> {
    return ok(undefined);
  }

  getReturnType() {
    return ok({ type: CellValueType.String });
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
      return err(domainError.validation({ message: `${FunctionName.IsError} only allow 1 param` }));
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Boolean });
    return this.validateParams(params).map(() => ({ type: CellValueType.Boolean }));
  }
}
