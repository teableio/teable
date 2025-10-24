import type { TableDomain } from '@teable/core';
import { FormulaSupportGeneratedColumnValidator } from './formula-support-generated-column-validator';
import type { IGeneratedColumnQuerySupportValidator } from './sql-conversion.visitor';

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
  supportValidator.setContext({ table: tableDomain });
  const validator = new FormulaSupportGeneratedColumnValidator(supportValidator, tableDomain);
  return validator.validateFormula(expression);
}
