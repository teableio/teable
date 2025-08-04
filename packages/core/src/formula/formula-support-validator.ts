import { match } from 'ts-pattern';
import type { IFunctionCallInfo } from './function-call-collector.visitor';
import type { IGeneratedColumnQuerySupportValidator } from './function-convertor.interface';
import { parseFormula, FunctionCallCollectorVisitor } from './index';

/**
 * Validates whether a formula expression is supported for generated column creation
 * by checking if all functions used in the formula are supported by the database provider.
 */
export class FormulaSupportValidator {
  constructor(private readonly supportValidator: IGeneratedColumnQuerySupportValidator) {}

  /**
   * Validates whether a formula expression can be used to create a generated column
   * @param expression The formula expression to validate
   * @returns true if all functions in the formula are supported, false otherwise
   */
  validateFormula(expression: string): boolean {
    try {
      // Parse the formula expression into an AST
      const tree = parseFormula(expression);

      // Extract all function calls from the AST
      const collector = new FunctionCallCollectorVisitor();
      const functionCalls = collector.visit(tree);

      // Check if all functions are supported
      return functionCalls.every((funcCall: IFunctionCallInfo) => {
        return this.isFunctionSupported(funcCall.name, funcCall.paramCount);
      });
    } catch (error) {
      // If parsing fails, the formula is not valid for generated columns
      console.warn(`Failed to parse formula expression: ${expression}`, error);
      return false;
    }
  }

  /**
   * Checks if a specific function is supported for generated columns
   * @param functionName The function name (case-insensitive)
   * @param paramCount The number of parameters (used for validation)
   * @returns true if the function is supported, false otherwise
   */
  private isFunctionSupported(functionName: string, paramCount: number): boolean {
    const funcName = functionName.toUpperCase();

    try {
      return (
        this.checkNumericFunctions(funcName, paramCount) ||
        this.checkTextFunctions(funcName, paramCount) ||
        this.checkDateTimeFunctions(funcName, paramCount) ||
        this.checkLogicalFunctions(funcName, paramCount) ||
        this.checkArrayFunctions(funcName, paramCount) ||
        this.checkSystemFunctions(funcName)
      );
    } catch (error) {
      console.warn(`Error checking support for function ${funcName}:`, error);
      return false;
    }
  }

  private checkNumericFunctions(funcName: string, paramCount: number): boolean {
    const dummyParam = 'dummy';
    const dummyParams = Array(paramCount).fill(dummyParam);

    return match(funcName)
      .with('SUM', () => this.supportValidator.sum(dummyParams))
      .with('AVERAGE', () => this.supportValidator.average(dummyParams))
      .with('MAX', () => this.supportValidator.max(dummyParams))
      .with('MIN', () => this.supportValidator.min(dummyParams))
      .with('ROUND', () =>
        this.supportValidator.round(dummyParam, paramCount > 1 ? dummyParam : undefined)
      )
      .with('ROUNDUP', () =>
        this.supportValidator.roundUp(dummyParam, paramCount > 1 ? dummyParam : undefined)
      )
      .with('ROUNDDOWN', () =>
        this.supportValidator.roundDown(dummyParam, paramCount > 1 ? dummyParam : undefined)
      )
      .with('CEILING', () => this.supportValidator.ceiling(dummyParam))
      .with('FLOOR', () => this.supportValidator.floor(dummyParam))
      .with('EVEN', () => this.supportValidator.even(dummyParam))
      .with('ODD', () => this.supportValidator.odd(dummyParam))
      .with('INT', () => this.supportValidator.int(dummyParam))
      .with('ABS', () => this.supportValidator.abs(dummyParam))
      .with('SQRT', () => this.supportValidator.sqrt(dummyParam))
      .with('POWER', () => this.supportValidator.power(dummyParam, dummyParam))
      .with('EXP', () => this.supportValidator.exp(dummyParam))
      .with('LOG', () =>
        this.supportValidator.log(dummyParam, paramCount > 1 ? dummyParam : undefined)
      )
      .with('MOD', () => this.supportValidator.mod(dummyParam, dummyParam))
      .with('VALUE', () => this.supportValidator.value(dummyParam))
      .otherwise(() => false);
  }

  private checkTextFunctions(funcName: string, paramCount: number): boolean {
    const dummyParam = 'dummy';
    const dummyParams = Array(paramCount).fill(dummyParam);

    return match(funcName)
      .with('CONCATENATE', () => this.supportValidator.concatenate(dummyParams))
      .with('FIND', () =>
        this.supportValidator.find(dummyParam, dummyParam, paramCount > 2 ? dummyParam : undefined)
      )
      .with('SEARCH', () =>
        this.supportValidator.search(
          dummyParam,
          dummyParam,
          paramCount > 2 ? dummyParam : undefined
        )
      )
      .with('MID', () => this.supportValidator.mid(dummyParam, dummyParam, dummyParam))
      .with('LEFT', () => this.supportValidator.left(dummyParam, dummyParam))
      .with('RIGHT', () => this.supportValidator.right(dummyParam, dummyParam))
      .with('REPLACE', () =>
        this.supportValidator.replace(dummyParam, dummyParam, dummyParam, dummyParam)
      )
      .with('REGEX_REPLACE', () =>
        this.supportValidator.regexpReplace(dummyParam, dummyParam, dummyParam)
      )
      .with('SUBSTITUTE', () =>
        this.supportValidator.substitute(
          dummyParam,
          dummyParam,
          dummyParam,
          paramCount > 3 ? dummyParam : undefined
        )
      )
      .with('LOWER', () => this.supportValidator.lower(dummyParam))
      .with('UPPER', () => this.supportValidator.upper(dummyParam))
      .with('REPT', () => this.supportValidator.rept(dummyParam, dummyParam))
      .with('TRIM', () => this.supportValidator.trim(dummyParam))
      .with('LEN', () => this.supportValidator.len(dummyParam))
      .with('T', () => this.supportValidator.t(dummyParam))
      .with('ENCODE_URL_COMPONENT', () => this.supportValidator.encodeUrlComponent(dummyParam))
      .otherwise(() => false);
  }

  private checkDateTimeFunctions(funcName: string, paramCount: number): boolean {
    const dummyParam = 'dummy';

    return match(funcName)
      .with('NOW', () => this.supportValidator.now())
      .with('TODAY', () => this.supportValidator.today())
      .with('DATEADD', () => this.supportValidator.dateAdd(dummyParam, dummyParam, dummyParam))
      .with('DATESTR', () => this.supportValidator.datestr(dummyParam))
      .with('DATETIME_DIFF', () =>
        this.supportValidator.datetimeDiff(dummyParam, dummyParam, dummyParam)
      )
      .with('DATETIME_FORMAT', () => this.supportValidator.datetimeFormat(dummyParam, dummyParam))
      .with('DATETIME_PARSE', () => this.supportValidator.datetimeParse(dummyParam, dummyParam))
      .with('DAY', () => this.supportValidator.day(dummyParam))
      .with('FROMNOW', () => this.supportValidator.fromNow(dummyParam))
      .with('HOUR', () => this.supportValidator.hour(dummyParam))
      .with('IS_AFTER', () => this.supportValidator.isAfter(dummyParam, dummyParam))
      .with('IS_BEFORE', () => this.supportValidator.isBefore(dummyParam, dummyParam))
      .with('IS_SAME', () =>
        this.supportValidator.isSame(
          dummyParam,
          dummyParam,
          paramCount > 2 ? dummyParam : undefined
        )
      )
      .with('LAST_MODIFIED_TIME', () => this.supportValidator.lastModifiedTime())
      .with('MINUTE', () => this.supportValidator.minute(dummyParam))
      .with('MONTH', () => this.supportValidator.month(dummyParam))
      .with('SECOND', () => this.supportValidator.second(dummyParam))
      .with('TIMESTR', () => this.supportValidator.timestr(dummyParam))
      .with('TONOW', () => this.supportValidator.toNow(dummyParam))
      .with('WEEKNUM', () => this.supportValidator.weekNum(dummyParam))
      .with('WEEKDAY', () => this.supportValidator.weekday(dummyParam))
      .with('WORKDAY', () => this.supportValidator.workday(dummyParam, dummyParam))
      .with('WORKDAY_DIFF', () => this.supportValidator.workdayDiff(dummyParam, dummyParam))
      .with('YEAR', () => this.supportValidator.year(dummyParam))
      .with('CREATED_TIME', () => this.supportValidator.createdTime())
      .otherwise(() => false);
  }

  private checkLogicalFunctions(funcName: string, paramCount: number): boolean {
    const dummyParam = 'dummy';
    const dummyParams = Array(paramCount).fill(dummyParam);

    return match(funcName)
      .with('IF', () => this.supportValidator.if(dummyParam, dummyParam, dummyParam))
      .with('AND', () => this.supportValidator.and(dummyParams))
      .with('OR', () => this.supportValidator.or(dummyParams))
      .with('NOT', () => this.supportValidator.not(dummyParam))
      .with('XOR', () => this.supportValidator.xor(dummyParams))
      .with('BLANK', () => this.supportValidator.blank())
      .with('ERROR', () => this.supportValidator.error(dummyParam))
      .with('ISERROR', () => this.supportValidator.isError(dummyParam))
      .with('SWITCH', () => this.supportValidator.switch(dummyParam, [], dummyParam))
      .otherwise(() => false);
  }

  private checkArrayFunctions(funcName: string, paramCount: number): boolean {
    const dummyParam = 'dummy';
    const dummyParams = Array(paramCount).fill(dummyParam);

    return match(funcName)
      .with('COUNT', () => this.supportValidator.count(dummyParams))
      .with('COUNTA', () => this.supportValidator.countA(dummyParams))
      .with('COUNTALL', () => this.supportValidator.countAll(dummyParam))
      .with('ARRAY_JOIN', () =>
        this.supportValidator.arrayJoin(dummyParam, paramCount > 1 ? dummyParam : undefined)
      )
      .with('ARRAY_UNIQUE', () => this.supportValidator.arrayUnique(dummyParam))
      .with('ARRAY_FLATTEN', () => this.supportValidator.arrayFlatten(dummyParam))
      .with('ARRAY_COMPACT', () => this.supportValidator.arrayCompact(dummyParam))
      .otherwise(() => false);
  }

  private checkSystemFunctions(funcName: string): boolean {
    const dummyParam = 'dummy';

    return match(funcName)
      .with('RECORD_ID', () => this.supportValidator.recordId())
      .with('AUTONUMBER', () => this.supportValidator.autoNumber())
      .with('TEXT_ALL', () => this.supportValidator.textAll(dummyParam))
      .otherwise(() => false);
  }
}
