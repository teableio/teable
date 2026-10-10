import { defaultFormulaSourceBudgetLimits } from '@teable/formula';
import type { CommandBusNext, ICommandBusMiddleware, IExecutionContext } from '@teable/v2-core';
import {
  defaultFormulaCompileBudgetConfig,
  type FormulaCompileBudgetConfig,
} from '@teable/v2-formula-sql-pg';

/** Supplies the same pure policy to source parsing in handlers, before plugin preparation. */
export class FormulaSourceBudgetCommandBusMiddleware implements ICommandBusMiddleware {
  private readonly sourceBudget;
  constructor(config: FormulaCompileBudgetConfig = defaultFormulaCompileBudgetConfig) {
    this.sourceBudget = Object.freeze({
      ...defaultFormulaSourceBudgetLimits,
      policyVersion: config.policyVersion,
      check: (metric: 'astDepth' | 'visitedNodes' | 'referenceDepth', attempted: number) =>
        config.policy.check(metric, attempted),
    });
  }
  handle<TCommand, TResult>(
    context: IExecutionContext,
    command: TCommand,
    next: CommandBusNext<TCommand, TResult>
  ) {
    return next(
      { ...context, config: { ...context.config, formulaSourceBudget: this.sourceBudget } },
      command
    );
  }
}
