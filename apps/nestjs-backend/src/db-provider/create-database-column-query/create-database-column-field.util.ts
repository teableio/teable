import type { FormulaFieldCore, TableDomain } from '@teable/core';
import type { IGeneratedColumnQuerySupportValidator } from '../../features/record/query-builder/sql-conversion.visitor';

export function validateGeneratedColumnSupport(
  _field: FormulaFieldCore,
  _supportValidator: IGeneratedColumnQuerySupportValidator,
  _tableDomain: TableDomain
): boolean {
  // Temporarily disable persisting formulas as generated columns to avoid
  // PostgreSQL restrictions (e.g., subqueries) that surface during field
  // creation/duplication. All formulas should be computed via the runtime
  // pipeline instead of database generated columns.
  return false;
}
