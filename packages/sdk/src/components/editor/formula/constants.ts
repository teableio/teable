/* eslint-disable sonarjs/no-duplicate-string, @typescript-eslint/naming-convention */
import { FormulaFuncType, FunctionName, FUNCTIONS, FormulaLexer } from '@teable/core';
import { Hash, A, CheckSquare, Calendar } from '@teable/icons';
import { useMemo } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import type { IFunctionMap, IFunctionSchema } from './interface';

export const Type2IconMap = {
  [FormulaFuncType.Text]: A,
  [FormulaFuncType.Numeric]: Hash,
  [FormulaFuncType.DateTime]: Calendar,
  [FormulaFuncType.Logical]: CheckSquare,
  [FormulaFuncType.Array]: A,
  [FormulaFuncType.System]: A,
};

export const FOCUS_TOKENS_SET = new Set([
  FormulaLexer.IDENTIFIER,
  FormulaLexer.IDENTIFIER_UNICODE,
  FormulaLexer.IDENTIFIER_VARIABLE,
  FormulaLexer.SINGLEQ_STRING_LITERAL,
  FormulaLexer.DOUBLEQ_STRING_LITERAL,
  FormulaLexer.NUMERIC_LITERAL,
  FormulaLexer.INTEGER_LITERAL,
]);

export const useFunctionsDisplayMap = (): IFunctionMap => {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      [FormulaFuncType.Numeric]: {
        name: t('functionType.numeric'),
        type: FormulaFuncType.Numeric,
        list: [],
        prevCount: 0,
        sortIndex: -1,
      },
      [FormulaFuncType.Text]: {
        name: t('functionType.text'),
        type: FormulaFuncType.Text,
        list: [],
        prevCount: 0,
        sortIndex: -1,
      },
      [FormulaFuncType.Logical]: {
        name: t('functionType.logical'),
        type: FormulaFuncType.Logical,
        list: [],
        prevCount: 0,
        sortIndex: -1,
      },
      [FormulaFuncType.DateTime]: {
        name: t('functionType.date'),
        type: FormulaFuncType.DateTime,
        list: [],
        prevCount: 0,
        sortIndex: -1,
      },
      [FormulaFuncType.Array]: {
        name: t('functionType.array'),
        type: FormulaFuncType.Array,
        list: [],
        prevCount: 0,
        sortIndex: -1,
      },
      [FormulaFuncType.System]: {
        name: t('functionType.system'),
        type: FormulaFuncType.System,
        list: [],
        prevCount: 0,
        sortIndex: -1,
      },
    }),
    [t]
  );
};

export const funcDefine: [
  FunctionName,
  Omit<IFunctionSchema<FunctionName>, 'summary' | 'example'>,
][] = [
  // Numeric
  [
    FunctionName.Sum,
    {
      name: FunctionName.Sum,
      func: FUNCTIONS[FunctionName.Sum],
      params: ['number1', '[number2, ...]'],
      definition: 'SUM(number1, [number2, ...])',
    },
  ],
  [
    FunctionName.Average,
    {
      name: FunctionName.Average,
      func: FUNCTIONS[FunctionName.Average],
      params: ['number1', '[number2, ...]'],
      definition: 'AVERAGE(number1, [number2, ...])',
    },
  ],
  [
    FunctionName.Max,
    {
      name: FunctionName.Max,
      func: FUNCTIONS[FunctionName.Max],
      params: ['number1', '[number2, ...]'],
      definition: 'MAX(number1, [number2, ...])',
    },
  ],
  [
    FunctionName.Min,
    {
      name: FunctionName.Min,
      func: FUNCTIONS[FunctionName.Min],
      params: ['number1', '[number2, ...]'],
      definition: 'MIN(number1, [number2, ...])',
    },
  ],
  [
    FunctionName.Round,
    {
      name: FunctionName.Round,
      func: FUNCTIONS[FunctionName.Round],
      params: ['value', '[precision]'],
      definition: 'ROUND(value, [precision])',
    },
  ],
  [
    FunctionName.RoundUp,
    {
      name: FunctionName.RoundUp,
      func: FUNCTIONS[FunctionName.RoundUp],
      params: ['value', '[precision]'],
      definition: 'ROUNDUP(value, [precision])',
    },
  ],
  [
    FunctionName.RoundDown,
    {
      name: FunctionName.RoundDown,
      func: FUNCTIONS[FunctionName.RoundDown],
      params: ['value', '[precision]'],
      definition: 'ROUNDDOWN(value, [precision])',
    },
  ],
  [
    FunctionName.Ceiling,
    {
      name: FunctionName.Ceiling,
      func: FUNCTIONS[FunctionName.Ceiling],
      params: ['value', '[significance]'],
      definition: 'CEILING(value, [significance])',
    },
  ],
  [
    FunctionName.Floor,
    {
      name: FunctionName.Floor,
      func: FUNCTIONS[FunctionName.Floor],
      params: ['value', '[significance]'],
      definition: 'FLOOR(value, [significance])',
    },
  ],
  [
    FunctionName.Even,
    {
      name: FunctionName.Even,
      func: FUNCTIONS[FunctionName.Even],
      params: ['value'],
      definition: 'EVEN(value)',
    },
  ],
  [
    FunctionName.Odd,
    {
      name: FunctionName.Odd,
      func: FUNCTIONS[FunctionName.Odd],
      params: ['value'],
      definition: 'ODD(value)',
    },
  ],
  [
    FunctionName.Int,
    {
      name: FunctionName.Int,
      func: FUNCTIONS[FunctionName.Int],
      params: ['value'],
      definition: 'INT(value)',
    },
  ],
  [
    FunctionName.Abs,
    {
      name: FunctionName.Abs,
      func: FUNCTIONS[FunctionName.Abs],
      params: ['value'],
      definition: 'ABS(value)',
    },
  ],
  [
    FunctionName.Sqrt,
    {
      name: FunctionName.Sqrt,
      func: FUNCTIONS[FunctionName.Sqrt],
      params: ['value'],
      definition: 'SQRT(value)',
    },
  ],
  [
    FunctionName.Power,
    {
      name: FunctionName.Power,
      func: FUNCTIONS[FunctionName.Power],
      params: ['value'],
      definition: 'POWER(value)',
    },
  ],
  [
    FunctionName.Exp,
    {
      name: FunctionName.Exp,
      func: FUNCTIONS[FunctionName.Exp],
      params: ['value'],
      definition: 'EXP(value)',
    },
  ],
  [
    FunctionName.Log,
    {
      name: FunctionName.Log,
      func: FUNCTIONS[FunctionName.Log],
      params: ['value', '[base=10]'],
      definition: 'LOG(number, [base=10]))',
    },
  ],
  [
    FunctionName.Mod,
    {
      name: FunctionName.Mod,
      func: FUNCTIONS[FunctionName.Mod],
      params: ['value', 'divisor'],
      definition: 'MOD(value, divisor)',
    },
  ],
  [
    FunctionName.Value,
    {
      name: FunctionName.Value,
      func: FUNCTIONS[FunctionName.Value],
      params: ['text'],
      definition: 'VALUE(text)',
    },
  ],

  // Text
  [
    FunctionName.Concatenate,
    {
      name: FunctionName.Concatenate,
      func: FUNCTIONS[FunctionName.Concatenate],
      params: ['text1', '[text2, ...]'],
      definition: 'CONCATENATE(text1, [text2, ...])',
    },
  ],
  [
    FunctionName.Find,
    {
      name: FunctionName.Find,
      func: FUNCTIONS[FunctionName.Find],
      params: ['stringToFind', 'whereToSearch', '[startFromPosition]'],
      definition: 'FIND(stringToFind, whereToSearch, [startFromPosition])',
    },
  ],
  [
    FunctionName.Search,
    {
      name: FunctionName.Search,
      func: FUNCTIONS[FunctionName.Search],
      params: ['stringToFind', 'whereToSearch', '[startFromPosition]'],
      definition: 'SEARCH(stringToFind, whereToSearch, [startFromPosition])',
    },
  ],
  [
    FunctionName.Mid,
    {
      name: FunctionName.Mid,
      func: FUNCTIONS[FunctionName.Mid],
      params: ['text', 'whereToStart', 'count'],
      definition: 'MID(text, whereToStart, count)',
    },
  ],
  [
    FunctionName.Left,
    {
      name: FunctionName.Left,
      func: FUNCTIONS[FunctionName.Left],
      params: ['text', 'count'],
      definition: 'LEFT(text, count)',
    },
  ],
  [
    FunctionName.Right,
    {
      name: FunctionName.Right,
      func: FUNCTIONS[FunctionName.Right],
      params: ['text', 'count'],
      definition: 'RIGHT(text, count)',
    },
  ],
  [
    FunctionName.Replace,
    {
      name: FunctionName.Replace,
      func: FUNCTIONS[FunctionName.Replace],
      params: ['text', 'whereToStart', 'count', 'replacement'],
      definition: 'REPLACE(text, whereToStart, count, replacement)',
    },
  ],
  [
    FunctionName.RegExpReplace,
    {
      name: FunctionName.RegExpReplace,
      func: FUNCTIONS[FunctionName.RegExpReplace],
      params: ['text', 'regular_expression', 'replacement'],
      definition: 'REGEXP_REPLACE(text, regular_expression, replacement)',
    },
  ],
  [
    FunctionName.Substitute,
    {
      name: FunctionName.Substitute,
      func: FUNCTIONS[FunctionName.Substitute],
      params: ['text', 'oldText', 'newText', '[index]'],
      definition: 'SUBSTITUTE(text, oldText, newText, [index])',
    },
  ],
  [
    FunctionName.Lower,
    {
      name: FunctionName.Lower,
      func: FUNCTIONS[FunctionName.Lower],
      params: ['text'],
      definition: 'LOWER(text)',
    },
  ],
  [
    FunctionName.Upper,
    {
      name: FunctionName.Upper,
      func: FUNCTIONS[FunctionName.Upper],
      params: ['text'],
      definition: 'UPPER(text)',
    },
  ],
  [
    FunctionName.Rept,
    {
      name: FunctionName.Rept,
      func: FUNCTIONS[FunctionName.Rept],
      params: ['text', 'number'],
      definition: 'REPT(text, number)',
    },
  ],
  [
    FunctionName.Trim,
    {
      name: FunctionName.Trim,
      func: FUNCTIONS[FunctionName.Trim],
      params: ['text'],
      definition: 'TRIM(text)',
    },
  ],
  [
    FunctionName.Len,
    {
      name: FunctionName.Len,
      func: FUNCTIONS[FunctionName.Len],
      params: ['text'],
      definition: 'LEN(text)',
    },
  ],
  [
    FunctionName.T,
    {
      name: FunctionName.T,
      func: FUNCTIONS[FunctionName.T],
      params: ['value'],
      definition: 'T(value)',
    },
  ],
  [
    FunctionName.EncodeUrlComponent,
    {
      name: FunctionName.EncodeUrlComponent,
      func: FUNCTIONS[FunctionName.EncodeUrlComponent],
      params: ['value'],
      definition: 'ENCODE_URL_COMPONENT(value)',
    },
  ],

  // Logical
  [
    FunctionName.If,
    {
      name: FunctionName.If,
      func: FUNCTIONS[FunctionName.If],
      params: ['logical', 'value1', 'value2'],
      definition: 'IF(logical, value1, value2)',
    },
  ],
  [
    FunctionName.Switch,
    {
      name: FunctionName.Switch,
      func: FUNCTIONS[FunctionName.Switch],
      params: ['expression', '[pattern, result]...', '[default]'],
      definition: 'SWITCH(expression, [pattern, result]..., [default])',
    },
  ],
  [
    FunctionName.And,
    {
      name: FunctionName.And,
      func: FUNCTIONS[FunctionName.And],
      params: ['logical1', '[logical2, ...]'],
      definition: 'AND(logical1, [logical2, ...])',
    },
  ],
  [
    FunctionName.Or,
    {
      name: FunctionName.Or,
      func: FUNCTIONS[FunctionName.Or],
      params: ['logical1', '[logical2, ...]'],
      definition: 'OR(logical1, [logical2, ...])',
    },
  ],
  [
    FunctionName.Xor,
    {
      name: FunctionName.Xor,
      func: FUNCTIONS[FunctionName.Xor],
      params: ['logical1', '[logical2, ...]'],
      definition: 'XOR(logical1, [logical2, ...])',
    },
  ],
  [
    FunctionName.Not,
    {
      name: FunctionName.Not,
      func: FUNCTIONS[FunctionName.Not],
      params: ['boolean'],
      definition: 'NOT(boolean)',
    },
  ],
  [
    FunctionName.Blank,
    {
      name: FunctionName.Blank,
      func: FUNCTIONS[FunctionName.Blank],
      params: [],
      definition: 'BLANK()',
    },
  ],
  [
    FunctionName.Error,
    {
      name: FunctionName.Error,
      func: FUNCTIONS[FunctionName.Error],
      params: ['message'],
      definition: 'ERROR(message)',
    },
  ],
  [
    FunctionName.IsError,
    {
      name: FunctionName.IsError,
      func: FUNCTIONS[FunctionName.IsError],
      params: ['expr'],
      definition: 'IS_ERROR(expr)',
    },
  ],

  // Date
  [
    FunctionName.Today,
    {
      name: FunctionName.Today,
      func: FUNCTIONS[FunctionName.Today],
      params: [],
      definition: 'TODAY()',
    },
  ],
  [
    FunctionName.Now,
    {
      name: FunctionName.Now,
      func: FUNCTIONS[FunctionName.Now],
      params: [],
      definition: 'NOW()',
    },
  ],
  [
    FunctionName.Year,
    {
      name: FunctionName.Year,
      func: FUNCTIONS[FunctionName.Year],
      params: ['date'],
      definition: 'YEAR(date)',
    },
  ],
  [
    FunctionName.Month,
    {
      name: FunctionName.Month,
      func: FUNCTIONS[FunctionName.Month],
      params: ['date'],
      definition: 'MONTH(date)',
    },
  ],
  [
    FunctionName.WeekNum,
    {
      name: FunctionName.WeekNum,
      func: FUNCTIONS[FunctionName.WeekNum],
      params: ['date'],
      definition: 'WEEKNUM(date)',
    },
  ],
  [
    FunctionName.Weekday,
    {
      name: FunctionName.Weekday,
      func: FUNCTIONS[FunctionName.Weekday],
      params: ['date', '[startDayOfWeek]'],
      definition: 'WEEKDAY(date, [startDayOfWeek])',
    },
  ],
  [
    FunctionName.Day,
    {
      name: FunctionName.Day,
      func: FUNCTIONS[FunctionName.Day],
      params: ['date'],
      definition: 'DAY(date, [startDayOfWeek])',
    },
  ],
  [
    FunctionName.Hour,
    {
      name: FunctionName.Hour,
      func: FUNCTIONS[FunctionName.Hour],
      params: ['date'],
      definition: 'HOUR(date, [startDayOfWeek])',
    },
  ],
  [
    FunctionName.Minute,
    {
      name: FunctionName.Minute,
      func: FUNCTIONS[FunctionName.Minute],
      params: ['date'],
      definition: 'MINUTE(date, [startDayOfWeek])',
    },
  ],
  [
    FunctionName.Second,
    {
      name: FunctionName.Second,
      func: FUNCTIONS[FunctionName.Second],
      params: ['date'],
      definition: 'SECOND(date, [startDayOfWeek])',
    },
  ],
  [
    FunctionName.FromNow,
    {
      name: FunctionName.FromNow,
      func: FUNCTIONS[FunctionName.FromNow],
      params: ['date', 'unit'],
      definition: 'FROMNOW(date, unit)',
    },
  ],
  [
    FunctionName.ToNow,
    {
      name: FunctionName.ToNow,
      func: FUNCTIONS[FunctionName.ToNow],
      params: ['date', 'unit'],
      definition: 'TONOW(date, unit)',
    },
  ],
  [
    FunctionName.DatetimeDiff,
    {
      name: FunctionName.DatetimeDiff,
      func: FUNCTIONS[FunctionName.DatetimeDiff],
      params: ['date1', 'date2', '[unit]'],
      definition: 'DATETIME_DIFF(date1, date2, [unit])',
    },
  ],
  [
    FunctionName.Workday,
    {
      name: FunctionName.Workday,
      func: FUNCTIONS[FunctionName.Workday],
      params: ['date', 'count', '[holidayStr]'],
      definition: 'WORKDAY(date, count, [holidayStr])',
    },
  ],
  [
    FunctionName.WorkdayDiff,
    {
      name: FunctionName.WorkdayDiff,
      func: FUNCTIONS[FunctionName.WorkdayDiff],
      params: ['date1', 'date2', '[holidayStr]'],
      definition: 'WORKDAY_DIFF(date1, date2, [holidayStr])',
    },
  ],
  [
    FunctionName.IsSame,
    {
      name: FunctionName.IsSame,
      func: FUNCTIONS[FunctionName.IsSame],
      params: ['date1', 'date2', '[unit]'],
      definition: 'IS_SAME(date1, date2, [unit])',
    },
  ],
  [
    FunctionName.IsAfter,
    {
      name: FunctionName.IsAfter,
      func: FUNCTIONS[FunctionName.IsAfter],
      params: ['date1', 'date2', '[unit]'],
      definition: 'IS_AFTER(date1, date2, [unit])',
    },
  ],
  [
    FunctionName.IsBefore,
    {
      name: FunctionName.IsBefore,
      func: FUNCTIONS[FunctionName.IsBefore],
      params: ['date1', 'date2', '[unit]'],
      definition: 'IS_BEFORE(date1, date2, [unit])',
    },
  ],
  [
    FunctionName.DateAdd,
    {
      name: FunctionName.DateAdd,
      func: FUNCTIONS[FunctionName.DateAdd],
      params: ['date1', 'count', '[unit]'],
      definition: 'DATE_ADD(date, count, units)',
    },
  ],
  [
    FunctionName.Datestr,
    {
      name: FunctionName.Datestr,
      func: FUNCTIONS[FunctionName.Datestr],
      params: ['date'],
      definition: 'DATESTR(date)',
    },
  ],
  [
    FunctionName.Timestr,
    {
      name: FunctionName.Timestr,
      func: FUNCTIONS[FunctionName.Timestr],
      params: ['date'],
      definition: 'TIMESTR(date)',
    },
  ],
  [
    FunctionName.DatetimeFormat,
    {
      name: FunctionName.DatetimeFormat,
      func: FUNCTIONS[FunctionName.DatetimeFormat],
      params: ['date', '[specified_output_format]'],
      definition: 'DATETIME_FORMAT(date, [specified_output_format])',
    },
  ],
  [
    FunctionName.DatetimeParse,
    {
      name: FunctionName.DatetimeParse,
      func: FUNCTIONS[FunctionName.DatetimeParse],
      params: ['date', '[input_format]'],
      definition: 'DATETIME_PARSE(date, [input_format])',
    },
  ],
  [
    FunctionName.CreatedTime,
    {
      name: FunctionName.CreatedTime,
      func: FUNCTIONS[FunctionName.CreatedTime],
      params: [],
      definition: 'CREATED_TIME()',
    },
  ],
  [
    FunctionName.LastModifiedTime,
    {
      name: FunctionName.LastModifiedTime,
      func: FUNCTIONS[FunctionName.LastModifiedTime],
      params: [],
      definition: 'LAST_MODIFIED_TIME()',
    },
  ],

  // Array
  [
    FunctionName.CountAll,
    {
      name: FunctionName.CountAll,
      func: FUNCTIONS[FunctionName.CountAll],
      params: ['value1', '[value2, ...]'],
      definition: 'COUNTALL(value1, [value2, ...])',
    },
  ],
  [
    FunctionName.CountA,
    {
      name: FunctionName.CountA,
      func: FUNCTIONS[FunctionName.CountA],
      params: ['value1', '[value2, ...]'],
      definition: 'COUNTA(value1, [value2, ...])',
    },
  ],
  [
    FunctionName.Count,
    {
      name: FunctionName.Count,
      func: FUNCTIONS[FunctionName.Count],
      params: ['value1', '[value2, ...]'],
      definition: 'COUNT(value1, [value2, ...])',
    },
  ],
  [
    FunctionName.ArrayJoin,
    {
      name: FunctionName.ArrayJoin,
      func: FUNCTIONS[FunctionName.ArrayJoin],
      params: ['array', '[separator]'],
      definition: 'ARRAY_JOIN(array, [separator])',
    },
  ],
  [
    FunctionName.ArrayUnique,
    {
      name: FunctionName.ArrayUnique,
      func: FUNCTIONS[FunctionName.ArrayUnique],
      params: ['array'],
      definition: 'ARRAY_UNIQUE(array)',
    },
  ],
  [
    FunctionName.ArrayFlatten,
    {
      name: FunctionName.ArrayFlatten,
      func: FUNCTIONS[FunctionName.ArrayFlatten],
      params: ['array'],
      definition: 'ARRAY_FLATTEN(array)',
    },
  ],
  [
    FunctionName.ArrayCompact,
    {
      name: FunctionName.ArrayCompact,
      func: FUNCTIONS[FunctionName.ArrayCompact],
      params: ['array'],
      definition: 'ARRAY_COMPACT(array)',
    },
  ],
  [
    FunctionName.RecordId,
    {
      name: FunctionName.RecordId,
      func: FUNCTIONS[FunctionName.RecordId],
      params: [],
      definition: 'RECORD_ID()',
    },
  ],
  [
    FunctionName.AutoNumber,
    {
      name: FunctionName.AutoNumber,
      func: FUNCTIONS[FunctionName.AutoNumber],
      params: [],
      definition: 'AUTO_NUMBER()',
    },
  ],
];

export const useFormulaFunctionsMap = () => {
  const { t } = useTranslation();

  return useMemo(
    () =>
      new Map<FunctionName, IFunctionSchema<FunctionName>>(
        funcDefine.map(
          ([name, schema]) =>
            [
              name,
              {
                ...schema,
                summary: t(`formula.${name}.summary`),
                example: t(`formula.${name}.example`),
              },
            ] as [FunctionName, IFunctionSchema<FunctionName>]
        )
      ),
    [t]
  );
};
