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
  TextBefore,
  TextSplit,
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
      expect(countAll.validateParams([]).isErr()).toBe(true);
      expect(countAll.validateParams([stringValue]).isOk()).toBe(true);
      expect(countAll.getReturnType().isOk()).toBe(true);
      expect(countAll.getReturnType([stringValue]).isOk()).toBe(true);

      const countA = new CountA();
      expect(countA.validateParams([]).isErr()).toBe(true);
      expect(countA.validateParams([stringValue]).isOk()).toBe(true);
      expect(countA.getReturnType().isOk()).toBe(true);
      expect(countA.getReturnType([stringValue]).isOk()).toBe(true);

      const count = new Count();
      expect(count.validateParams([]).isErr()).toBe(true);
      expect(count.validateParams([stringValue]).isOk()).toBe(true);
      expect(count.getReturnType().isOk()).toBe(true);
      expect(count.getReturnType([stringValue]).isOk()).toBe(true);
    });

    it('validates array string functions', () => {
      const arrayJoin = new ArrayJoin();
      expect(arrayJoin.validateParams([]).isErr()).toBe(true);
      expect(arrayJoin.validateParams([stringValue]).isOk()).toBe(true);
      expect(arrayJoin.getReturnType().isOk()).toBe(true);
      expect(arrayJoin.getReturnType([stringValue]).isOk()).toBe(true);
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

      expect(numericOnly[0].validateParams([]).isErr()).toBe(true);
      expect(numericOnly[0].validateParams([stringValue]).isErr()).toBe(true);

      for (const func of numericOnly) {
        expect(func.validateParams([numberValue]).isOk()).toBe(true);
        expect(func.getReturnType().isOk()).toBe(true);
        expect(func.getReturnType([numberValue]).isOk()).toBe(true);
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
      expect(sqrt.validateParams([]).isErr()).toBe(true);
      expect(sqrt.validateParams([stringValue]).isErr()).toBe(true);
      expect(sqrt.validateParams([numberValue]).isOk()).toBe(true);

      const exp = new Exp();
      expect(exp.validateParams([]).isErr()).toBe(true);
      expect(exp.validateParams([numberValue]).isOk()).toBe(true);

      const power = new Power();
      expect(power.validateParams([numberValue]).isErr()).toBe(true);
      expect(power.validateParams([numberValue, numberValue]).isOk()).toBe(true);

      const mod = new Mod();
      expect(mod.validateParams([numberValue]).isErr()).toBe(true);
      expect(mod.validateParams([numberValue, numberValue]).isOk()).toBe(true);

      const value = new Value();
      expect(value.validateParams([]).isErr()).toBe(true);
      expect(value.validateParams([numberValue]).isErr()).toBe(true);
      expect(value.validateParams([stringValue]).isOk()).toBe(true);
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
      expect(and.validateParams([]).isErr()).toBe(true);
      expect(and.validateParams([booleanValue]).isOk()).toBe(true);

      const or = new Or();
      expect(or.validateParams([]).isErr()).toBe(true);
      expect(or.validateParams([booleanValue]).isOk()).toBe(true);

      const xor = new Xor();
      expect(xor.validateParams([]).isErr()).toBe(true);
      expect(xor.validateParams([booleanValue]).isOk()).toBe(true);
      expect(xor.getReturnType().isOk()).toBe(true);
      expect(xor.getReturnType([booleanValue]).isOk()).toBe(true);

      const not = new Not();
      expect(not.validateParams([booleanValue, booleanValue]).isErr()).toBe(true);
      expect(not.validateParams([booleanValue]).isOk()).toBe(true);
      expect(not.getReturnType().isOk()).toBe(true);
      expect(not.getReturnType([booleanValue]).isOk()).toBe(true);

      const blank = new Blank();
      expect(blank.validateParams([]).isOk()).toBe(true);
      expect(blank.getReturnType().isOk()).toBe(true);

      const formulaError = new FormulaError();
      expect(formulaError.validateParams([]).isOk()).toBe(true);
      expect(formulaError.getReturnType().isOk()).toBe(true);

      const isError = new IsError();
      expect(isError.validateParams([stringValue, stringValue]).isErr()).toBe(true);
      expect(isError.validateParams([stringValue]).isOk()).toBe(true);
    });
  });

  describe('text functions', () => {
    it('validates at-least-one text functions', () => {
      const atLeastOne = [new Concatenate(), new Find(), new Search(), new Left(), new Right()];
      for (const func of atLeastOne) {
        expect(func.validateParams([]).isErr()).toBe(true);
        expect(func.validateParams([stringValue]).isOk()).toBe(true);
        expect(func.getReturnType().isOk()).toBe(true);
        expect(func.getReturnType([stringValue]).isOk()).toBe(true);
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

      const textBefore = new TextBefore();
      textBefore.validateParams([stringValue])._unsafeUnwrapErr();
      textBefore.validateParams([stringValue, stringValue])._unsafeUnwrap();

      const textSplit = new TextSplit();
      textSplit.validateParams([stringValue])._unsafeUnwrapErr();
      textSplit.validateParams([stringValue, stringValue])._unsafeUnwrap();
      const textSplitReturn = textSplit.getReturnType([stringValue, stringValue])._unsafeUnwrap();
      expect(textSplitReturn.type).toBe(CellValueType.String);
      expect(textSplitReturn.isMultiple).toBe(true);

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
        expect(func.validateParams([stringValue, stringValue]).isErr()).toBe(true);
        expect(func.validateParams([stringValue]).isOk()).toBe(true);
        expect(func.getReturnType().isOk()).toBe(true);
        expect(func.getReturnType([stringValue]).isOk()).toBe(true);
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
        expect(func.validateParams([]).isErr()).toBe(true);
        expect(func.validateParams([dateValue]).isOk()).toBe(true);
        expect(func.getReturnType().isOk()).toBe(true);
        expect(func.getReturnType([dateValue]).isOk()).toBe(true);
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
        expect(func.validateParams([]).isErr()).toBe(true);
        expect(func.validateParams(params).isOk()).toBe(true);
        expect(func.getReturnType().isOk()).toBe(true);
        expect(func.getReturnType(params).isOk()).toBe(true);
      }
    });

    it('handles system-provided date-time functions', () => {
      const today = new Today();
      expect(today.validateParams([]).isOk()).toBe(true);
      expect(today.getReturnType().isOk()).toBe(true);

      const now = new Now();
      expect(now.validateParams([]).isOk()).toBe(true);
      expect(now.getReturnType().isOk()).toBe(true);
      expect(now.getReturnType([dateValue]).isOk()).toBe(true);

      const created = new CreatedTime();
      expect(created.validateParams([]).isOk()).toBe(true);
      expect(created.getReturnType().isOk()).toBe(true);
    });

    it('validates last modified time params', () => {
      const fieldRef: FormulaFieldReference = {
        id: `fld${'b'.repeat(16)}`,
        cellValueType: CellValueType.Number,
        isMultipleCellValue: false,
      };
      const withField = valueOf(CellValueType.Number, { field: fieldRef });
      const func = new LastModifiedTime();

      expect(func.validateParams([]).isOk()).toBe(true);
      expect(func.validateParams([numberValue]).isErr()).toBe(true);
      expect(func.validateParams([withField]).isOk()).toBe(true);
      expect(func.getReturnType([withField]).isOk()).toBe(true);
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
      expect(recordId.validateParams([]).isOk()).toBe(true);
      expect(recordId.getReturnType().isOk()).toBe(true);

      const autoNumber = new AutoNumber();
      expect(autoNumber.validateParams([]).isOk()).toBe(true);
      expect(autoNumber.getReturnType().isOk()).toBe(true);
    });
  });
});
