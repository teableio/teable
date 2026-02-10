import { err, ok } from 'neverthrow';

import { domainError } from '../../shared/DomainError';
import { CellValueType } from '../CellValueType';
import type { TypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';

abstract class ArrayFunc extends FormulaFunc {
  readonly type = FormulaFuncType.Array;
}

const getUnionReturnType = (params: TypedValue[]) => {
  if (!params.length) {
    return { type: CellValueType.String, isMultiple: true };
  }
  const firstType = params[0].type;
  const isAllSameType = params.every((param) => param.type === firstType);
  return {
    type: isAllSameType ? firstType : CellValueType.String,
    isMultiple: true,
  };
};

export class CountAll extends ArrayFunc {
  name = FunctionName.CountAll;

  acceptValueType = new Set([
    CellValueType.Boolean,
    CellValueType.DateTime,
    CellValueType.Number,
    CellValueType.String,
  ]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      return err(domainError.validation({ message: `${FunctionName.CountAll} needs 1 param` }));
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class CountA extends ArrayFunc {
  name = FunctionName.CountA;

  acceptValueType = new Set([
    CellValueType.Boolean,
    CellValueType.DateTime,
    CellValueType.Number,
    CellValueType.String,
  ]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      return err(
        domainError.validation({ message: `${FunctionName.CountA} needs at least 1 param` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Count extends ArrayFunc {
  name = FunctionName.Count;

  acceptValueType = new Set([
    CellValueType.Boolean,
    CellValueType.DateTime,
    CellValueType.Number,
    CellValueType.String,
  ]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      return err(
        domainError.validation({ message: `${FunctionName.Count} needs at least 1 param` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class ArrayJoin extends ArrayFunc {
  name = FunctionName.ArrayJoin;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      return err(
        domainError.validation({ message: `${FunctionName.ArrayJoin} needs at least 1 param` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class ArrayUnique extends ArrayFunc {
  name = FunctionName.ArrayUnique;

  acceptValueType = new Set([
    CellValueType.Boolean,
    CellValueType.DateTime,
    CellValueType.Number,
    CellValueType.String,
  ]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      return err(
        domainError.validation({ message: `${FunctionName.ArrayUnique} needs at least 1 param` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok(getUnionReturnType([]));
    return this.validateParams(params).map(() => getUnionReturnType(params));
  }
}

export class ArrayFlatten extends ArrayFunc {
  name = FunctionName.ArrayFlatten;

  acceptValueType = new Set([
    CellValueType.Boolean,
    CellValueType.DateTime,
    CellValueType.Number,
    CellValueType.String,
  ]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      return err(
        domainError.validation({ message: `${FunctionName.ArrayFlatten} needs at least 1 param` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok(getUnionReturnType([]));
    return this.validateParams(params).map(() => getUnionReturnType(params));
  }
}

export class ArrayCompact extends ArrayFunc {
  name = FunctionName.ArrayCompact;

  acceptValueType = new Set([
    CellValueType.Boolean,
    CellValueType.DateTime,
    CellValueType.Number,
    CellValueType.String,
  ]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      return err(
        domainError.validation({ message: `${FunctionName.ArrayCompact} needs at least 1 param` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok(getUnionReturnType([]));
    return this.validateParams(params).map(() => getUnionReturnType(params));
  }
}
