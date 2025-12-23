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
        expect(func.validateParams([]).isErr()).toBe(true);
        expect(func.validateParams([stringValue]).isOk()).toBe(true);

        const empty = func.getReturnType();
        expect(empty.isOk()).toBe(true);
        if (empty.isErr()) continue;
        expect(empty.value.isMultiple).toBe(true);

        const same = func.getReturnType([numberValue, numberValue]);
        expect(same.isOk()).toBe(true);
        if (same.isErr()) continue;
        expect(same.value.type).toBe(CellValueType.Number);
        expect(same.value.isMultiple).toBe(true);

        const mixed = func.getReturnType([numberValue, stringValue]);
        expect(mixed.isOk()).toBe(true);
        if (mixed.isErr()) continue;
        expect(mixed.value.type).toBe(CellValueType.String);
        expect(mixed.value.isMultiple).toBe(true);
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
      expect(max.validateParams([stringValue]).isErr()).toBe(true);
      expect(max.validateParams([dateValue]).isOk()).toBe(true);
      const maxReturn = max.getReturnType([dateValue]);
      expect(maxReturn.isOk()).toBe(true);
      if (maxReturn.isErr()) return;
      expect(maxReturn.value.type).toBe(CellValueType.DateTime);

      const min = new Min();
      expect(min.validateParams([booleanValue]).isErr()).toBe(true);
      expect(min.validateParams([numberValue]).isOk()).toBe(true);
      const minReturn = min.getReturnType([numberValue]);
      expect(minReturn.isOk()).toBe(true);
      if (minReturn.isErr()) return;
      expect(minReturn.value.type).toBe(CellValueType.Number);
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
      expect(func.validateParams([booleanValue, stringValue]).isErr()).toBe(true);

      const blankThen = func.getReturnType([
        booleanValue,
        valueOf(CellValueType.String, { isBlank: true }),
        numberValue,
      ]);
      expect(blankThen.isOk()).toBe(true);
      if (blankThen.isErr()) return;
      expect(blankThen.value.type).toBe(CellValueType.Number);

      const blankElse = func.getReturnType([
        booleanValue,
        stringValue,
        valueOf(CellValueType.Number, { isBlank: true }),
      ]);
      expect(blankElse.isOk()).toBe(true);
      if (blankElse.isErr()) return;
      expect(blankElse.value.type).toBe(CellValueType.String);

      const sameType = func.getReturnType([
        booleanValue,
        valueOf(CellValueType.String, { isMultiple: true }),
        valueOf(CellValueType.String, { isMultiple: true }),
      ]);
      expect(sameType.isOk()).toBe(true);
      if (sameType.isErr()) return;
      expect(sameType.value.type).toBe(CellValueType.String);
      const sameTypeMultiple =
        'isMultiple' in sameType.value ? sameType.value.isMultiple : undefined;
      expect(sameTypeMultiple).toBe(true);

      const mismatch = func.getReturnType([booleanValue, stringValue, numberValue]);
      expect(mismatch.isOk()).toBe(true);
      if (mismatch.isErr()) return;
      expect(mismatch.value.type).toBe(CellValueType.String);
    });

    it('infers return types for SWITCH', () => {
      const func = new Switch();
      expect(func.validateParams([stringValue]).isErr()).toBe(true);

      const short = func.getReturnType([stringValue, numberValue]);
      expect(short.isOk()).toBe(true);
      if (short.isErr()) return;
      expect(short.value.type).toBe(CellValueType.Number);

      const detailed = func.getReturnType([
        stringValue,
        stringValue,
        valueOf(CellValueType.Number, { isMultiple: true }),
        booleanValue,
        valueOf(CellValueType.String, { isMultiple: false }),
        valueOf(CellValueType.Number, { isMultiple: false }),
      ]);
      expect(detailed.isOk()).toBe(true);
      if (detailed.isErr()) return;
      expect(detailed.value.type).toBe(CellValueType.String);
      const detailedMultiple =
        'isMultiple' in detailed.value ? detailed.value.isMultiple : undefined;
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
      expect(mid.validateParams([stringValue, numberValue]).isErr()).toBe(true);
      expect(mid.validateParams([stringValue, numberValue, numberValue]).isOk()).toBe(true);

      const replace = new Replace();
      expect(replace.validateParams([stringValue, numberValue, stringValue]).isErr()).toBe(true);
      expect(
        replace.validateParams([stringValue, numberValue, numberValue, stringValue]).isOk()
      ).toBe(true);

      const regExpReplace = new RegExpReplace();
      expect(regExpReplace.validateParams([stringValue, stringValue]).isErr()).toBe(true);
      expect(regExpReplace.validateParams([stringValue, stringValue, stringValue]).isOk()).toBe(
        true
      );

      const substitute = new Substitute();
      expect(substitute.validateParams([stringValue, stringValue]).isErr()).toBe(true);
      expect(substitute.validateParams([stringValue, stringValue, stringValue]).isOk()).toBe(true);

      const rept = new Rept();
      expect(rept.validateParams([stringValue]).isErr()).toBe(true);
      expect(rept.validateParams([stringValue, numberValue]).isOk()).toBe(true);
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
      expect(func.validateParams([]).isErr()).toBe(true);
      expect(func.validateParams([stringValue]).isOk()).toBe(true);
      expect(func.getReturnType().isOk()).toBe(true);

      const multiple = func.getReturnType([valueOf(CellValueType.String, { isMultiple: true })]);
      expect(multiple.isOk()).toBe(true);
      if (multiple.isErr()) return;
      const multipleResult = 'isMultiple' in multiple.value ? multiple.value.isMultiple : undefined;
      expect(multipleResult).toBe(true);

      const single = func.getReturnType([stringValue]);
      expect(single.isOk()).toBe(true);
      if (single.isErr()) return;
      const singleResult = 'isMultiple' in single.value ? single.value.isMultiple : undefined;
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
