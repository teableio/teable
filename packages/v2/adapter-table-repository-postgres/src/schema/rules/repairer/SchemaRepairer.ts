import type { Table } from '@teable/v2-core';

import { executeTableSchemaStatements } from '../../../shared/db';
import {
  createSchemaRulePlanner,
  getSchemaRulePlanningStageDescription,
  type SchemaRulePlannerParams,
} from '../planner/SchemaRulePlanner';
import {
  type SchemaRepairResult,
  pendingResult,
  runningResult,
  successResult,
  warnResult,
  skippedResult,
  errorResult,
} from './SchemaRepairResult';

export interface SchemaRepairerParams extends SchemaRulePlannerParams {}

export interface SchemaRepairOptions {
  readonly dryRun?: boolean;
}

export class SchemaRepairer {
  constructor(private readonly params: SchemaRepairerParams) {}

  async *repairTable(
    table: Table,
    options?: SchemaRepairOptions
  ): AsyncGenerator<SchemaRepairResult, void, unknown> {
    yield* this.repairInternal(table, {}, options);
  }

  async *repairField(
    table: Table,
    fieldId: string,
    options?: SchemaRepairOptions
  ): AsyncGenerator<SchemaRepairResult, void, unknown> {
    yield* this.repairInternal(table, { fieldId }, options);
  }

  async *repairRule(
    table: Table,
    fieldId: string,
    ruleId: string,
    options?: SchemaRepairOptions
  ): AsyncGenerator<SchemaRepairResult, void, unknown> {
    yield* this.repairInternal(table, { fieldId, ruleId }, options);
  }

  private async *repairInternal(
    table: Table,
    target: { fieldId?: string; ruleId?: string },
    options?: SchemaRepairOptions
  ): AsyncGenerator<SchemaRepairResult, void, unknown> {
    const planner = createSchemaRulePlanner(this.params);

    for (const planEntry of planner.planTable(table, target)) {
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
      const selectedRuleIds = new Set(selectedRules.map((rule) => rule.id));
      const repairedRules = new Map<string, boolean>();

      for (const rule of selectedRules) {
        const pending = pendingResult(
          fieldId,
          fieldName,
          rule.id,
          rule.description,
          rule.required,
          rule.dependencies,
          ruleDepths.get(rule.id) ?? 0
        );

        const dependenciesSatisfied = rule.dependencies.every((depId) => {
          if (!selectedRuleIds.has(depId)) {
            return true;
          }

          return repairedRules.get(depId) === true;
        });

        if (!dependenciesSatisfied) {
          const missingDeps = rule.dependencies.filter(
            (depId) => repairedRules.get(depId) !== true
          );
          yield skippedResult(pending, 'Skipped: dependencies not repaired', {
            missing: missingDeps,
          });
          repairedRules.set(rule.id, false);
          continue;
        }

        yield runningResult(pending);

        try {
          const validationResult = await rule.isValid(ctx);
          if (validationResult.isErr()) {
            yield errorResult(pending, validationResult.error.message);
            repairedRules.set(rule.id, false);
            continue;
          }

          const validation = validationResult.value;
          if (validation.valid) {
            yield successResult(pending, 'Schema already valid', 'unchanged');
            repairedRules.set(rule.id, true);
            continue;
          }

          const details = {
            missing: validation.missing,
            extra: validation.extra,
          };

          if (rule.repairMode === 'manual') {
            yield warnResult(pending, 'Rule requires manual repair', 'manual', details);
            repairedRules.set(rule.id, false);
            continue;
          }

          const statementsResult = rule.up(ctx);
          if (statementsResult.isErr()) {
            yield errorResult(pending, statementsResult.error.message, details);
            repairedRules.set(rule.id, false);
            continue;
          }

          const statements = statementsResult.value;
          if (statements.length === 0) {
            yield warnResult(pending, 'No repair statements available', 'manual', details);
            repairedRules.set(rule.id, false);
            continue;
          }

          if (options?.dryRun) {
            yield successResult(
              pending,
              `Dry run: ${statements.length} statements ready`,
              'repaired',
              { ...details, statementCount: statements.length }
            );
            repairedRules.set(rule.id, true);
            continue;
          }

          await executeTableSchemaStatements(ctx.db, statements);

          const revalidationResult = await rule.isValid(ctx);
          if (revalidationResult.isErr()) {
            yield errorResult(pending, revalidationResult.error.message, {
              ...details,
              statementCount: statements.length,
            });
            repairedRules.set(rule.id, false);
            continue;
          }

          if (!revalidationResult.value.valid) {
            yield errorResult(pending, 'Repair executed but schema is still invalid', {
              missing: revalidationResult.value.missing,
              extra: revalidationResult.value.extra,
              statementCount: statements.length,
            });
            repairedRules.set(rule.id, false);
            continue;
          }

          yield successResult(pending, 'Schema repaired successfully', 'repaired', {
            statementCount: statements.length,
          });
          repairedRules.set(rule.id, true);
        } catch (error) {
          yield errorResult(
            pending,
            error instanceof Error ? error.message : 'Unknown error during repair'
          );
          repairedRules.set(rule.id, false);
        }
      }
    }
  }
}

export const createSchemaRepairer = (params: SchemaRepairerParams): SchemaRepairer =>
  new SchemaRepairer(params);
