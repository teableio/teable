import type { DependencyContainer } from '@teable/v2-di';
import {
  formulaSqlPgTokens,
  type FormulaCompileBudgetConfig,
  type IPgTypeValidationStrategy,
} from '@teable/v2-formula-sql-pg';

/** Execute and explain must compile with the routed database's formula policy. */
export const resolveDataQueryFormulaSqlOptions = (container: DependencyContainer) => ({
  typeValidationStrategy: container.isRegistered(formulaSqlPgTokens.typeValidationStrategy)
    ? container.resolve<IPgTypeValidationStrategy>(formulaSqlPgTokens.typeValidationStrategy)
    : undefined,
  formulaCompileBudget: container.isRegistered(formulaSqlPgTokens.compileBudget)
    ? container.resolve<FormulaCompileBudgetConfig>(formulaSqlPgTokens.compileBudget)
    : undefined,
});
