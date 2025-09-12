/* eslint-disable sonarjs/no-duplicate-string */
import { FunctionName, FUNCTIONS, CellValueType } from '@teable/core';

export interface IFunctionSchema<T extends FunctionName> {
  name: T;
  func: (typeof FUNCTIONS)[T];
  params: string[];
  definition: string;
  returnType?: CellValueType | 'array';
  summary: string;
  example: string;
}

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
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Average,
    {
      name: FunctionName.Average,
      func: FUNCTIONS[FunctionName.Average],
      params: ['number1', '[number2, ...]'],
      definition: 'AVERAGE(number1, [number2, ...])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Max,
    {
      name: FunctionName.Max,
      func: FUNCTIONS[FunctionName.Max],
      params: ['number1', '[number2, ...]'],
      definition: 'MAX(number1, [number2, ...])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Min,
    {
      name: FunctionName.Min,
      func: FUNCTIONS[FunctionName.Min],
      params: ['number1', '[number2, ...]'],
      definition: 'MIN(number1, [number2, ...])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Round,
    {
      name: FunctionName.Round,
      func: FUNCTIONS[FunctionName.Round],
      params: ['value', '[precision]'],
      definition: 'ROUND(value, [precision])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.RoundUp,
    {
      name: FunctionName.RoundUp,
      func: FUNCTIONS[FunctionName.RoundUp],
      params: ['value', '[precision]'],
      definition: 'ROUNDUP(value, [precision])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.RoundDown,
    {
      name: FunctionName.RoundDown,
      func: FUNCTIONS[FunctionName.RoundDown],
      params: ['value', '[precision]'],
      definition: 'ROUNDDOWN(value, [precision])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Ceiling,
    {
      name: FunctionName.Ceiling,
      func: FUNCTIONS[FunctionName.Ceiling],
      params: ['value', '[significance]'],
      definition: 'CEILING(value, [significance])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Floor,
    {
      name: FunctionName.Floor,
      func: FUNCTIONS[FunctionName.Floor],
      params: ['value', '[significance]'],
      definition: 'FLOOR(value, [significance])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Even,
    {
      name: FunctionName.Even,
      func: FUNCTIONS[FunctionName.Even],
      params: ['value'],
      definition: 'EVEN(value)',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Odd,
    {
      name: FunctionName.Odd,
      func: FUNCTIONS[FunctionName.Odd],
      params: ['value'],
      definition: 'ODD(value)',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Int,
    {
      name: FunctionName.Int,
      func: FUNCTIONS[FunctionName.Int],
      params: ['value'],
      definition: 'INT(value)',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Abs,
    {
      name: FunctionName.Abs,
      func: FUNCTIONS[FunctionName.Abs],
      params: ['value'],
      definition: 'ABS(value)',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Sqrt,
    {
      name: FunctionName.Sqrt,
      func: FUNCTIONS[FunctionName.Sqrt],
      params: ['value'],
      definition: 'SQRT(value)',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Power,
    {
      name: FunctionName.Power,
      func: FUNCTIONS[FunctionName.Power],
      params: ['value'],
      definition: 'POWER(value)',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Exp,
    {
      name: FunctionName.Exp,
      func: FUNCTIONS[FunctionName.Exp],
      params: ['value'],
      definition: 'EXP(value)',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Log,
    {
      name: FunctionName.Log,
      func: FUNCTIONS[FunctionName.Log],
      params: ['value', '[base=10]'],
      definition: 'LOG(number, [base=10]))',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Mod,
    {
      name: FunctionName.Mod,
      func: FUNCTIONS[FunctionName.Mod],
      params: ['value', 'divisor'],
      definition: 'MOD(value, divisor)',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Value,
    {
      name: FunctionName.Value,
      func: FUNCTIONS[FunctionName.Value],
      params: ['text'],
      definition: 'VALUE(text)',
      returnType: CellValueType.Number,
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
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.Find,
    {
      name: FunctionName.Find,
      func: FUNCTIONS[FunctionName.Find],
      params: ['stringToFind', 'whereToSearch', '[startFromPosition]'],
      definition: 'FIND(stringToFind, whereToSearch, [startFromPosition])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Search,
    {
      name: FunctionName.Search,
      func: FUNCTIONS[FunctionName.Search],
      params: ['stringToFind', 'whereToSearch', '[startFromPosition]'],
      definition: 'SEARCH(stringToFind, whereToSearch, [startFromPosition])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Mid,
    {
      name: FunctionName.Mid,
      func: FUNCTIONS[FunctionName.Mid],
      params: ['text', 'whereToStart', 'count'],
      definition: 'MID(text, whereToStart, count)',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.Left,
    {
      name: FunctionName.Left,
      func: FUNCTIONS[FunctionName.Left],
      params: ['text', 'count'],
      definition: 'LEFT(text, count)',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.Right,
    {
      name: FunctionName.Right,
      func: FUNCTIONS[FunctionName.Right],
      params: ['text', 'count'],
      definition: 'RIGHT(text, count)',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.Replace,
    {
      name: FunctionName.Replace,
      func: FUNCTIONS[FunctionName.Replace],
      params: ['text', 'whereToStart', 'count', 'replacement'],
      definition: 'REPLACE(text, whereToStart, count, replacement)',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.RegExpReplace,
    {
      name: FunctionName.RegExpReplace,
      func: FUNCTIONS[FunctionName.RegExpReplace],
      params: ['text', 'regular_expression', 'replacement'],
      definition: 'REGEXP_REPLACE(text, regular_expression, replacement)',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.Substitute,
    {
      name: FunctionName.Substitute,
      func: FUNCTIONS[FunctionName.Substitute],
      params: ['text', 'oldText', 'newText', '[index]'],
      definition: 'SUBSTITUTE(text, oldText, newText, [index])',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.Lower,
    {
      name: FunctionName.Lower,
      func: FUNCTIONS[FunctionName.Lower],
      params: ['text'],
      definition: 'LOWER(text)',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.Upper,
    {
      name: FunctionName.Upper,
      func: FUNCTIONS[FunctionName.Upper],
      params: ['text'],
      definition: 'UPPER(text)',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.Rept,
    {
      name: FunctionName.Rept,
      func: FUNCTIONS[FunctionName.Rept],
      params: ['text', 'number'],
      definition: 'REPT(text, number)',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.Trim,
    {
      name: FunctionName.Trim,
      func: FUNCTIONS[FunctionName.Trim],
      params: ['text'],
      definition: 'TRIM(text)',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.Len,
    {
      name: FunctionName.Len,
      func: FUNCTIONS[FunctionName.Len],
      params: ['text'],
      definition: 'LEN(text)',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.T,
    {
      name: FunctionName.T,
      func: FUNCTIONS[FunctionName.T],
      params: ['value'],
      definition: 'T(value)',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.EncodeUrlComponent,
    {
      name: FunctionName.EncodeUrlComponent,
      func: FUNCTIONS[FunctionName.EncodeUrlComponent],
      params: ['value'],
      definition: 'ENCODE_URL_COMPONENT(value)',
      returnType: CellValueType.String,
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
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.Switch,
    {
      name: FunctionName.Switch,
      func: FUNCTIONS[FunctionName.Switch],
      params: ['expression', '[pattern, result]...', '[default]'],
      definition: 'SWITCH(expression, [pattern, result]..., [default])',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.And,
    {
      name: FunctionName.And,
      func: FUNCTIONS[FunctionName.And],
      params: ['logical1', '[logical2, ...]'],
      definition: 'AND(logical1, [logical2, ...])',
      returnType: CellValueType.Boolean,
    },
  ],
  [
    FunctionName.Or,
    {
      name: FunctionName.Or,
      func: FUNCTIONS[FunctionName.Or],
      params: ['logical1', '[logical2, ...]'],
      definition: 'OR(logical1, [logical2, ...])',
      returnType: CellValueType.Boolean,
    },
  ],
  [
    FunctionName.Xor,
    {
      name: FunctionName.Xor,
      func: FUNCTIONS[FunctionName.Xor],
      params: ['logical1', '[logical2, ...]'],
      definition: 'XOR(logical1, [logical2, ...])',
      returnType: CellValueType.Boolean,
    },
  ],
  [
    FunctionName.Not,
    {
      name: FunctionName.Not,
      func: FUNCTIONS[FunctionName.Not],
      params: ['boolean'],
      definition: 'NOT(boolean)',
      returnType: CellValueType.Boolean,
    },
  ],
  [
    FunctionName.Blank,
    {
      name: FunctionName.Blank,
      func: FUNCTIONS[FunctionName.Blank],
      params: [],
      definition: 'BLANK()',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.Error,
    {
      name: FunctionName.Error,
      func: FUNCTIONS[FunctionName.Error],
      params: ['message'],
      definition: 'ERROR(message)',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.IsError,
    {
      name: FunctionName.IsError,
      func: FUNCTIONS[FunctionName.IsError],
      params: ['expr'],
      definition: 'IS_ERROR(expr)',
      returnType: CellValueType.Boolean,
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
      returnType: CellValueType.DateTime,
    },
  ],
  [
    FunctionName.Now,
    {
      name: FunctionName.Now,
      func: FUNCTIONS[FunctionName.Now],
      params: [],
      definition: 'NOW()',
      returnType: CellValueType.DateTime,
    },
  ],
  [
    FunctionName.Year,
    {
      name: FunctionName.Year,
      func: FUNCTIONS[FunctionName.Year],
      params: ['date'],
      definition: 'YEAR(date)',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Month,
    {
      name: FunctionName.Month,
      func: FUNCTIONS[FunctionName.Month],
      params: ['date'],
      definition: 'MONTH(date)',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.WeekNum,
    {
      name: FunctionName.WeekNum,
      func: FUNCTIONS[FunctionName.WeekNum],
      params: ['date'],
      definition: 'WEEKNUM(date)',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Weekday,
    {
      name: FunctionName.Weekday,
      func: FUNCTIONS[FunctionName.Weekday],
      params: ['date', '[startDayOfWeek]'],
      definition: 'WEEKDAY(date, [startDayOfWeek])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Day,
    {
      name: FunctionName.Day,
      func: FUNCTIONS[FunctionName.Day],
      params: ['date'],
      definition: 'DAY(date, [startDayOfWeek])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Hour,
    {
      name: FunctionName.Hour,
      func: FUNCTIONS[FunctionName.Hour],
      params: ['date'],
      definition: 'HOUR(date, [startDayOfWeek])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Minute,
    {
      name: FunctionName.Minute,
      func: FUNCTIONS[FunctionName.Minute],
      params: ['date'],
      definition: 'MINUTE(date, [startDayOfWeek])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Second,
    {
      name: FunctionName.Second,
      func: FUNCTIONS[FunctionName.Second],
      params: ['date'],
      definition: 'SECOND(date, [startDayOfWeek])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.FromNow,
    {
      name: FunctionName.FromNow,
      func: FUNCTIONS[FunctionName.FromNow],
      params: ['date', 'unit'],
      definition: 'FROMNOW(date, unit)',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.ToNow,
    {
      name: FunctionName.ToNow,
      func: FUNCTIONS[FunctionName.ToNow],
      params: ['date', 'unit'],
      definition: 'TONOW(date, unit)',
      returnType: CellValueType.DateTime,
    },
  ],
  [
    FunctionName.DatetimeDiff,
    {
      name: FunctionName.DatetimeDiff,
      func: FUNCTIONS[FunctionName.DatetimeDiff],
      params: ['date1', 'date2', '[unit]'],
      definition: 'DATETIME_DIFF(date1, date2, [unit])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Workday,
    {
      name: FunctionName.Workday,
      func: FUNCTIONS[FunctionName.Workday],
      params: ['date', 'count', '[holidayStr]'],
      definition: 'WORKDAY(date, count, [holidayStr])',
      returnType: CellValueType.DateTime,
    },
  ],
  [
    FunctionName.WorkdayDiff,
    {
      name: FunctionName.WorkdayDiff,
      func: FUNCTIONS[FunctionName.WorkdayDiff],
      params: ['date1', 'date2', '[holidayStr]'],
      definition: 'WORKDAY_DIFF(date1, date2, [holidayStr])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.IsSame,
    {
      name: FunctionName.IsSame,
      func: FUNCTIONS[FunctionName.IsSame],
      params: ['date1', 'date2', '[unit]'],
      definition: 'IS_SAME(date1, date2, [unit])',
      returnType: CellValueType.Boolean,
    },
  ],
  [
    FunctionName.IsAfter,
    {
      name: FunctionName.IsAfter,
      func: FUNCTIONS[FunctionName.IsAfter],
      params: ['date1', 'date2', '[unit]'],
      definition: 'IS_AFTER(date1, date2, [unit])',
      returnType: CellValueType.Boolean,
    },
  ],
  [
    FunctionName.IsBefore,
    {
      name: FunctionName.IsBefore,
      func: FUNCTIONS[FunctionName.IsBefore],
      params: ['date1', 'date2', '[unit]'],
      definition: 'IS_BEFORE(date1, date2, [unit])',
      returnType: CellValueType.Boolean,
    },
  ],
  [
    FunctionName.DateAdd,
    {
      name: FunctionName.DateAdd,
      func: FUNCTIONS[FunctionName.DateAdd],
      params: ['date1', 'count', '[unit]'],
      definition: 'DATE_ADD(date, count, units)',
      returnType: CellValueType.DateTime,
    },
  ],
  [
    FunctionName.Datestr,
    {
      name: FunctionName.Datestr,
      func: FUNCTIONS[FunctionName.Datestr],
      params: ['date'],
      definition: 'DATESTR(date)',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.Timestr,
    {
      name: FunctionName.Timestr,
      func: FUNCTIONS[FunctionName.Timestr],
      params: ['date'],
      definition: 'TIMESTR(date)',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.DatetimeFormat,
    {
      name: FunctionName.DatetimeFormat,
      func: FUNCTIONS[FunctionName.DatetimeFormat],
      params: ['date', '[specified_output_format]'],
      definition: 'DATETIME_FORMAT(date, [specified_output_format])',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.DatetimeParse,
    {
      name: FunctionName.DatetimeParse,
      func: FUNCTIONS[FunctionName.DatetimeParse],
      params: ['date', '[input_format]'],
      definition: 'DATETIME_PARSE(date, [input_format])',
      returnType: CellValueType.DateTime,
    },
  ],
  [
    FunctionName.CreatedTime,
    {
      name: FunctionName.CreatedTime,
      func: FUNCTIONS[FunctionName.CreatedTime],
      params: [],
      definition: 'CREATED_TIME()',
      returnType: CellValueType.DateTime,
    },
  ],
  [
    FunctionName.LastModifiedTime,
    {
      name: FunctionName.LastModifiedTime,
      func: FUNCTIONS[FunctionName.LastModifiedTime],
      params: [],
      definition: 'LAST_MODIFIED_TIME()',
      returnType: CellValueType.DateTime,
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
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.CountA,
    {
      name: FunctionName.CountA,
      func: FUNCTIONS[FunctionName.CountA],
      params: ['value1', '[value2, ...]'],
      definition: 'COUNTA(value1, [value2, ...])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.Count,
    {
      name: FunctionName.Count,
      func: FUNCTIONS[FunctionName.Count],
      params: ['value1', '[value2, ...]'],
      definition: 'COUNT(value1, [value2, ...])',
      returnType: CellValueType.Number,
    },
  ],
  [
    FunctionName.ArrayJoin,
    {
      name: FunctionName.ArrayJoin,
      func: FUNCTIONS[FunctionName.ArrayJoin],
      params: ['array', '[separator]'],
      definition: 'ARRAY_JOIN(array, [separator])',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.ArrayUnique,
    {
      name: FunctionName.ArrayUnique,
      func: FUNCTIONS[FunctionName.ArrayUnique],
      params: ['array'],
      definition: 'ARRAY_UNIQUE(array)',
      returnType: 'array',
    },
  ],
  [
    FunctionName.ArrayFlatten,
    {
      name: FunctionName.ArrayFlatten,
      func: FUNCTIONS[FunctionName.ArrayFlatten],
      params: ['array'],
      definition: 'ARRAY_FLATTEN(array)',
      returnType: 'array',
    },
  ],
  [
    FunctionName.ArrayCompact,
    {
      name: FunctionName.ArrayCompact,
      func: FUNCTIONS[FunctionName.ArrayCompact],
      params: ['array'],
      definition: 'ARRAY_COMPACT(array)',
      returnType: 'array',
    },
  ],
  [
    FunctionName.RecordId,
    {
      name: FunctionName.RecordId,
      func: FUNCTIONS[FunctionName.RecordId],
      params: [],
      definition: 'RECORD_ID()',
      returnType: CellValueType.String,
    },
  ],
  [
    FunctionName.AutoNumber,
    {
      name: FunctionName.AutoNumber,
      func: FUNCTIONS[FunctionName.AutoNumber],
      params: [],
      definition: 'AUTO_NUMBER()',
      returnType: CellValueType.Number,
    },
  ],
];
