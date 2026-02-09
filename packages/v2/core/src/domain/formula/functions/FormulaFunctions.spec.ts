import { describe, expect, it } from 'vitest';

import { CellValueType } from '../CellValueType';
import type { FormulaFieldReference } from '../FormulaFieldReference';
import { TypedValue } from '../typed-value';
import {
  ArrayCompact,
  ArrayFlatten,
  ArrayJoin,
  ArrayUnique,
  Count,
  CountA,
  CountAll,
} from './array';
import {
  CreatedTime,
  DateAdd,
  Datestr,
  DatetimeDiff,
  DatetimeFormat,
  DatetimeParse,
  Day,
  FromNow,
  Hour,
  IsAfter,
  IsBefore,
  IsSame,
  LastModifiedTime,
  Minute,
  Month,
  Now,
  Second,
  Timestr,
  ToNow,
  Today,
  WeekNum,
  Weekday,
  Workday,
  WorkdayDiff,
  Year,
} from './date-time';
import { And, Blank, FormulaError, If, IsError, Not, Or, Switch, Xor } from './logical';
import {
  Abs,
  Average,
  Ceiling,
  Even,
  Exp,
  Floor,
  Int,
  Log,
  Max,
  Min,
  Mod,
  Odd,
  Power,
  Round,
  RoundDown,
  RoundUp,
  Sqrt,
  Sum,
  Value,
} from './numeric';
import { AutoNumber, RecordId, TextAll } from './system';
import {
  Concatenate,
  EncodeUrlComponent,
  Find,
  Left,
  Len,
  Lower,
  Mid,
  RegExpReplace,
  Replace,
  Rept,
  Right,
  Search,
  Substitute,
  T,
  Trim,
  Upper,
} from './text';

const valueOf = (
  type: CellValueType,
  options?: { isMultiple?: boolean; isBlank?: boolean; field?: FormulaFieldReference }
) => new TypedValue(null, type, options?.isMultiple, options?.field, options?.isBlank);

const stringValue = valueOf(CellValueType.String);
const numberValue = valueOf(CellValueType.Number);
const booleanValue = valueOf(CellValueType.Boolean);
const dateValue = valueOf(CellValueType.DateTime);

describe('formula functions', () => {
  describe('array functions', () => {
    it('validates count function params', () => {
      const countAll = new CountAll();
      countAll.validateParams([])._unsafeUnwrapErr();
      countAll.validateParams([stringValue])._unsafeUnwrap();
      countAll.getReturnType()._unsafeUnwrap();
      countAll.getReturnType([stringValue])._unsafeUnwrap();

      const countA = new CountA();
      countA.validateParams([])._unsafeUnwrapErr();
      countA.validateParams([stringValue])._unsafeUnwrap();
      countA.getReturnType()._unsafeUnwrap();
      countA.getReturnType([stringValue])._unsafeUnwrap();

      const count = new Count();
      count.validateParams([])._unsafeUnwrapErr();
      count.validateParams([stringValue])._unsafeUnwrap();
      count.getReturnType()._unsafeUnwrap();
      count.getReturnType([stringValue])._unsafeUnwrap();
    });

    it('validates array string functions', () => {
      const arrayJoin = new ArrayJoin();
      arrayJoin.validateParams([])._unsafeUnwrapErr();
      arrayJoin.validateParams([stringValue])._unsafeUnwrap();
      arrayJoin.getReturnType()._unsafeUnwrap();
      arrayJoin.getReturnType([stringValue])._unsafeUnwrap();
    });

    it('infers union return types', () => {
      const unionFunctions = [new ArrayUnique(), new ArrayFlatten(), new ArrayCompact()];
      for (const func of unionFunctions) {
        func.validateParams([])._unsafeUnwrapErr();
        func.validateParams([stringValue])._unsafeUnwrap();

        const empty = func.getReturnType();
        const emptyValue = empty._unsafeUnwrap();
        expect(emptyValue.isMultiple).toBe(true);

        const same = func.getReturnType([numberValue, numberValue]);
        const sameValue = same._unsafeUnwrap();
        expect(sameValue.type).toBe(CellValueType.Number);
        expect(sameValue.isMultiple).toBe(true);

        const mixed = func.getReturnType([numberValue, stringValue]);
        const mixedValue = mixed._unsafeUnwrap();
        expect(mixedValue.type).toBe(CellValueType.String);
        expect(mixedValue.isMultiple).toBe(true);
      }
    });
  });

  describe('numeric functions', () => {
    it('validates numeric-only functions', () => {
      const numericOnly = [
        new Sum(),
        new Average(),
        new Round(),
        new RoundUp(),
        new RoundDown(),
        new Ceiling(),
        new Floor(),
        new Even(),
        new Odd(),
        new Int(),
        new Abs(),
        new Log(),
      ];

      numericOnly[0].validateParams([])._unsafeUnwrapErr();
      numericOnly[0].validateParams([stringValue])._unsafeUnwrapErr();

      for (const func of numericOnly) {
        func.validateParams([numberValue])._unsafeUnwrap();
        func.getReturnType()._unsafeUnwrap();
        func.getReturnType([numberValue])._unsafeUnwrap();
      }
    });

    it('validates max and min type rules', () => {
      const max = new Max();
      max.validateParams([stringValue])._unsafeUnwrapErr();
      max.validateParams([dateValue])._unsafeUnwrap();
      const maxReturn = max.getReturnType([dateValue]);
      const maxValue = maxReturn._unsafeUnwrap();
      expect(maxValue.type).toBe(CellValueType.DateTime);

      const min = new Min();
      min.validateParams([booleanValue])._unsafeUnwrapErr();
      min.validateParams([numberValue])._unsafeUnwrap();
      const minReturn = min.getReturnType([numberValue]);
      const minValue = minReturn._unsafeUnwrap();
      expect(minValue.type).toBe(CellValueType.Number);
    });

    it('validates length-constrained numeric functions', () => {
      const sqrt = new Sqrt();
      sqrt.validateParams([])._unsafeUnwrapErr();
      sqrt.validateParams([stringValue])._unsafeUnwrapErr();
      sqrt.validateParams([numberValue])._unsafeUnwrap();

      const exp = new Exp();
      exp.validateParams([])._unsafeUnwrapErr();
      exp.validateParams([numberValue])._unsafeUnwrap();

      const power = new Power();
      power.validateParams([numberValue])._unsafeUnwrapErr();
      power.validateParams([numberValue, numberValue])._unsafeUnwrap();

      const mod = new Mod();
      mod.validateParams([numberValue])._unsafeUnwrapErr();
      mod.validateParams([numberValue, numberValue])._unsafeUnwrap();

      const value = new Value();
      value.validateParams([])._unsafeUnwrapErr();
      value.validateParams([numberValue])._unsafeUnwrapErr();
      value.validateParams([stringValue])._unsafeUnwrap();
    });
  });

  describe('logical functions', () => {
    it('infers return types for IF', () => {
      const func = new If();
      func.validateParams([booleanValue, stringValue])._unsafeUnwrapErr();

      const blankThen = func.getReturnType([
        booleanValue,
        valueOf(CellValueType.String, { isBlank: true }),
        numberValue,
      ]);
      const blankThenValue = blankThen._unsafeUnwrap();
      expect(blankThenValue.type).toBe(CellValueType.Number);

      const blankElse = func.getReturnType([
        booleanValue,
        stringValue,
        valueOf(CellValueType.Number, { isBlank: true }),
      ]);
      const blankElseValue = blankElse._unsafeUnwrap();
      expect(blankElseValue.type).toBe(CellValueType.String);

      const sameType = func.getReturnType([
        booleanValue,
        valueOf(CellValueType.String, { isMultiple: true }),
        valueOf(CellValueType.String, { isMultiple: true }),
      ]);
      const sameTypeValue = sameType._unsafeUnwrap();
      expect(sameTypeValue.type).toBe(CellValueType.String);
      const sameTypeMultiple = 'isMultiple' in sameTypeValue ? sameTypeValue.isMultiple : undefined;
      expect(sameTypeMultiple).toBe(true);

      const mismatch = func.getReturnType([booleanValue, stringValue, numberValue]);
      const mismatchValue = mismatch._unsafeUnwrap();
      expect(mismatchValue.type).toBe(CellValueType.String);
    });

    it('infers return types for SWITCH', () => {
      const func = new Switch();
      func.validateParams([stringValue])._unsafeUnwrapErr();

      const short = func.getReturnType([stringValue, numberValue]);
      const shortValue = short._unsafeUnwrap();
      expect(shortValue.type).toBe(CellValueType.Number);

      const detailed = func.getReturnType([
        stringValue,
        stringValue,
        valueOf(CellValueType.Number, { isMultiple: true }),
        booleanValue,
        valueOf(CellValueType.String, { isMultiple: false }),
        valueOf(CellValueType.Number, { isMultiple: false }),
      ]);
      const detailedValue = detailed._unsafeUnwrap();
      expect(detailedValue.type).toBe(CellValueType.String);
      const detailedMultiple = 'isMultiple' in detailedValue ? detailedValue.isMultiple : undefined;
      expect(detailedMultiple).toBe(false);
    });

    it('validates boolean combinators', () => {
      const and = new And();
      and.validateParams([])._unsafeUnwrapErr();
      and.validateParams([booleanValue])._unsafeUnwrap();

      const or = new Or();
      or.validateParams([])._unsafeUnwrapErr();
      or.validateParams([booleanValue])._unsafeUnwrap();

      const xor = new Xor();
      xor.validateParams([])._unsafeUnwrapErr();
      xor.validateParams([booleanValue])._unsafeUnwrap();
      xor.getReturnType()._unsafeUnwrap();
      xor.getReturnType([booleanValue])._unsafeUnwrap();

      const not = new Not();
      not.validateParams([booleanValue, booleanValue])._unsafeUnwrapErr();
      not.validateParams([booleanValue])._unsafeUnwrap();
      not.getReturnType()._unsafeUnwrap();
      not.getReturnType([booleanValue])._unsafeUnwrap();

      const blank = new Blank();
      blank.validateParams([])._unsafeUnwrap();
      blank.getReturnType()._unsafeUnwrap();

      const formulaError = new FormulaError();
      formulaError.validateParams([])._unsafeUnwrap();
      formulaError.getReturnType()._unsafeUnwrap();

      const isError = new IsError();
      isError.validateParams([stringValue, stringValue])._unsafeUnwrapErr();
      isError.validateParams([stringValue])._unsafeUnwrap();
    });
  });

  describe('text functions', () => {
    it('validates at-least-one text functions', () => {
      const atLeastOne = [new Concatenate(), new Find(), new Search(), new Left(), new Right()];
      for (const func of atLeastOne) {
        func.validateParams([])._unsafeUnwrapErr();
        func.validateParams([stringValue])._unsafeUnwrap();
        func.getReturnType()._unsafeUnwrap();
        func.getReturnType([stringValue])._unsafeUnwrap();
      }
    });

    it('validates text functions with longer signatures', () => {
      const mid = new Mid();
      mid.validateParams([stringValue, numberValue])._unsafeUnwrapErr();
      mid.validateParams([stringValue, numberValue, numberValue])._unsafeUnwrap();

      const replace = new Replace();
      replace.validateParams([stringValue, numberValue, stringValue])._unsafeUnwrapErr();
      replace.validateParams([stringValue, numberValue, numberValue, stringValue])._unsafeUnwrap();

      const regExpReplace = new RegExpReplace();
      regExpReplace.validateParams([stringValue, stringValue])._unsafeUnwrapErr();
      regExpReplace.validateParams([stringValue, stringValue, stringValue])._unsafeUnwrap();

      const substitute = new Substitute();
      substitute.validateParams([stringValue, stringValue])._unsafeUnwrapErr();
      substitute.validateParams([stringValue, stringValue, stringValue])._unsafeUnwrap();

      const rept = new Rept();
      rept.validateParams([stringValue])._unsafeUnwrapErr();
      rept.validateParams([stringValue, numberValue])._unsafeUnwrap();
    });

    it('validates exact-length text functions', () => {
      const exact = [
        new Lower(),
        new Upper(),
        new Trim(),
        new T(),
        new Len(),
        new EncodeUrlComponent(),
      ];

      for (const func of exact) {
        func.validateParams([stringValue, stringValue])._unsafeUnwrapErr();
        func.validateParams([stringValue])._unsafeUnwrap();
        func.getReturnType()._unsafeUnwrap();
        func.getReturnType([stringValue])._unsafeUnwrap();
      }
    });
  });

  describe('date-time functions', () => {
    it('validates exact-length date-time functions', () => {
      const exact = [
        new Year(),
        new Month(),
        new WeekNum(),
        new Day(),
        new Hour(),
        new Minute(),
        new Second(),
        new Datestr(),
        new Timestr(),
      ];

      for (const func of exact) {
        func.validateParams([])._unsafeUnwrapErr();
        func.validateParams([dateValue])._unsafeUnwrap();
        func.getReturnType()._unsafeUnwrap();
        func.getReturnType([dateValue])._unsafeUnwrap();
      }
    });

    it('validates minimum-length date-time functions', () => {
      const atLeast = [
        { func: new Weekday(), params: [dateValue] },
        { func: new FromNow(), params: [dateValue, stringValue] },
        { func: new ToNow(), params: [dateValue, stringValue] },
        { func: new DatetimeDiff(), params: [dateValue, dateValue] },
        { func: new Workday(), params: [dateValue, numberValue] },
        { func: new WorkdayDiff(), params: [dateValue, dateValue] },
        { func: new IsSame(), params: [dateValue, dateValue] },
        { func: new IsAfter(), params: [dateValue, dateValue] },
        { func: new IsBefore(), params: [dateValue, dateValue] },
        { func: new DateAdd(), params: [dateValue, numberValue, stringValue] },
        { func: new DatetimeFormat(), params: [dateValue] },
        { func: new DatetimeParse(), params: [stringValue] },
      ];

      for (const { func, params } of atLeast) {
        func.validateParams([])._unsafeUnwrapErr();
        func.validateParams(params)._unsafeUnwrap();
        func.getReturnType()._unsafeUnwrap();
        func.getReturnType(params)._unsafeUnwrap();
      }
    });

    it('handles system-provided date-time functions', () => {
      const today = new Today();
      today.validateParams([])._unsafeUnwrap();
      today.getReturnType()._unsafeUnwrap();

      const now = new Now();
      now.validateParams([])._unsafeUnwrap();
      now.getReturnType()._unsafeUnwrap();
      now.getReturnType([dateValue])._unsafeUnwrap();

      const created = new CreatedTime();
      created.validateParams([])._unsafeUnwrap();
      created.getReturnType()._unsafeUnwrap();
    });

    it('validates last modified time params', () => {
      const fieldRef: FormulaFieldReference = {
        id: `fld${'b'.repeat(16)}`,
        cellValueType: CellValueType.Number,
        isMultipleCellValue: false,
      };
      const withField = valueOf(CellValueType.Number, { field: fieldRef });
      const func = new LastModifiedTime();

      func.validateParams([])._unsafeUnwrap();
      func.validateParams([numberValue])._unsafeUnwrapErr();
      func.validateParams([withField])._unsafeUnwrap();
      func.getReturnType([withField])._unsafeUnwrap();
    });
  });

  describe('system functions', () => {
    it('infers TextAll return type', () => {
      const func = new TextAll();
      func.validateParams([])._unsafeUnwrapErr();
      func.validateParams([stringValue])._unsafeUnwrap();
      func.getReturnType()._unsafeUnwrap();

      const multiple = func.getReturnType([valueOf(CellValueType.String, { isMultiple: true })]);
      const multipleValue = multiple._unsafeUnwrap();
      const multipleResult = 'isMultiple' in multipleValue ? multipleValue.isMultiple : undefined;
      expect(multipleResult).toBe(true);

      const single = func.getReturnType([stringValue]);
      const singleValue = single._unsafeUnwrap();
      const singleResult = 'isMultiple' in singleValue ? singleValue.isMultiple : undefined;
      expect(singleResult).toBeUndefined();
    });

    it('exposes record metadata return types', () => {
      const recordId = new RecordId();
      recordId.validateParams([])._unsafeUnwrap();
      recordId.getReturnType()._unsafeUnwrap();

      const autoNumber = new AutoNumber();
      autoNumber.validateParams([])._unsafeUnwrap();
      autoNumber.getReturnType()._unsafeUnwrap();
    });
  });
});
