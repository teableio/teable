import { isNumber, isString } from 'lodash';
import { CellValueType } from '../../models/field/constant';
import type { TypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';

export const convertValueToString = (
  param?: TypedValue<string | number | boolean | null | (string | number | boolean | null)[]>,
  separator = ', '
): string | null => {
  const { value, isMultiple } = param || {};

  if (value == null) return null;
  if (isMultiple && Array.isArray(value)) return value.join(separator);
  return String(value);
};

abstract class TextFunc extends FormulaFunc {
  readonly type = FormulaFuncType.Text;
}

export class Concatenate extends TextFunc {
  name = FunctionName.Concatenate;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      throw new Error(`${FunctionName.Concatenate} needs at least 1 param`);
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
        result += param.value.join(', ');
        return result;
      }
      result += (param.value as string) || '';
      return result;
    }, '');
  }
}

export class Find extends TextFunc {
  name = FunctionName.Find;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      throw new Error(`${FunctionName.Find} needs at least 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<string | number | null | (string | number | null)[]>[]): number | null {
    const findString = params[0].value;
    const targetString = convertValueToString(params[1]);

    if (findString == null || targetString == null) return null;

    let startPosition = params[2]?.value ?? 0;
    startPosition = isNumber(startPosition) && startPosition > 0 ? startPosition - 1 : 0;
    return String(targetString).indexOf(String(findString), startPosition) + 1;
  }
}

export class Search extends TextFunc {
  name = FunctionName.Search;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      throw new Error(`${FunctionName.Search} needs at least 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<string | number | null | (string | number | null)[]>[]): number | null {
    const findString = params[0].value;
    const targetString = convertValueToString(params[1]);
    let startPosition = params[2]?.value ?? 0;

    if (findString == null || targetString == null) return null;

    startPosition = isNumber(startPosition) && startPosition > 0 ? startPosition - 1 : 0;
    const position = String(targetString).indexOf(String(findString), startPosition) + 1;
    return position === 0 ? null : position;
  }
}

export class Mid extends TextFunc {
  name = FunctionName.Mid;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 3) {
      throw new Error(`${FunctionName.Mid} needs at least 3 params`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | number | null | (string | number | null)[]>[]): string | null {
    const targetString = convertValueToString(params[0]);

    if (targetString == null) return null;

    const startPosition = Number(params[1]?.value ?? 0);
    const truncateCount = Number(params[2]?.value ?? targetString.length);
    return targetString.slice(startPosition, startPosition + truncateCount);
  }
}

export class Left extends TextFunc {
  name = FunctionName.Left;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      throw new Error(`${FunctionName.Left} needs at least 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | number | null | (string | number | null)[]>[]): string | null {
    const value = convertValueToString(params[0]);

    if (value == null) return null;

    const truncateCount = Number(params[1]?.value ?? 1);
    return String(value).substring(0, truncateCount);
  }
}

export class Right extends TextFunc {
  name = FunctionName.Right;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      throw new Error(`${FunctionName.Right} needs at least 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | number | null | (string | number | null)[]>[]): string | null {
    const value = convertValueToString(params[0]);

    if (value == null) return null;

    const truncateCount = Number(params[1]?.value ?? 1);
    const startPosition = value.length - truncateCount;
    return value.substring(startPosition);
  }
}

export class Replace extends TextFunc {
  name = FunctionName.Replace;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 4) {
      throw new Error(`${FunctionName.Replace} needs at least 4 params`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | number | null | (string | number | null)[]>[]): string | null {
    const targetString = convertValueToString(params[0]);

    if (targetString == null) return null;

    const startPosition = Number(params[1]?.value ?? 0);
    const truncateCount = Number(params[2]?.value ?? targetString.length);
    const replaceStr = String(params[3]?.value ?? '');

    if (targetString.length <= startPosition) return targetString + replaceStr;

    return (
      targetString.substring(0, startPosition - 1) +
      replaceStr +
      targetString.substring(startPosition + truncateCount - 1)
    );
  }
}

export class RegExpReplace extends TextFunc {
  name = FunctionName.RegExpReplace;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 3) {
      throw new Error(`${FunctionName.RegExpReplace} needs at least 3 params`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | null | (string | null)[]>[]): string | null {
    const text = convertValueToString(params[0]);
    if (text == null) return null;
    const pattern = params[1].value ? String(params[1].value) : '';
    const replacement = params[2].value ? String(params[2].value) : '';
    const regex = new RegExp(pattern, 'g');
    return text.replace(regex, replacement);
  }
}

export class Substitute extends TextFunc {
  name = FunctionName.Substitute;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 3) {
      throw new Error(`${FunctionName.Substitute} needs at least 3 params`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | number | null | (string | number | null)[]>[]): string | null {
    const targetString = convertValueToString(params[0]);

    if (targetString == null) return null;

    const oldString = String(params[1]?.value ?? '');
    const newString = String(params[2]?.value ?? '');
    const index = Number(params[3]?.value ?? 0) - 1;
    const splitStringArray = targetString.split(oldString);

    if (index > splitStringArray.length - 2) return targetString;
    if (index > 0) {
      const substituter = [splitStringArray[index], splitStringArray[index + 1]].join(newString);
      splitStringArray.splice(index, 2, substituter);
      return splitStringArray.join(oldString);
    }
    return splitStringArray.join(newString);
  }
}

export class Lower extends TextFunc {
  name = FunctionName.Lower;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Lower} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | null | (string | null)[]>[]): string | null {
    const value = convertValueToString(params[0]);

    if (value == null) return null;

    return String(value).toLowerCase();
  }
}

export class Upper extends TextFunc {
  name = FunctionName.Upper;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Upper} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | null | (string | null)[]>[]): string | null {
    const value = convertValueToString(params[0]);

    if (value == null) return null;

    return String(value).toUpperCase();
  }
}

export class Rept extends TextFunc {
  name = FunctionName.Rept;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 2) {
      throw new Error(`${FunctionName.Rept} needs at least 2 params`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | number | null | (string | number | null)[]>[]): string | null {
    const value = convertValueToString(params[0]);

    if (value == null) return null;

    const count = Number(params[1]?.value ?? 0);
    if (count === 0) return null;
    return String(value).repeat(count);
  }
}

export class Trim extends TextFunc {
  name = FunctionName.Trim;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Trim} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | null | (string | null)[]>[]): string | null {
    const value = convertValueToString(params[0]);

    if (value == null) return null;

    return String(value).trim();
  }
}

export class T extends TextFunc {
  name = FunctionName.T;

  acceptValueType = new Set([
    CellValueType.String,
    CellValueType.Number,
    CellValueType.Boolean,
    CellValueType.DateTime,
  ]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.T} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(
    params: TypedValue<string | number | boolean | null | (string | number | boolean | null)[]>[]
  ): string | null {
    const { value, isMultiple } = params[0];

    if (isMultiple && Array.isArray(value)) {
      if (value.some((v) => v != null && !isString(v))) return null;
      return value.filter(Boolean).join(', ');
    }
    return isString(value) ? value : null;
  }
}

export class Len extends TextFunc {
  name = FunctionName.Len;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Len} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<string | null | (string | null)[]>[]): number | null {
    const value = convertValueToString(params[0]);

    if (value == null) return null;

    return String(value).length;
  }
}

export class EncodeUrlComponent extends TextFunc {
  name = FunctionName.EncodeUrlComponent;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.EncodeUrlComponent} only allow 1 param`);
    }
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.String };
  }

  eval(params: TypedValue<string | null | (string | null)[]>[]): string | null {
    const value = convertValueToString(params[0]);

    if (value == null) return null;

    return encodeURIComponent(value);
  }
}
