import { FormulaSupportGeneratedColumnValidator } from '../formula/formula-support-generated-column-validator';
import type { IGeneratedColumnQuerySupportValidator } from '../formula/function-convertor.interface';
import type { TableDomain } from '../models';

/**
 * Pure function to validate if a formula expression is supported for generated columns
 * @param supportValidator The database-specific support validator
 * @param expression The formula expression to validate
 * @param fieldMap Optional field map to check field references
 * @returns true if the formula is supported, false otherwise
 */
export function validateFormulaSupport(
  supportValidator: IGeneratedColumnQuerySupportValidator,
  expression: string,
  tableDomain: TableDomain
): boolean {
  const validator = new FormulaSupportGeneratedColumnValidator(supportValidator, tableDomain);
  return validator.validateFormula(expression);
}
