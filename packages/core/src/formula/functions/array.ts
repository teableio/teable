import { isNumber, isString } from 'lodash';
import { CellValueType } from '../../models/field/constant';
import type { TypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';
import { convertValueToString } from './text';

abstract class ArrayFunc extends FormulaFunc {
  readonly type = FormulaFuncType.Array;
}

type IUnionType = string | number | boolean | null | IUnionType[];

const countCalculator = (
  params: TypedValue<IUnionType>[],
  calcFn: (v: IUnionType) => boolean
): number => {
  return params.reduce((result, param) => {
    if (param.isMultiple) {
      if (!Array.isArray(param.value) || param.value === null) {
        return calcFn(param.value) ? result + 1 : result;
      }
      result += param.value.reduce((pre: number, v: IUnionType) => {
        if (!Array.isArray(v)) {
          return calcFn(v) ? pre + 1 : pre;
        }
        pre += v.filter(calcFn).length;
        return pre;
      }, 0);
      return result;
    }

    return calcFn(param.value) ? result + 1 : result;
  }, 0);
};

const flatten = (arr: IUnionType[]) => {
  let result: IUnionType[] = [];

  for (const item of arr) {
    if (item !== null) {
      if (Array.isArray(item)) {
        result = result.concat(flatten(item));
      } else {
        result.push(item);
      }
    }
  }
  return result;
};

const flattenParams = (params: TypedValue<IUnionType>[]) => {
  return params.reduce((prev: IUnionType[], item) => {
    const value = item.value;
    if (value == null) return prev;
    return prev.concat(Array.isArray(value) ? flatten(value) : value);
  }, []);
};

const getUnionReturnType = (params: TypedValue[]) => {
  if (!params?.length) return { type: CellValueType.String, isMultiple: true };

  const firstCellValueType = params[0].type;
  const isAllSameType = params.every((param) => param.type === firstCellValueType);

  return {
    type: isAllSameType ? firstCellValueType : CellValueType.String,
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
      throw new Error(`${FunctionName.CountAll} needs 1 param`);
    }
  }

  getReturnType(params: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<IUnionType>[]): number {
    if (params[0].value == null) {
      return 0;
    }
    if (Array.isArray(params[0].value)) {
      return params[0].value.length;
    }
    return 1;
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
      throw new Error(`${FunctionName.CountA} needs at least 1 param`);
    }
  }

  getReturnType(params: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<IUnionType>[]): number {
    return countCalculator(params, (v) => isNumber(v) || (isString(v) && v !== ''));
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
      throw new Error(`${FunctionName.Count} needs at least 1 param`);
    }
  }

  getReturnType(params: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<IUnionType>[]): number {
    return countCalculator(params, isNumber);
  }
}

export class ArrayJoin extends ArrayFunc {
  name = FunctionName.ArrayJoin;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      throw new Error(`${FunctionName.ArrayJoin} needs at least 1 param`);
    }
  }

  getReturnType(params: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | null | (string | null)[]>[]): string | null {
    let separator = params[1]?.value;
    separator = isString(separator) ? separator : ', ';
    return convertValueToString(params[0], separator);
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
      throw new Error(`${FunctionName.ArrayUnique} needs at least 1 param`);
    }
  }

  getReturnType(params: TypedValue[]) {
    params && this.validateParams(params);
    return getUnionReturnType(params);
  }

  eval(params: TypedValue<IUnionType>[]): IUnionType | null {
    const flattenArray = flattenParams(params);
    const uniqueArray = [...new Set(flattenArray)];
    return uniqueArray.length ? uniqueArray : null;
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
      throw new Error(`${FunctionName.ArrayFlatten} needs at least 1 param`);
    }
  }

  getReturnType(params: TypedValue[]) {
    params && this.validateParams(params);
    return getUnionReturnType(params);
  }

  eval(params: TypedValue<IUnionType>[]): IUnionType | null {
    const flattenArray = flattenParams(params);
    return flattenArray.length ? flattenArray : null;
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
      throw new Error(`${FunctionName.ArrayCompact} needs at least 1 param`);
    }
  }

  getReturnType(params: TypedValue[]) {
    params && this.validateParams(params);
    return getUnionReturnType(params);
  }

  eval(params: TypedValue<IUnionType>[]): IUnionType | null {
    const flattenArray = flattenParams(params);
    const filteredArray = flattenArray.filter((v) => v !== '');
    return filteredArray.length ? filteredArray : null;
  }
}
