import { FormulaSupportValidator } from '../formula/formula-support-validator';
import type { IGeneratedColumnQuerySupportValidator } from '../formula/function-convertor.interface';

/**
 * Pure function to validate if a formula expression is supported for generated columns
 * @param supportValidator The database-specific support validator
 * @param expression The formula expression to validate
 * @returns true if the formula is supported, false otherwise
 */
export function validateFormulaSupport(
  supportValidator: IGeneratedColumnQuerySupportValidator,
  expression: string
): boolean {
  const validator = new FormulaSupportValidator(supportValidator);
  return validator.validateFormula(expression);
}
