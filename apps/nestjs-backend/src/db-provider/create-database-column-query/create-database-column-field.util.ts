import type { FormulaFieldCore, TableDomain } from '@teable/core';
import { validateFormulaSupport } from '../../features/record/query-builder/formula-validation';
import type { IGeneratedColumnQuerySupportValidator } from '../../features/record/query-builder/sql-conversion.visitor';

export function validateGeneratedColumnSupport(
  field: FormulaFieldCore,
  supportValidator: IGeneratedColumnQuerySupportValidator,
  tableDomain: TableDomain
): boolean {
  const expression = field.getExpression();
  return validateFormulaSupport(supportValidator, expression, tableDomain);
}
