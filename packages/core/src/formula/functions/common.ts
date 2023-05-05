import type { FieldCore, IRecord } from '../../models';
import { CellValueType } from '../../models';
import type { FlatTypedValue } from '../typed-value';

export enum FormulaFuncType {
  Array = 'Array',
  DateTime = 'DataTime',
  Logical = 'Logical',
  Numeric = 'Numeric',
  Record = 'Record',
  Text = 'Text',
}

export interface IFormulaContext {
  record: IRecord;
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
  acceptCellValueType = new Set([
    CellValueType.Boolean,
    CellValueType.Number,
    CellValueType.String,
  ]);

  /**
   * The function needs to perform parameter type and quantity verification during the AST tree parsing phase. If the requirements of the function are not met, throw a new Error with a friendly prompt.
   * Error throwing principles:
   * 1. Throw an error if required parameters are missing, ignore extra parameters
   * 2. Throw an error for parameter types that cannot be converted or ignored
   * 3. The function name should be clearly stated in the error message
   * 4. Arabic numerals such as "3" should be used instead of Chinese characters such as "三" in error messages regarding numbers.
   */
  abstract validateParams(params: FlatTypedValue[]): boolean;

  /**
   * @param params The parameter is optional. When the parameter is not passed, it returns a static default type. When the parameter is passed, different functions dynamically calculate the return type based on the parameter type.
   * The function return type can be directly inferred from AstNode without obtaining actual values.
   */
  abstract getReturnType(params?: FlatTypedValue[]): {
    type: CellValueType;
    elementType?: CellValueType;
  };

  // function implementation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abstract eval(params: FlatTypedValue[], context: IFormulaContext): any;
}

export enum FunctionName {
  Sum = 'SUM',
}
