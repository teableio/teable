import type { CellValueType } from '../../models/field/constant';
import type { FieldCore } from '../../models/field/field';
import type { IRecord } from '../../models/record';
import type { TypedValue } from '../typed-value';

export enum FormulaFuncType {
  Array = 'Array',
  DateTime = 'DataTime',
  Logical = 'Logical',
  Numeric = 'Numeric',
  Text = 'Text',
  System = 'System',
}

export interface IFormulaContext {
  record: IRecord;
  timeZone: string;
  dependencies: { [fieldId: string]: FieldCore };
}

export abstract class FormulaFunc {
  abstract readonly name: FunctionName;

  abstract readonly type: FormulaFuncType;

  /**
   * The value types that can be accepted as function parameters.
   * If the parameter type is not in acceptCellValueType, it will be converted to a string type by the interpreter.
   * If the parameter type is in acceptCellValueType, the original value will be returned and processed by the function implementation itself.
   */
  abstract acceptValueType: Set<CellValueType>;

  abstract acceptMultipleValue: boolean;

  /**
   * The function needs to perform parameter type and quantity verification during the AST tree parsing phase. If the requirements of the function are not met, throw a new Error with a friendly prompt.
   * Error throwing principles:
   * 1. Throw an error if required parameters are missing, ignore extra parameters
   * 2. Throw an error for parameter types that cannot be converted or ignored
   * 3. The function name should be clearly stated in the error message
   * 4. Arabic numerals such as "3" should be used instead of Chinese characters such as "三" in error messages regarding numbers.
   */
  abstract validateParams(params: TypedValue[]): void;

  /**
   * @param params The parameter is optional. When the parameter is not passed, it returns a static default type. When the parameter is passed, different functions dynamically calculate the return type based on the parameter type.
   * The function return type can be directly inferred from AstNode without obtaining actual values.
   */
  abstract getReturnType(params?: TypedValue[]): {
    type: CellValueType;
    isMultiple?: boolean;
  };

  // function implementation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abstract eval(params: TypedValue[], context: IFormulaContext): any;
}

export enum FunctionName {
  // Numeric
  Sum = 'SUM',
  Average = 'AVERAGE',
  Max = 'MAX',
  Min = 'MIN',
  Round = 'ROUND',
  RoundUp = 'ROUNDUP',
  RoundDown = 'ROUNDDOWN',
  Ceiling = 'CEILING',
  Floor = 'FLOOR',
  Even = 'EVEN',
  Odd = 'ODD',
  Int = 'INT',
  Abs = 'ABS',
  Sqrt = 'SQRT',
  Power = 'POWER',
  Exp = 'EXP',
  Log = 'LOG',
  Mod = 'MOD',
  Value = 'VALUE',

  // Text
  Concatenate = 'CONCATENATE',
  Find = 'FIND',
  Search = 'SEARCH',
  Mid = 'MID',
  Left = 'LEFT',
  Right = 'RIGHT',
  Replace = 'REPLACE',
  RegExpReplace = 'REGEXP_REPLACE',
  Substitute = 'SUBSTITUTE',
  Lower = 'LOWER',
  Upper = 'UPPER',
  Rept = 'REPT',
  Trim = 'TRIM',
  Len = 'LEN',
  T = 'T',
  EncodeUrlComponent = 'ENCODE_URL_COMPONENT',

  // Logical
  If = 'IF',
  Switch = 'SWITCH',
  And = 'AND',
  Or = 'OR',
  Xor = 'XOR',
  Not = 'NOT',
  Blank = 'BLANK',
  Error = 'ERROR',
  IsError = 'IS_ERROR',

  // DateTime
  Today = 'TODAY',
  Now = 'NOW',
  Year = 'YEAR',
  Month = 'MONTH',
  WeekNum = 'WEEKNUM',
  Weekday = 'WEEKDAY',
  Day = 'DAY',
  Hour = 'HOUR',
  Minute = 'MINUTE',
  Second = 'SECOND',
  FromNow = 'FROMNOW',
  ToNow = 'TONOW',
  DatetimeDiff = 'DATETIME_DIFF',
  Workday = 'WORKDAY',
  WorkdayDiff = 'WORKDAY_DIFF',
  IsSame = 'IS_SAME',
  IsAfter = 'IS_AFTER',
  IsBefore = 'IS_BEFORE',
  DateAdd = 'DATE_ADD',
  Datestr = 'DATESTR',
  Timestr = 'TIMESTR',
  DatetimeFormat = 'DATETIME_FORMAT',
  DatetimeParse = 'DATETIME_PARSE',
  CreatedTime = 'CREATED_TIME',
  LastModifiedTime = 'LAST_MODIFIED_TIME',

  // Array
  CountAll = 'COUNTALL',
  CountA = 'COUNTA',
  Count = 'COUNT',
  ArrayJoin = 'ARRAY_JOIN',
  ArrayUnique = 'ARRAY_UNIQUE',
  ArrayFlatten = 'ARRAY_FLATTEN',
  ArrayCompact = 'ARRAY_COMPACT',

  // System
  TextAll = 'TEXT_ALL',
  RecordId = 'RECORD_ID',
  AutoNumber = 'AUTO_NUMBER',
}
