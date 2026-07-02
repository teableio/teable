import type { Table } from '@teable/v2-core';

import type { ISchemaRule } from '../core';
import { getRuleRepairHint } from '../core/RuleRepairMetadata';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import {
  createSchemaRulePlanner,
  getSchemaRulePlanningStageDescription,
  type SchemaRulePlannerParams,
} from '../planner/SchemaRulePlanner';
import {
  type SchemaCheckResult,
  pendingResult,
  runningResult,
  successResult,
  errorResult,
  warnResult,
} from './SchemaCheckResult';

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Parameters for creating a SchemaChecker.
 */
export interface SchemaCheckerParams extends SchemaRulePlannerParams {}

const getRuleValidationCtx = (ctx: SchemaRuleContext, rule: ISchemaRule): SchemaRuleContext =>
  rule.validationScope === 'meta'
    ? {
        ...ctx,
        db: ctx.metaDb,
      }
    : ctx;

/**
 * Checks the schema of a table field by field, rule by rule.
 * Yields results as an async generator for streaming.
 */
export class SchemaChecker {
  constructor(private readonly params: SchemaCheckerParams) {}

  private async checkRuleValidity(ctx: SchemaRuleContext, rule: ISchemaRule) {
    return rule.isValid(getRuleValidationCtx(ctx, rule));
  }

  /**
   * Check all fields in a table.
   * Yields check results one by one for each rule.
   */
  async *checkTable(table: Table): AsyncGenerator<SchemaCheckResult, void, unknown> {
    const planner = createSchemaRulePlanner(this.params);
    for (const planEntry of planner.planTable(table)) {
      await yieldToEventLoop();
      if (planEntry.type === 'error') {
        yield errorResult(
          pendingResult(
            planEntry.fieldId,
            planEntry.fieldName,
            planEntry.stage,
            getSchemaRulePlanningStageDescription(planEntry.stage),
            true,
            [],
            0
          ),
          planEntry.message
        );
        continue;
      }

      const { fieldId, fieldName, ctx, selectedRules, ruleDepths } = planEntry;
      const validatedRules = new Map<string, boolean>();

      for (const rule of selectedRules) {
        const depth = ruleDepths.get(rule.id) ?? 0;
        const pending = pendingResult(
          fieldId,
          fieldName,
          rule.id,
          rule.description,
          rule.required,
          rule.dependencies,
          depth
        );

        const dependenciesSatisfied = rule.dependencies.every((depId) => {
          const depResult = validatedRules.get(depId);
          return depResult === true;
        });

        if (!dependenciesSatisfied) {
          const missingDeps = rule.dependencies.filter((d) => validatedRules.get(d) !== true);
          if (rule.required) {
            yield errorResult(pending, 'Skipped: dependencies not satisfied', {
              missing: missingDeps,
            });
            validatedRules.set(rule.id, false);
          } else {
            yield warnResult(pending, 'Skipped: dependencies not satisfied', {
              missing: missingDeps,
            });
            validatedRules.set(rule.id, true);
          }
          continue;
        }

        yield runningResult(pending);

        try {
          const validationResult = await this.checkRuleValidity(ctx, rule);

          if (validationResult.isErr()) {
            yield errorResult(pending, validationResult.error.message);
            validatedRules.set(rule.id, false);
            continue;
          }

          const validation = validationResult.value;

          if (validation.valid) {
            yield successResult(pending);
            validatedRules.set(rule.id, true);
          } else {
            const details = {
              missing: validation.missing,
              missingItems: validation.missingItems,
              extra: validation.extra,
              extraItems: validation.extraItems,
            };
            const validationCtx = getRuleValidationCtx(ctx, rule);
            const repairResult = getRuleRepairHint(rule, validationCtx, validation, {
              skipStatementCheck: true,
            });
            const repair = repairResult.isOk() ? repairResult.value : undefined;

            if (rule.required) {
              yield {
                ...errorResult(pending, 'Schema validation failed', details),
                repair,
              };
              validatedRules.set(rule.id, false);
            } else {
              yield {
                ...warnResult(pending, 'Schema element missing', details),
                repair,
              };
              validatedRules.set(rule.id, true);
            }
          }
        } catch (e) {
          yield errorResult(
            pending,
            e instanceof Error ? e.message : 'Unknown error during validation'
          );
          validatedRules.set(rule.id, false);
        }
        await yieldToEventLoop();
      }
    }
  }

  /**
   * Check a single field.
   * Yields check results one by one for each rule.
   */
  async *checkField(
    table: Table,
    fieldId: string
  ): AsyncGenerator<SchemaCheckResult, void, unknown> {
    const planner = createSchemaRulePlanner(this.params);
    for (const planEntry of planner.planTable(table, { fieldId })) {
      await yieldToEventLoop();
      if (planEntry.type === 'error') {
        yield errorResult(
          pendingResult(
            planEntry.fieldId,
            planEntry.fieldName,
            planEntry.stage,
            getSchemaRulePlanningStageDescription(planEntry.stage),
            true,
            [],
            0
          ),
          planEntry.message
        );
        continue;
      }

      const { fieldName, ctx, selectedRules, ruleDepths } = planEntry;
      const validatedRules = new Map<string, boolean>();

      for (const rule of selectedRules) {
        const depth = ruleDepths.get(rule.id) ?? 0;
        const pending = pendingResult(
          fieldId,
          fieldName,
          rule.id,
          rule.description,
          rule.required,
          rule.dependencies,
          depth
        );

        const dependenciesSatisfied = rule.dependencies.every((depId) => {
          return validatedRules.get(depId) === true;
        });

        if (!dependenciesSatisfied) {
          if (rule.required) {
            yield errorResult(pending, 'Skipped: dependencies not satisfied');
            validatedRules.set(rule.id, false);
          } else {
            yield warnResult(pending, 'Skipped: dependencies not satisfied');
            validatedRules.set(rule.id, true);
          }
          continue;
        }

        yield runningResult(pending);

        try {
          const validationResult = await this.checkRuleValidity(ctx, rule);

          if (validationResult.isErr()) {
            yield errorResult(pending, validationResult.error.message);
            validatedRules.set(rule.id, false);
            continue;
          }

          const validation = validationResult.value;

          if (validation.valid) {
            yield successResult(pending);
            validatedRules.set(rule.id, true);
          } else {
            const details = {
              missing: validation.missing,
              missingItems: validation.missingItems,
              extra: validation.extra,
              extraItems: validation.extraItems,
            };
            const validationCtx = getRuleValidationCtx(ctx, rule);
            const repairResult = getRuleRepairHint(rule, validationCtx, validation, {
              skipStatementCheck: true,
            });
            const repair = repairResult.isOk() ? repairResult.value : undefined;

            if (rule.required) {
              yield {
                ...errorResult(
                  pending,
                  `Schema validation failed: ${validation.missing?.join(', ') || 'unknown issue'}`,
                  details
                ),
                repair,
              };
              validatedRules.set(rule.id, false);
            } else {
              yield {
                ...warnResult(
                  pending,
                  `Optional schema element missing: ${validation.missing?.join(', ')}`,
                  details
                ),
                repair,
              };
              validatedRules.set(rule.id, true);
            }
          }
        } catch (e) {
          yield errorResult(
            pending,
            e instanceof Error ? e.message : 'Unknown error during validation'
          );
          validatedRules.set(rule.id, false);
        }
        await yieldToEventLoop();
      }
    }
  }
}

/**
 * Create a schema checker instance.
 */
export const createSchemaChecker = (params: SchemaCheckerParams): SchemaChecker => {
  return new SchemaChecker(params);
};
