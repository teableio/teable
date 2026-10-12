import { domainError, type DomainError, type FormulaField } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import {
  defaultFormulaCompileBudgetPolicy,
  type FormulaCompileBudgetOptions,
} from './FormulaCompileBudget';

/** Server configuration shared by admission and subsequent recomputation. */
export type FormulaCompileBudgetConfig = Omit<FormulaCompileBudgetOptions, 'mode'>;

export const defaultFormulaCompileBudgetConfig: FormulaCompileBudgetConfig = Object.freeze({
  policy: defaultFormulaCompileBudgetPolicy,
  policyVersion: 1,
});

/** A persisted root owns its mode; referenced legacy fields never weaken that mode. */
export const resolveFormulaCompileBudget = (
  field: FormulaField,
  config: FormulaCompileBudgetConfig = defaultFormulaCompileBudgetConfig
): Result<FormulaCompileBudgetOptions, DomainError> =>
  field
    .formulaSafetyVersion()
    .andThen((version): Result<FormulaCompileBudgetOptions, DomainError> => {
      if (config.policyVersion !== 1 || (version !== undefined && version !== 1)) {
        return err(
          domainError.validation({
            code: 'validation.formula_safety_version_unsupported',
            message: 'The formula safety policy version is not supported by this server',
            details: { policyVersion: version ?? config.policyVersion },
          })
        );
      }
      return ok({ ...config, mode: version === undefined ? 'observe' : 'enforce' });
    });
