/* eslint-disable sonarjs/no-duplicate-string, @typescript-eslint/naming-convention */
import { FormulaFuncType, FunctionName } from '@teable-group/core/src/formula/functions/common';
import { FUNCTIONS } from '@teable-group/core/src/formula/functions/factory';
import { FormulaLexer } from '@teable-group/core/src/formula/parser/FormulaLexer';
import { Hash, A, CheckSquare, Calendar } from '@teable-group/icons';
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

export const getFunctionsDisplayMap = (): IFunctionMap => {
  return {
    [FormulaFuncType.Numeric]: {
      name: 'Numeric',
      type: FormulaFuncType.Numeric,
      list: [],
      prevCount: 0,
      sortIndex: -1,
    },
    [FormulaFuncType.Text]: {
      name: 'Text',
      type: FormulaFuncType.Text,
      list: [],
      prevCount: 0,
      sortIndex: -1,
    },
    [FormulaFuncType.Logical]: {
      name: 'Logical',
      type: FormulaFuncType.Logical,
      list: [],
      prevCount: 0,
      sortIndex: -1,
    },
    [FormulaFuncType.DateTime]: {
      name: 'Date',
      type: FormulaFuncType.DateTime,
      list: [],
      prevCount: 0,
      sortIndex: -1,
    },
    [FormulaFuncType.Array]: {
      name: 'Array',
      type: FormulaFuncType.Array,
      list: [],
      prevCount: 0,
      sortIndex: -1,
    },
    [FormulaFuncType.System]: {
      name: 'System',
      type: FormulaFuncType.System,
      list: [],
      prevCount: 0,
      sortIndex: -1,
    },
  };
};

export const FORMULA_FUNCTIONS_MAP = new Map<FunctionName, IFunctionSchema<FunctionName>>([
  // Numeric
  [
    FunctionName.Sum,
    {
      name: FunctionName.Sum,
      func: FUNCTIONS[FunctionName.Sum],
      params: ['number1', '[number2, ...]'],
      definition: 'SUM(number1, [number2, ...])',
      summary: 'Sum together the numbers. Equivalent to number1 + number2 + ...',
      example: 'SUM(100, 200, 300) => 600',
    },
  ],
  [
    FunctionName.Average,
    {
      name: FunctionName.Average,
      func: FUNCTIONS[FunctionName.Average],
      params: ['number1', '[number2, ...]'],
      definition: 'AVERAGE(number1, [number2, ...])',
      summary: 'Returns the average of the numbers.',
      example: 'AVERAGE(100, 200, 300) => 200',
    },
  ],
  [
    FunctionName.Max,
    {
      name: FunctionName.Max,
      func: FUNCTIONS[FunctionName.Max],
      params: ['number1', '[number2, ...]'],
      definition: 'MAX(number1, [number2, ...])',
      summary: 'Returns the largest of the given numbers.',
      example: 'MAX(100, 200, 300) => 300',
    },
  ],
  [
    FunctionName.Min,
    {
      name: FunctionName.Min,
      func: FUNCTIONS[FunctionName.Min],
      params: ['number1', '[number2, ...]'],
      definition: 'MIN(number1, [number2, ...])',
      summary: 'Returns the smallest of the given numbers.',
      example: 'MIN(100, 200, 300) => 100',
    },
  ],
  [
    FunctionName.Round,
    {
      name: FunctionName.Round,
      func: FUNCTIONS[FunctionName.Round],
      params: ['value', '[precision]'],
      definition: 'ROUND(value, [precision])',
      summary:
        'Rounds the value to the number of decimal places given by "precision" (Specifically, ROUND will round to the nearest integer at the specified precision, with ties broken by rounding half up toward positive infinity.)',
      example: 'ROUND(1.99, 0) => 2\nROUND(16.8, -1) => 20',
    },
  ],
  [
    FunctionName.RoundUp,
    {
      name: FunctionName.RoundUp,
      func: FUNCTIONS[FunctionName.RoundUp],
      params: ['value', '[precision]'],
      definition: 'ROUNDUP(value, [precision])',
      summary:
        'Rounds the value to the number of decimal places given by "precision" always rounding up, i.e., away from zero. (You must give a value for the precision or the function will not work.)',
      example: 'ROUNDUP(1.1, 0) => 2\nROUNDUP(-1.1, 0) => -2',
    },
  ],
  [
    FunctionName.RoundDown,
    {
      name: FunctionName.RoundDown,
      func: FUNCTIONS[FunctionName.RoundDown],
      params: ['value', '[precision]'],
      definition: 'ROUNDDOWN(value, [precision])',
      summary:
        'Rounds the value to the number of decimal places given by "precision" always rounding down, i.e., toward zero. (You must give a value for the precision or the function will not work.)',
      example: 'ROUNDDOWN(1.9, 0) => 1\nROUNDDOWN(-1.9, 0) => -1',
    },
  ],
  [
    FunctionName.Ceiling,
    {
      name: FunctionName.Ceiling,
      func: FUNCTIONS[FunctionName.Ceiling],
      params: ['value', '[significance]'],
      definition: 'CEILING(value, [significance])',
      summary:
        'Returns the nearest integer multiple of significance that is greater than or equal to the value. If no significance is provided, a significance of 1 is assumed.',
      example: 'CEILING(2.49) => 3\nCEILING(2.49, 1) => 2.5\nCEILING(2.49, -1) => 10',
    },
  ],
  [
    FunctionName.Floor,
    {
      name: FunctionName.Floor,
      func: FUNCTIONS[FunctionName.Floor],
      params: ['value', '[significance]'],
      definition: 'FLOOR(value, [significance])',
      summary:
        'Returns the nearest integer multiple of significance that is less than or equal to the value. If no significance is provided, a significance of 1 is assumed.',
      example: 'FLOOR(2.49) => 2\nFLOOR(2.49, 1) => 2.4\nFLOOR(2.49, -1) => 0',
    },
  ],
  [
    FunctionName.Even,
    {
      name: FunctionName.Even,
      func: FUNCTIONS[FunctionName.Even],
      params: ['value'],
      definition: 'EVEN(value)',
      summary:
        'Returns the smallest even integer that is greater than or equal to the specified value.',
      example: 'EVEN(0.1) => 2\nEVEN(-0.1) => -2',
    },
  ],
  [
    FunctionName.Odd,
    {
      name: FunctionName.Odd,
      func: FUNCTIONS[FunctionName.Odd],
      params: ['value'],
      definition: 'ODD(value)',
      summary:
        'Rounds positive value up the the nearest odd number and negative value down to the nearest odd number.',
      example: 'ODD(0.1) => 1\nODD(-0.1) => -1',
    },
  ],
  [
    FunctionName.Int,
    {
      name: FunctionName.Int,
      func: FUNCTIONS[FunctionName.Int],
      params: ['value'],
      definition: 'INT(value)',
      summary:
        'Returns number1 if the logical argument is true, otherwise it returns number2. Can also be used to make nested IF statements.\nCan also be used to check if a cell is blank/is empty.',
      example: 'INT(1.9) => 1\nINT(-1.9) => -2',
    },
  ],
  [
    FunctionName.Abs,
    {
      name: FunctionName.Abs,
      func: FUNCTIONS[FunctionName.Abs],
      params: ['value'],
      definition: 'ABS(value)',
      summary: 'Returns the absolute value.',
      example: 'ABS(-1) => 1',
    },
  ],
  [
    FunctionName.Sqrt,
    {
      name: FunctionName.Sqrt,
      func: FUNCTIONS[FunctionName.Sqrt],
      params: ['value'],
      definition: 'SQRT(value)',
      summary: 'Returns the square root of a nonnegative number.',
      example: 'SQRT(4) => 2',
    },
  ],
  [
    FunctionName.Power,
    {
      name: FunctionName.Power,
      func: FUNCTIONS[FunctionName.Power],
      params: ['value'],
      definition: 'POWER(value)',
      summary: 'Computes the specified base to the specified power.',
      example: 'POWER(2) => 4',
    },
  ],
  [
    FunctionName.Exp,
    {
      name: FunctionName.Exp,
      func: FUNCTIONS[FunctionName.Exp],
      params: ['value'],
      definition: 'EXP(value)',
      summary: 'Computes Euler number (e) to the specified power.',
      example: 'EXP(0) => 1\nEXP(1) => 2.718',
    },
  ],
  [
    FunctionName.Log,
    {
      name: FunctionName.Log,
      func: FUNCTIONS[FunctionName.Log],
      params: ['value', '[base=10]'],
      definition: 'LOG(number, [base=10]))',
      summary:
        'Computes the logarithm of the value in provided base. The base defaults to 10 if not specified.',
      example: 'LOG(100) => 2\nLOG(1024, 2) => 10',
    },
  ],
  [
    FunctionName.Mod,
    {
      name: FunctionName.Mod,
      func: FUNCTIONS[FunctionName.Mod],
      params: ['value', 'divisor'],
      definition: 'MOD(value, divisor)',
      summary: 'Returns the remainder after dividing the first argument by the second.',
      example: 'MOD(9, 2) => 1\nMOD(9, 3) => 0',
    },
  ],
  [
    FunctionName.Value,
    {
      name: FunctionName.Value,
      func: FUNCTIONS[FunctionName.Value],
      params: ['text'],
      definition: 'VALUE(text)',
      summary: 'Converts the text string to a number.',
      example: 'VALUE("$1,000,000") => 1000000',
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
      summary: 'Joins together various value types arguments into a single text value.',
      example: 'CONCATENATE("Hello ", "Teable") => Hello Teable',
    },
  ],
  [
    FunctionName.Find,
    {
      name: FunctionName.Find,
      func: FUNCTIONS[FunctionName.Find],
      params: ['stringToFind', 'whereToSearch', '[startFromPosition]'],
      definition: 'FIND(stringToFind, whereToSearch, [startFromPosition])',
      summary:
        'Finds an occurrence of stringToFind in whereToSearch string starting from an optional startFromPosition.(startFromPosition is 0 by default.) If no occurrence of stringToFind is found, the result will be 0.',
      example:
        'FIND("Teable", "Hello Teable") => 7\nFIND("Teable", "Hello Teable", 5) => 7\nFIND("Teable", "Hello Teable", 10) => 0',
    },
  ],
  [
    FunctionName.Search,
    {
      name: FunctionName.Search,
      func: FUNCTIONS[FunctionName.Search],
      params: ['stringToFind', 'whereToSearch', '[startFromPosition]'],
      definition: 'SEARCH(stringToFind, whereToSearch, [startFromPosition])',
      summary:
        'Searches for an occurrence of stringToFind in whereToSearch string starting from an optional startFromPosition. (startFromPosition is 0 by default.) If no occurrence of stringToFind is found, the result will be empty.\nSimilar to FIND(), though FIND() returns 0 rather than empty if no occurrence of stringToFind is found.',
      example:
        'SEARCH("Teable", "Hello Teable") => 7\nSEARCH("Teable", "Hello Teable", 5) => 7\nSEARCH("Teable", "Hello Teable", 10) => ""',
    },
  ],
  [
    FunctionName.Mid,
    {
      name: FunctionName.Mid,
      func: FUNCTIONS[FunctionName.Mid],
      params: ['text', 'whereToStart', 'count'],
      definition: 'MID(text, whereToStart, count)',
      summary: 'Extract a substring of count characters starting at whereToStart.',
      example: 'MID("Hello Teable", 6, 6) => "Teable"',
    },
  ],
  [
    FunctionName.Left,
    {
      name: FunctionName.Left,
      func: FUNCTIONS[FunctionName.Left],
      params: ['text', 'count'],
      definition: 'LEFT(text, count)',
      summary: 'Extract howMany characters from the beginning of the string.',
      example: 'LEFT("2023-09-06", 4) => "2023"',
    },
  ],
  [
    FunctionName.Right,
    {
      name: FunctionName.Right,
      func: FUNCTIONS[FunctionName.Right],
      params: ['text', 'count'],
      definition: 'RIGHT(text, count)',
      summary: 'Extract howMany characters from the ending of the string.',
      example: 'RIGHT("2023-09-06", 5) => "09-06"',
    },
  ],
  [
    FunctionName.Replace,
    {
      name: FunctionName.Replace,
      func: FUNCTIONS[FunctionName.Replace],
      params: ['text', 'whereToStart', 'count', 'replacement'],
      definition: 'REPLACE(text, whereToStart, count, replacement)',
      summary:
        'Replaces the number of characters beginning with the start character with the replacement text.\n(If you are looking for a way to find and replace all occurrences of old_text with new_text, see SUBSTITUTE().)',
      example: 'REPLACE("Hello Table", 7, 5, "Teable") => "Hello Teable"',
    },
  ],
  [
    FunctionName.RegExpReplace,
    {
      name: FunctionName.RegExpReplace,
      func: FUNCTIONS[FunctionName.RegExpReplace],
      params: ['text', 'regular_expression', 'replacement'],
      definition: 'REGEXP_REPLACE(text, regular_expression, replacement)',
      summary: 'Replaces all substrings matching regular expression with replacement.',
      example: 'REGEXP_REPLACE("Hello Table", "H.* ", "") => "Teable"',
    },
  ],
  [
    FunctionName.Substitute,
    {
      name: FunctionName.Substitute,
      func: FUNCTIONS[FunctionName.Substitute],
      params: ['text', 'oldText', 'newText', '[index]'],
      definition: 'SUBSTITUTE(text, oldText, newText, [index])',
      summary:
        'Replaces occurrences of old_text with new_text.\nYou can optionally specify an index number (starting from 1) to replace just a specific occurrence of old_text. If no index number is specified, then all occurrences of old_text will be replaced.',
      example: 'SUBSTITUTE("Hello Table", "Table", "Teable") => "Hello Teable"',
    },
  ],
  [
    FunctionName.Lower,
    {
      name: FunctionName.Lower,
      func: FUNCTIONS[FunctionName.Lower],
      params: ['text'],
      definition: 'LOWER(text)',
      summary: 'Makes a string lowercase.',
      example: 'LOWER("Hello Teable") => "hello teable"',
    },
  ],
  [
    FunctionName.Upper,
    {
      name: FunctionName.Upper,
      func: FUNCTIONS[FunctionName.Upper],
      params: ['text'],
      definition: 'UPPER(text)',
      summary: 'Makes a string uppercase.',
      example: 'UPPER("Hello Teable") => "HELLO TEABLE"',
    },
  ],
  [
    FunctionName.Rept,
    {
      name: FunctionName.Rept,
      func: FUNCTIONS[FunctionName.Rept],
      params: ['text', 'number'],
      definition: 'REPT(text, number)',
      summary: 'Repeats string by the specified number of times.',
      example: 'REPT("Hello!") => "Hello!Hello!Hello!"',
    },
  ],
  [
    FunctionName.Trim,
    {
      name: FunctionName.Trim,
      func: FUNCTIONS[FunctionName.Trim],
      params: ['text'],
      definition: 'TRIM(text)',
      summary: 'Removes whitespace at the beginning and end of string.',
      example: 'TRIM(" Hello ") => "Hello"',
    },
  ],
  [
    FunctionName.Len,
    {
      name: FunctionName.Len,
      func: FUNCTIONS[FunctionName.Len],
      params: ['text'],
      definition: 'LEN(text)',
      summary: 'Extract howMany characters from the beginning of the string.',
      example: 'LEN("Hello") => 5',
    },
  ],
  [
    FunctionName.T,
    {
      name: FunctionName.T,
      func: FUNCTIONS[FunctionName.T],
      params: ['value'],
      definition: 'T(value)',
      summary: 'Returns the argument if it is text and blank otherwise.',
      example: 'T("Hello") => "Hello"\nT(100) => null',
    },
  ],
  [
    FunctionName.EncodeUrlComponent,
    {
      name: FunctionName.EncodeUrlComponent,
      func: FUNCTIONS[FunctionName.EncodeUrlComponent],
      params: ['value'],
      definition: 'ENCODE_URL_COMPONENT(value)',
      summary:
        'Replaces certain characters with encoded equivalents for use in constructing URLs or URIs. Does not encode the following characters: - _ . ~',
      example: 'ENCODE_URL_COMPONENT("Hello Teable") => "Hello%20Teable"',
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
      summary:
        'Returns value1 if the logical argument is true, otherwise it returns value2. Can also be used to make nested IF statements.\nCan also be used to check if a cell is blank/is empty.',
      example: 'IF(2 > 1, "A", "B") => "A"\nIF(2 > 1, TRUE, FALSE) => TRUE',
    },
  ],
  [
    FunctionName.Switch,
    {
      name: FunctionName.Switch,
      func: FUNCTIONS[FunctionName.Switch],
      params: ['expression', '[pattern, result]...', '[default]'],
      definition: 'SWITCH(expression, [pattern, result]..., [default])',
      summary:
        'Takes an expression, a list of possible values for that expression, and for each one, a value that the expression should take in that case. It can also take a default value if the expression input does not match any of the defined patterns. In many cases, SWITCH() can be used instead of a nested IF() formula.',
      example: 'SWITCH("B", "A", "Value A", "B", "Value B", "Default Value") => "Value B"',
    },
  ],
  [
    FunctionName.And,
    {
      name: FunctionName.And,
      func: FUNCTIONS[FunctionName.And],
      params: ['logical1', '[logical2, ...]'],
      definition: 'AND(logical1, [logical2, ...])',
      summary: 'Returns true if all the arguments are true, returns false otherwise.',
      example: 'AND(1 < 2, 5 > 3) => true\nAND(1 < 2, 5 < 3) => false',
    },
  ],
  [
    FunctionName.Or,
    {
      name: FunctionName.Or,
      func: FUNCTIONS[FunctionName.Or],
      params: ['logical1', '[logical2, ...]'],
      definition: 'OR(logical1, [logical2, ...])',
      summary: 'Returns true if any one of the arguments is true.',
      example: 'OR(1 < 2, 5 < 3) => true\nOR(1 > 2, 5 < 3) => false',
    },
  ],
  [
    FunctionName.Xor,
    {
      name: FunctionName.Xor,
      func: FUNCTIONS[FunctionName.Xor],
      params: ['logical1', '[logical2, ...]'],
      definition: 'XOR(logical1, [logical2, ...])',
      summary: 'Returns true if an odd number of arguments are true.',
      example: 'XOR(1 < 2, 5 < 3, 8 < 10) => false\nXOR(1 > 2, 5 < 3, 8 < 10) => true',
    },
  ],
  [
    FunctionName.Not,
    {
      name: FunctionName.Not,
      func: FUNCTIONS[FunctionName.Not],
      params: ['boolean'],
      definition: 'NOT(boolean)',
      summary: 'Reverses the logical value of its argument.',
      example: 'NOT(1 < 2) => false\nNOT(1 > 2) => true',
    },
  ],
  [
    FunctionName.Blank,
    {
      name: FunctionName.Blank,
      func: FUNCTIONS[FunctionName.Blank],
      params: [],
      definition: 'BLANK()',
      summary: 'Returns a blank value.',
      example: 'BLANK() => null\nIF(2 > 3, "Yes", BLANK()) => null',
    },
  ],
  [
    FunctionName.Error,
    {
      name: FunctionName.Error,
      func: FUNCTIONS[FunctionName.Error],
      params: ['message'],
      definition: 'ERROR(message)',
      summary: 'Returns the error value.',
      example: 'IF(2 > 3, "Yes", ERROR("Calculation")) => "#ERROR: Calculation"',
    },
  ],
  [
    FunctionName.IsError,
    {
      name: FunctionName.IsError,
      func: FUNCTIONS[FunctionName.IsError],
      params: ['expr'],
      definition: 'IS_ERROR(expr)',
      summary: 'Returns true if the expression causes an error.',
      example: 'IS_ERROR(ERROR()) => true',
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
      summary: 'Returns the current date.',
      example: 'TODAY() => "2023-09-08 00:00"',
    },
  ],
  [
    FunctionName.Now,
    {
      name: FunctionName.Now,
      func: FUNCTIONS[FunctionName.Now],
      params: [],
      definition: 'NOW()',
      summary: 'Returns the current date and time.',
      example: 'NOW() => "2023-09-08 16:50"',
    },
  ],
  [
    FunctionName.Year,
    {
      name: FunctionName.Year,
      func: FUNCTIONS[FunctionName.Year],
      params: ['date'],
      definition: 'YEAR(date)',
      summary: 'Returns the four-digit year of a datetime.',
      example: 'YEAR("2023-09-08") => 2023',
    },
  ],
  [
    FunctionName.Month,
    {
      name: FunctionName.Month,
      func: FUNCTIONS[FunctionName.Month],
      params: ['date'],
      definition: 'MONTH(date)',
      summary: 'Returns the month of a datetime as a number between 1 (January) and 12 (December).',
      example: 'MONTH("2023-09-08") => 9',
    },
  ],
  [
    FunctionName.WeekNum,
    {
      name: FunctionName.WeekNum,
      func: FUNCTIONS[FunctionName.WeekNum],
      params: ['date'],
      definition: 'WEEKNUM(date)',
      summary: 'Returns the week number in a year.',
      example: 'WEEKNUM("2023-09-08") => 36',
    },
  ],
  [
    FunctionName.Weekday,
    {
      name: FunctionName.Weekday,
      func: FUNCTIONS[FunctionName.Weekday],
      params: ['date', '[startDayOfWeek]'],
      definition: 'WEEKDAY(date, [startDayOfWeek])',
      summary:
        'Returns the day of the week as an integer between 0 and 6, inclusive. You may optionally provide a second argument (either "Sunday" or "Monday") to start weeks on that day. If omitted, weeks start on Sunday by default. Example:\nWEEKDAY(TODAY(), "Monday")',
      example: 'WEEKNUM("2023-09-08") => 5',
    },
  ],
  [
    FunctionName.Day,
    {
      name: FunctionName.Day,
      func: FUNCTIONS[FunctionName.Day],
      params: ['date'],
      definition: 'DAY(date, [startDayOfWeek])',
      summary: 'Returns the day of the month of a datetime in the form of a number between 1-31.',
      example: 'DAY("2023-09-08") => 8',
    },
  ],
  [
    FunctionName.Hour,
    {
      name: FunctionName.Hour,
      func: FUNCTIONS[FunctionName.Hour],
      params: ['date'],
      definition: 'HOUR(date, [startDayOfWeek])',
      summary: 'Returns the hour of a datetime as a number between 0 (12:00am) and 23 (11:00pm).',
      example: 'HOUR("2023-09-08 16:50") => 16',
    },
  ],
  [
    FunctionName.Minute,
    {
      name: FunctionName.Minute,
      func: FUNCTIONS[FunctionName.Minute],
      params: ['date'],
      definition: 'MINUTE(date, [startDayOfWeek])',
      summary: 'Returns the minute of a datetime as an integer between 0 and 59.',
      example: 'MINUTE("2023-09-08 16:50") => 50',
    },
  ],
  [
    FunctionName.Second,
    {
      name: FunctionName.Second,
      func: FUNCTIONS[FunctionName.Second],
      params: ['date'],
      definition: 'SECOND(date, [startDayOfWeek])',
      summary: 'Returns the second of a datetime as an integer between 0 and 59.',
      example: 'SECOND("2023-09-08 16:50:30") => 30',
    },
  ],
  [
    FunctionName.FromNow,
    {
      name: FunctionName.FromNow,
      func: FUNCTIONS[FunctionName.FromNow],
      params: ['date', 'unit'],
      definition: 'FROMNOW(date, unit)',
      summary: 'Calculates the number of days between the current date and another date.',
      example: 'FROMNOW({Date}, "day") => 25',
    },
  ],
  [
    FunctionName.ToNow,
    {
      name: FunctionName.ToNow,
      func: FUNCTIONS[FunctionName.ToNow],
      params: ['date', 'unit'],
      definition: 'TONOW(date, unit)',
      summary: 'Calculates the number of days between the current date and another date.',
      example: 'TONOW({Date}, "day") => 25',
    },
  ],
  [
    FunctionName.DatetimeDiff,
    {
      name: FunctionName.DatetimeDiff,
      func: FUNCTIONS[FunctionName.DatetimeDiff],
      params: ['date1', 'date2', '[unit]'],
      definition: 'DATETIME_DIFF(date1, date2, [unit])',
      summary:
        'Returns the difference between datetimes in specified units. Default units are seconds. (See list of unit specifiers here.)\nThe difference between datetimes is determined by subtracting [date2] from [date1]. This means that if [date2] is later than [date1], the resulting value will be negative.',
      example: 'DATETIME_DIFF("2022-08-01", "2023-09-08", "day") => 403',
    },
  ],
  [
    FunctionName.Workday,
    {
      name: FunctionName.Workday,
      func: FUNCTIONS[FunctionName.Workday],
      params: ['date', 'count', '[holidayStr]'],
      definition: 'WORKDAY(date, count, [holidayStr])',
      summary: 'Returns the workday to the start date, excluding the specified holidays',
      example:
        'WORKDAY("2023-09-08", 200) => "2024-06-14 00:00:00"\nWORKDAY("2023-09-08", 200, "2024-01-22, 2024-01-23, 2024-01-24, 2024-01-25") => "2024-06-20 00:00:00"',
    },
  ],
  [
    FunctionName.WorkdayDiff,
    {
      name: FunctionName.WorkdayDiff,
      func: FUNCTIONS[FunctionName.WorkdayDiff],
      params: ['date1', 'date2', '[holidayStr]'],
      definition: 'WORKDAY_DIFF(date1, date2, [holidayStr])',
      summary:
        'Returns the number of working days between date1 and date2. Working days exclude weekends and an optional list of holidays, formatted as a comma-separated string of ISO-formatted dates.',
      example:
        'WORKDAY_DIFF("2023-06-18", "2023-10-01") => 75\nWORKDAY("2023-06-18", "2023-10-01", "2023-07-12, 2023-08-18, 2023-08-19") => 73',
    },
  ],
  [
    FunctionName.IsSame,
    {
      name: FunctionName.IsSame,
      func: FUNCTIONS[FunctionName.IsSame],
      params: ['date1', 'date2', '[unit]'],
      definition: 'IS_SAME(date1, date2, [unit])',
      summary:
        'Compares two dates up to a unit and determines whether they are identical. Returns true if yes, false if no.',
      example:
        'IS_SAME("2023-09-08", "2023-09-10") => false\nIS_SAME("2023-09-08", "2023-09-10", "month") => true',
    },
  ],
  [
    FunctionName.IsAfter,
    {
      name: FunctionName.IsAfter,
      func: FUNCTIONS[FunctionName.IsAfter],
      params: ['date1', 'date2', '[unit]'],
      definition: 'IS_AFTER(date1, date2, [unit])',
      summary: 'Determines if date1 is later than date2. Returns true if yes, false if no.',
      example:
        'IS_AFTER("2023-09-10", "2023-09-08") => true\nIS_AFTER("2023-09-10", "2023-09-08", "month") => false',
    },
  ],
  [
    FunctionName.IsBefore,
    {
      name: FunctionName.IsBefore,
      func: FUNCTIONS[FunctionName.IsBefore],
      params: ['date1', 'date2', '[unit]'],
      definition: 'IS_BEFORE(date1, date2, [unit])',
      summary: 'Determines if date1 is earlier than date2. Returns true if yes, false if no.',
      example:
        'IS_BEFORE("2023-09-08", "2023-09-10") => true\nIS_BEFORE("2023-09-08", "2023-09-10", "month") => false',
    },
  ],
  [
    FunctionName.DateAdd,
    {
      name: FunctionName.DateAdd,
      func: FUNCTIONS[FunctionName.DateAdd],
      params: ['date1', 'date2', '[unit]'],
      definition: 'DATE_ADD(date, count, units)',
      summary: 'Adds specified "count" units to a datetime.',
      example: 'DATE_ADD("2023-09-08 18:00:00", 10, "day") => "2023-09-18 18:00:00"',
    },
  ],
  [
    FunctionName.Datestr,
    {
      name: FunctionName.Datestr,
      func: FUNCTIONS[FunctionName.Datestr],
      params: ['date'],
      definition: 'DATESTR(date)',
      summary: 'Formats a datetime into a string (YYYY-MM-DD).',
      example: 'DATESTR("2023/09/08") => "2023-09-08"',
    },
  ],
  [
    FunctionName.Timestr,
    {
      name: FunctionName.Timestr,
      func: FUNCTIONS[FunctionName.Timestr],
      params: ['date'],
      definition: 'TIMESTR(date)',
      summary: 'Formats a datetime into a time-only string (HH:mm:ss).',
      example: 'DATESTR("2023/09/08 16:50:30") => "16:50:30"',
    },
  ],
  [
    FunctionName.DatetimeFormat,
    {
      name: FunctionName.DatetimeFormat,
      func: FUNCTIONS[FunctionName.DatetimeFormat],
      params: ['date', '[specified_output_format]'],
      definition: 'DATETIME_FORMAT(date, [specified_output_format])',
      summary:
        'Formats a datetime into a specified string. For an explanation of how to use this function with date fields, click here. For a list of supported format specifiers, please click here.',
      example: 'DATETIME_FORMAT("2023-09-08", "DD-MM-YYYY") => "08-09-2023"',
    },
  ],
  [
    FunctionName.DatetimeParse,
    {
      name: FunctionName.DatetimeParse,
      func: FUNCTIONS[FunctionName.DatetimeParse],
      params: ['date', '[input_format]'],
      definition: 'DATETIME_PARSE(date, [input_format])',
      summary:
        'Interprets a text string as a structured date, with optional input format and locale parameters. The output format will always be formatted "M/D/YYYY h:mm a".',
      example: 'DATETIME_PARSE("8 Sep 2023 18:00", "D MMM YYYY HH:mm") => "2023-09-08 18:00:00"',
    },
  ],
  [
    FunctionName.CreatedTime,
    {
      name: FunctionName.CreatedTime,
      func: FUNCTIONS[FunctionName.CreatedTime],
      params: [],
      definition: 'CREATED_TIME()',
      summary: 'Returns the creation time of the current record.',
      example: 'CREATED_TIME() => "2023-09-08 18:00:00"',
    },
  ],
  [
    FunctionName.LastModifiedTime,
    {
      name: FunctionName.LastModifiedTime,
      func: FUNCTIONS[FunctionName.LastModifiedTime],
      params: [],
      definition: 'LAST_MODIFIED_TIME()',
      summary:
        'Returns the date and time of the most recent modification made by a user in a non-computed field in the table.',
      example: 'LAST_MODIFIED_TIME() => "2023-09-08 18:00:00"',
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
      summary: 'Returns the number of all elements including text and blanks.',
      example: 'COUNTALL(100, 200, "", "Teable", TRUE()) => 5',
    },
  ],
  [
    FunctionName.CountA,
    {
      name: FunctionName.CountA,
      func: FUNCTIONS[FunctionName.CountA],
      params: ['value1', '[value2, ...]'],
      definition: 'COUNTA(value1, [value2, ...])',
      summary:
        'Returns the number of non-empty values. This function counts both numeric and text values.',
      example: 'COUNTA(100, 200, 300, "", "Teable", TRUE) => 4',
    },
  ],
  [
    FunctionName.Count,
    {
      name: FunctionName.Count,
      func: FUNCTIONS[FunctionName.Count],
      params: ['value1', '[value2, ...]'],
      definition: 'COUNT(value1, [value2, ...])',
      summary: 'Returns the number of numeric items.',
      example: 'COUNT(100, 200, 300, "", "Teable", TRUE) => 3',
    },
  ],
  [
    FunctionName.ArrayJoin,
    {
      name: FunctionName.ArrayJoin,
      func: FUNCTIONS[FunctionName.ArrayJoin],
      params: ['array', '[separator]'],
      definition: 'ARRAY_JOIN(array, [separator])',
      summary: 'Join the array of rollup items into a string with a separator.',
      example: 'ARRAY_JOIN(["Tom", "Jerry", "Mike"], "; ") => "Tom; Jerry; Mike"',
    },
  ],
  [
    FunctionName.ArrayUnique,
    {
      name: FunctionName.ArrayUnique,
      func: FUNCTIONS[FunctionName.ArrayUnique],
      params: ['array'],
      definition: 'ARRAY_UNIQUE(array)',
      summary: 'Returns only unique items in the array.',
      example: 'ARRAY_UNIQUE([1, 2, 3, 2, 1]) => [1, 2, 3]',
    },
  ],
  [
    FunctionName.ArrayFlatten,
    {
      name: FunctionName.ArrayFlatten,
      func: FUNCTIONS[FunctionName.ArrayFlatten],
      params: ['array'],
      definition: 'ARRAY_FLATTEN(array)',
      summary:
        'Flattens the array by removing any array nesting. All items become elements of a single array.',
      example: 'ARRAY_FLATTEN([1, 2, " ", 3, true], ["ABC"]) => [1, 2, 3, " ", true, "ABC"]',
    },
  ],
  [
    FunctionName.ArrayCompact,
    {
      name: FunctionName.ArrayCompact,
      func: FUNCTIONS[FunctionName.ArrayCompact],
      params: ['array'],
      definition: 'ARRAY_COMPACT(array)',
      summary:
        'Removes empty strings and null values from the array. Keeps "false" and strings that contain one or more blank characters.',
      example: 'ARRAY_COMPACT([1, 2, 3, "", null, "ABC"]) => [1, 2, 3, "ABC"]',
    },
  ],
  [
    FunctionName.RecordId,
    {
      name: FunctionName.RecordId,
      func: FUNCTIONS[FunctionName.RecordId],
      params: [],
      definition: 'RECORD_ID()',
      summary: 'Returns the ID of the current record.',
      example: 'RECORD_ID() => "recxxxxxx"',
    },
  ],
  [
    FunctionName.AutoNumber,
    {
      name: FunctionName.AutoNumber,
      func: FUNCTIONS[FunctionName.AutoNumber],
      params: [],
      definition: 'AUTO_NUMBER()',
      summary: 'Returns the unique and incremented numbers for each record.',
      example: 'RECORD_ID() => 1',
    },
  ],
]);

export const DEFAULT_FUNCTION_GUIDE = {
  name: 'Formula',
  summary:
    'Fill in variables, operational characters, and functions to form formulas for calculations.',
  example:
    'Quoting the Column: {Field name}\n\nUsing operator: 100 * 2 + 300\n\nUsing function: SUM({Number Field 1}, 100)\n\nUsing IF statement: \nIF(logical condition, "value 1", "value 2")',
};
