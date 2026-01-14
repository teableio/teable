import { err, ok } from 'neverthrow';

import { domainError } from '../../shared/DomainError';
import { CellValueType } from '../CellValueType';
import type { TypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';

abstract class DateTimeFunc extends FormulaFunc {
  readonly type = FormulaFuncType.DateTime;
}

const requireExact = (fnName: FunctionName, params: TypedValue[], count: number) => {
  if (params.length !== count) {
    return err(domainError.validation({ message: `${fnName} only allow ${count} param` }));
  }
  return ok(undefined);
};

const requireAtLeast = (fnName: FunctionName, params: TypedValue[], count: number) => {
  if (params.length < count) {
    return err(domainError.validation({ message: `${fnName} needs at least ${count} params` }));
  }
  return ok(undefined);
};

export class Today extends DateTimeFunc {
  name = FunctionName.Today;

  acceptValueType = new Set([]);

  acceptMultipleValue = false;

  validateParams(_: TypedValue[]): ReturnType<FormulaFunc['validateParams']> {
    return ok(undefined);
  }

  getReturnType() {
    return ok({ type: CellValueType.DateTime });
  }
}

export class Now extends DateTimeFunc {
  name = FunctionName.Now;

  acceptValueType = new Set([]);

  acceptMultipleValue = false;

  validateParams(_: TypedValue[]): ReturnType<FormulaFunc['validateParams']> {
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.DateTime });
    return this.validateParams(params).map(() => ({ type: CellValueType.DateTime }));
  }
}

export class Year extends DateTimeFunc {
  name = FunctionName.Year;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireExact(FunctionName.Year, params, 1);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Month extends DateTimeFunc {
  name = FunctionName.Month;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireExact(FunctionName.Month, params, 1);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class WeekNum extends DateTimeFunc {
  name = FunctionName.WeekNum;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireExact(FunctionName.WeekNum, params, 1);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Weekday extends DateTimeFunc {
  name = FunctionName.Weekday;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireAtLeast(FunctionName.Weekday, params, 1);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Day extends DateTimeFunc {
  name = FunctionName.Day;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireExact(FunctionName.Day, params, 1);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Hour extends DateTimeFunc {
  name = FunctionName.Hour;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireExact(FunctionName.Hour, params, 1);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Minute extends DateTimeFunc {
  name = FunctionName.Minute;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireExact(FunctionName.Minute, params, 1);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Second extends DateTimeFunc {
  name = FunctionName.Second;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireExact(FunctionName.Second, params, 1);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class FromNow extends DateTimeFunc {
  name = FunctionName.FromNow;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String, CellValueType.Boolean]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireAtLeast(FunctionName.FromNow, params, 2);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class ToNow extends FromNow {
  name = FunctionName.ToNow;

  validateParams(params: TypedValue[]) {
    return requireAtLeast(FunctionName.ToNow, params, 2);
  }
}

export class DatetimeDiff extends DateTimeFunc {
  name = FunctionName.DatetimeDiff;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String, CellValueType.Boolean]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireAtLeast(FunctionName.DatetimeDiff, params, 2);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Workday extends DateTimeFunc {
  name = FunctionName.Workday;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireAtLeast(FunctionName.Workday, params, 2);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.DateTime });
    return this.validateParams(params).map(() => ({ type: CellValueType.DateTime }));
  }
}

export class WorkdayDiff extends DateTimeFunc {
  name = FunctionName.WorkdayDiff;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireAtLeast(FunctionName.WorkdayDiff, params, 2);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class IsSame extends DateTimeFunc {
  name = FunctionName.IsSame;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireAtLeast(FunctionName.IsSame, params, 2);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Boolean });
    return this.validateParams(params).map(() => ({ type: CellValueType.Boolean }));
  }
}

export class IsAfter extends DateTimeFunc {
  name = FunctionName.IsAfter;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireAtLeast(FunctionName.IsAfter, params, 2);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Boolean });
    return this.validateParams(params).map(() => ({ type: CellValueType.Boolean }));
  }
}

export class IsBefore extends DateTimeFunc {
  name = FunctionName.IsBefore;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireAtLeast(FunctionName.IsBefore, params, 2);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Boolean });
    return this.validateParams(params).map(() => ({ type: CellValueType.Boolean }));
  }
}

export class DateAdd extends DateTimeFunc {
  name = FunctionName.DateAdd;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireAtLeast(FunctionName.DateAdd, params, 3);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.DateTime });
    return this.validateParams(params).map(() => ({ type: CellValueType.DateTime }));
  }
}

export class Datestr extends DateTimeFunc {
  name = FunctionName.Datestr;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireExact(FunctionName.Datestr, params, 1);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class Timestr extends DateTimeFunc {
  name = FunctionName.Timestr;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireExact(FunctionName.Timestr, params, 1);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class DatetimeFormat extends DateTimeFunc {
  name = FunctionName.DatetimeFormat;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireAtLeast(FunctionName.DatetimeFormat, params, 1);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class DatetimeParse extends DateTimeFunc {
  name = FunctionName.DatetimeParse;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireAtLeast(FunctionName.DatetimeParse, params, 1);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.DateTime });
    return this.validateParams(params).map(() => ({ type: CellValueType.DateTime }));
  }
}

export class SetLocale extends DateTimeFunc {
  name = FunctionName.SetLocale;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireExact(FunctionName.SetLocale, params, 2);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.DateTime });
    return this.validateParams(params).map(() => ({ type: CellValueType.DateTime }));
  }
}

export class SetTimezone extends DateTimeFunc {
  name = FunctionName.SetTimezone;

  acceptValueType = new Set([CellValueType.DateTime, CellValueType.String]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    return requireExact(FunctionName.SetTimezone, params, 2);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.DateTime });
    return this.validateParams(params).map(() => ({ type: CellValueType.DateTime }));
  }
}

export class CreatedTime extends DateTimeFunc {
  name = FunctionName.CreatedTime;

  acceptValueType = new Set([CellValueType.DateTime]);

  acceptMultipleValue = false;

  validateParams(_: TypedValue[]): ReturnType<FormulaFunc['validateParams']> {
    return ok(undefined);
  }

  getReturnType() {
    return ok({ type: CellValueType.DateTime });
  }
}

export class LastModifiedTime extends DateTimeFunc {
  name = FunctionName.LastModifiedTime;

  acceptValueType = new Set([
    CellValueType.String,
    CellValueType.Number,
    CellValueType.Boolean,
    CellValueType.DateTime,
  ]);

  acceptMultipleValue = false;

  validateParams(params: TypedValue[]) {
    if (!params.length) return ok(undefined);
    if (params.some((param) => !param?.field)) {
      return err(
        domainError.validation({
          message: `${FunctionName.LastModifiedTime} parameter must be a field reference`,
        })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.DateTime });
    return this.validateParams(params).map(() => ({ type: CellValueType.DateTime }));
  }
}
