import { FormulaSupportGeneratedColumnValidator } from '../formula/formula-support-generated-column-validator';
import type {
  IGeneratedColumnQuerySupportValidator,
  IFieldMap,
} from '../formula/function-convertor.interface';

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
  fieldMap?: IFieldMap
): boolean {
  const validator = new FormulaSupportGeneratedColumnValidator(supportValidator, fieldMap);
  return validator.validateFormula(expression);
}
