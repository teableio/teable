import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { CellValueType } from '../../models/field/constant';
import type { TypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';

dayjs.extend(relativeTime);
dayjs.extend(timezone);
dayjs.extend(utc);

abstract class NumericFunc extends FormulaFunc {
  readonly type = FormulaFuncType.Numeric;
}

export class Sum extends NumericFunc {
  name = FunctionName.Sum;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (!params.length) {
      throw new Error(`${FunctionName.Sum} needs at least 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.Sum} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number | null | (number | null)[]>[]): number | null {
    return params.reduce((result, param) => {
      if (param.isMultiple) {
        if (!Array.isArray(param.value)) {
          return result;
        }
        result += param.value
          ? (param.value as (number | null)[]).reduce<number>((r, p) => {
              r += p || 0;
              return r;
            }, 0)
          : 0;
        return result;
      }
      result += (param.value as number) || 0;
      return result;
    }, 0);
  }
}

export class Average extends NumericFunc {
  name = FunctionName.Average;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (!params.length) {
      throw new Error(`${FunctionName.Average} needs at least 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.Average} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number | null | (number | null)[]>[]): number | null {
    let totalValue = 0;
    let totalCount = 0;

    params.forEach((param) => {
      if (param.isMultiple) {
        if (!Array.isArray(param.value)) {
          return;
        }
        totalCount += param.value.length;
        totalValue += param.value
          ? (param.value as (number | null)[]).reduce<number>((r, p) => {
              return r + (p || 0);
            }, 0)
          : 0;
      } else {
        totalCount += 1;
        totalValue += (param.value as number) || 0;
      }
    });

    if (totalCount === 0) return null;

    return totalValue / totalCount;
  }
}

export class Max extends NumericFunc {
  name = FunctionName.Max;

  acceptValueType = new Set([CellValueType.Number, CellValueType.DateTime]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (!params.length) {
      throw new Error(`${FunctionName.Max} needs at least 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type !== CellValueType.Number && param.type !== CellValueType.DateTime) {
        throw new Error(
          `${FunctionName.Max} can only process number or datetime type param at ${i + 1}`
        );
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: params?.[0].type || CellValueType.Number };
  }

  eval(
    params: TypedValue<number | string | null | (number | string | null)[]>[]
  ): number | string | null {
    let max: number | null = null;

    const updateMax = (value: number | string | null) => {
      if (value === null) return;
      const timestamp = typeof value === 'string' ? new Date(value).getTime() : value;
      if (max === null || timestamp > max) {
        max = timestamp;
      }
    };

    params.forEach((param) => {
      if (param.isMultiple && Array.isArray(param.value)) {
        const values = param.value.filter((v): v is string | number => v !== null);
        if (param.type === CellValueType.DateTime) {
          const currentMax = values.reduce(
            (maxDate, v) => {
              const timestamp = new Date(v as string).getTime();
              return maxDate === null || timestamp > maxDate ? timestamp : maxDate;
            },
            null as number | null
          );
          updateMax(currentMax);
        } else {
          updateMax(Math.max(...(values as number[])));
        }
      } else {
        updateMax(param.value as number | string | null);
      }
    });

    if (max === null) return null;
    return params[0].type === CellValueType.DateTime ? new Date(max).toISOString() : max;
  }
}
export class Min extends NumericFunc {
  name = FunctionName.Min;

  acceptValueType = new Set([CellValueType.Number, CellValueType.DateTime]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (!params.length) {
      throw new Error(`${FunctionName.Min} needs at least 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type !== CellValueType.Number && param.type !== CellValueType.DateTime) {
        throw new Error(
          `${FunctionName.Min} can only process number or datetime type param at ${i + 1}`
        );
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: params?.[0].type || CellValueType.Number };
  }

  eval(
    params: TypedValue<number | string | null | (number | string | null)[]>[]
  ): number | string | null {
    let min: number | null = null;

    const updateMin = (value: number | string | null) => {
      if (value === null) return;
      const timestamp = typeof value === 'string' ? new Date(value).getTime() : value;
      if (min === null || timestamp < min) {
        min = timestamp;
      }
    };

    params.forEach((param) => {
      if (param.isMultiple && Array.isArray(param.value)) {
        const values = param.value.filter((v): v is string | number => v !== null);
        if (param.type === CellValueType.DateTime) {
          const currentMin = values.reduce(
            (minDate, v) => {
              const timestamp = new Date(v as string).getTime();
              return minDate === null || timestamp < minDate ? timestamp : minDate;
            },
            null as number | null
          );
          updateMin(currentMin);
        } else {
          updateMin(Math.min(...(values as number[])));
        }
      } else {
        updateMin(param.value as number | string | null);
      }
    });

    if (min === null) return null;
    return params[0].type === CellValueType.DateTime ? new Date(min).toISOString() : min;
  }
}

export class Round extends NumericFunc {
  name = FunctionName.Round;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (!params.length) {
      throw new Error(`${FunctionName.Round} needs at least 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.Round} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number | null>[]): number | null {
    const value = params[0].value;
    if (value == null) return null;
    const precision = params[1]?.value ? Math.floor(params[1].value) : 0;
    const offset = Math.pow(10, precision);
    return Math.round(value * offset) / offset;
  }
}

export class RoundUp extends NumericFunc {
  name = FunctionName.RoundUp;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (!params.length) {
      throw new Error(`${FunctionName.RoundUp} needs at least 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.RoundUp} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number | null>[]): number | null {
    let value = params[0].value;
    if (value == null) return null;
    value = Number(params[0].value);
    const precision = params[1]?.value ? Math.floor(params[1].value) : 0;
    const offset = Math.pow(10, precision);
    const roundFn = value > 0 ? Math.ceil : Math.floor;
    return roundFn(value * offset) / offset;
  }
}

export class RoundDown extends NumericFunc {
  name = FunctionName.RoundDown;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (!params.length) {
      throw new Error(`${FunctionName.RoundDown} needs at least 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.RoundDown} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number | null>[]): number | null {
    let value = params[0].value;
    if (value == null) return null;
    value = Number(params[0].value);
    const precision = params[1]?.value ? Math.floor(params[1].value) : 0;
    const offset = Math.pow(10, precision);
    const roundFn = value > 0 ? Math.floor : Math.ceil;
    return roundFn(value * offset) / offset;
  }
}

export class Ceiling extends NumericFunc {
  name = FunctionName.Ceiling;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (!params.length) {
      throw new Error(`${FunctionName.Ceiling} needs at least 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.Ceiling} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number | null>[]): number | null {
    const value = params[0].value;
    if (value == null) return null;
    const places = params[1]?.value || 0;
    const multiplier = Math.pow(10, places);
    return Math.ceil(value * multiplier) / multiplier;
  }
}

export class Floor extends NumericFunc {
  name = FunctionName.Floor;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (!params.length) {
      throw new Error(`${FunctionName.Floor} needs at least 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.Floor} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number | null>[]): number | null {
    const value = params[0].value;
    if (value == null) return null;
    const places = params[1]?.value || 0;
    const multiplier = Math.pow(10, places);
    return Math.floor(value * multiplier) / multiplier;
  }
}

export class Even extends NumericFunc {
  name = FunctionName.Even;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Even} only allow 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.Even} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number>[]): number | null {
    const value = params[0].value;
    if (value == null) return null;
    const roundedValue = value > 0 ? Math.ceil(value) : Math.floor(value);
    if (roundedValue % 2 === 0) return roundedValue;
    return roundedValue > 0 ? roundedValue + 1 : roundedValue - 1;
  }
}

export class Odd extends NumericFunc {
  name = FunctionName.Odd;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Odd} only allow 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.Odd} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number>[]): number | null {
    const value = params[0].value;
    if (value == null) return null;
    const roundedValue = value > 0 ? Math.ceil(value) : Math.floor(value);
    if (roundedValue % 2 !== 0) return roundedValue;
    return roundedValue >= 0 ? roundedValue + 1 : roundedValue - 1;
  }
}

export class Int extends NumericFunc {
  name = FunctionName.Int;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Int} only allow 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.Int} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number | null>[]): number | null {
    const value = params[0].value;
    if (value == null) return null;
    return Math.floor(value);
  }
}

export class Abs extends NumericFunc {
  name = FunctionName.Abs;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Abs} only allow 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.Abs} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number | null>[]): number | null {
    const value = params[0].value;
    if (value == null) return null;
    return Math.abs(value);
  }
}

export class Sqrt extends NumericFunc {
  name = FunctionName.Sqrt;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Sqrt} only allow 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.Sqrt} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number | null>[]): number | null {
    const value = params[0].value;
    if (value == null) return null;
    return Math.sqrt(value);
  }
}

export class Power extends NumericFunc {
  name = FunctionName.Power;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length < 2) {
      throw new Error(`${FunctionName.Power} needs 2 params`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.Power} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number | null>[]): number | null {
    const value = params[0].value;
    if (value == null) return null;
    const exponent = params[1]?.value || 1;
    return Math.pow(value, exponent);
  }
}

export class Exp extends NumericFunc {
  name = FunctionName.Exp;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Exp} only allow 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.Exp} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number | null>[]): number | null {
    const value = params[0].value;
    if (value == null) return null;
    return Math.exp(value);
  }
}

export class Log extends NumericFunc {
  name = FunctionName.Log;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (!params.length) {
      throw new Error(`${FunctionName.Log} needs at least 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.Log} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number | null>[]): number | null {
    const value = params[0].value;
    if (value == null) return null;
    const base = params[1]?.value || 10;
    return Math.log(value) / Math.log(base);
  }
}

export class Mod extends NumericFunc {
  name = FunctionName.Mod;

  acceptValueType = new Set([CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length < 2) {
      throw new Error(`${FunctionName.Mod} needs 2 params`);
    }
    params.forEach((param, i) => {
      if (param && param.type === CellValueType.String) {
        throw new Error(`${FunctionName.Mod} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<number | null>[]): number | null {
    const value = params[0].value;
    if (value == null) return null;
    const divisor = params[1]?.value || 1;
    const mod = value % divisor;
    return (value ^ divisor) < 0 ? -mod : mod;
  }
}

export class Value extends NumericFunc {
  name = FunctionName.Value;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      throw new Error(`${FunctionName.Value} only allow 1 param`);
    }
    params.forEach((param, i) => {
      if (param && param.type !== CellValueType.String) {
        throw new Error(`${FunctionName.Value} can't process string type param at ${i + 1}`);
      }
    });
  }

  getReturnType(params?: TypedValue[]) {
    params && this.validateParams(params);
    return { type: CellValueType.Number };
  }

  eval(params: TypedValue<string | null>[]): number | null {
    let value = params[0].value;
    if (value == null) return null;
    const numberReg = /[^\d.+-]/g;
    const symbolReg = /([+\-.])+/g;
    value = String(value).replace(numberReg, '').replace(symbolReg, '$1');
    return parseFloat(value);
  }
}
