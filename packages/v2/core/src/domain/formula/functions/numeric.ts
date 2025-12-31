import { err, ok } from 'neverthrow';

import { domainError } from '../../shared/DomainError';
import { CellValueType } from '../CellValueType';
import type { TypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';

abstract class NumericFunc extends FormulaFunc {
  readonly type = FormulaFuncType.Numeric;
}

const validateAtLeastOne = (fnName: FunctionName, params: TypedValue[]) => {
  if (!params.length) {
    return err(domainError.validation({ message: `${fnName} needs at least 1 param` }));
  }
  return ok(undefined);
};

const validateOnlyNumber = (fnName: FunctionName, params: TypedValue[]) => {
  const lengthResult = validateAtLeastOne(fnName, params);
  if (lengthResult.isErr()) return lengthResult;
  for (const [index, param] of params.entries()) {
    if (param && param.type === CellValueType.String) {
      return err(
        domainError.validation({
          message: `${fnName} can't process string type param at ${index + 1}`,
        })
      );
    }
  }
  return ok(undefined);
};

export class Sum extends NumericFunc {
  name = FunctionName.Sum;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    return validateOnlyNumber(FunctionName.Sum, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Average extends NumericFunc {
  name = FunctionName.Average;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    return validateOnlyNumber(FunctionName.Average, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Max extends NumericFunc {
  name = FunctionName.Max;

  acceptValueType = new Set([CellValueType.Number, CellValueType.DateTime]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    const lengthResult = validateAtLeastOne(FunctionName.Max, params);
    if (lengthResult.isErr()) return lengthResult;
    for (const [index, param] of params.entries()) {
      if (param && param.type !== CellValueType.Number && param.type !== CellValueType.DateTime) {
        return err(
          domainError.validation({
            message: `${FunctionName.Max} can only process number or datetime type param at ${index + 1}`,
          })
        );
      }
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({
      type: params[0]?.type ?? CellValueType.Number,
    }));
  }
}

export class Min extends NumericFunc {
  name = FunctionName.Min;

  acceptValueType = new Set([CellValueType.Number, CellValueType.DateTime]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    const lengthResult = validateAtLeastOne(FunctionName.Min, params);
    if (lengthResult.isErr()) return lengthResult;
    for (const [index, param] of params.entries()) {
      if (param && param.type !== CellValueType.Number && param.type !== CellValueType.DateTime) {
        return err(
          domainError.validation({
            message: `${FunctionName.Min} can only process number or datetime type param at ${index + 1}`,
          })
        );
      }
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({
      type: params[0]?.type ?? CellValueType.Number,
    }));
  }
}

export class Round extends NumericFunc {
  name = FunctionName.Round;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return validateOnlyNumber(FunctionName.Round, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class RoundUp extends NumericFunc {
  name = FunctionName.RoundUp;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return validateOnlyNumber(FunctionName.RoundUp, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class RoundDown extends NumericFunc {
  name = FunctionName.RoundDown;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return validateOnlyNumber(FunctionName.RoundDown, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Ceiling extends NumericFunc {
  name = FunctionName.Ceiling;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return validateOnlyNumber(FunctionName.Ceiling, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Floor extends NumericFunc {
  name = FunctionName.Floor;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return validateOnlyNumber(FunctionName.Floor, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Even extends NumericFunc {
  name = FunctionName.Even;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return validateOnlyNumber(FunctionName.Even, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Odd extends NumericFunc {
  name = FunctionName.Odd;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return validateOnlyNumber(FunctionName.Odd, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Int extends NumericFunc {
  name = FunctionName.Int;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return validateOnlyNumber(FunctionName.Int, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Abs extends NumericFunc {
  name = FunctionName.Abs;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return validateOnlyNumber(FunctionName.Abs, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Sqrt extends NumericFunc {
  name = FunctionName.Sqrt;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      return err(domainError.validation({ message: `${FunctionName.Sqrt} only allow 1 param` }));
    }
    return validateOnlyNumber(FunctionName.Sqrt, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Power extends NumericFunc {
  name = FunctionName.Power;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length < 2) {
      return err(domainError.validation({ message: `${FunctionName.Power} needs 2 params` }));
    }
    return validateOnlyNumber(FunctionName.Power, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Exp extends NumericFunc {
  name = FunctionName.Exp;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      return err(domainError.validation({ message: `${FunctionName.Exp} only allow 1 param` }));
    }
    return validateOnlyNumber(FunctionName.Exp, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Log extends NumericFunc {
  name = FunctionName.Log;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return validateOnlyNumber(FunctionName.Log, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Mod extends NumericFunc {
  name = FunctionName.Mod;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length < 2) {
      return err(domainError.validation({ message: `${FunctionName.Mod} needs 2 params` }));
    }
    return validateOnlyNumber(FunctionName.Mod, params);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Value extends NumericFunc {
  name = FunctionName.Value;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      return err(domainError.validation({ message: `${FunctionName.Value} only allow 1 param` }));
    }
    for (const [index, param] of params.entries()) {
      if (param && param.type !== CellValueType.String) {
        return err(
          domainError.validation({
            message: `${FunctionName.Value} can't process string type param at ${index + 1}`,
          })
        );
      }
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}
