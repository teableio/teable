import type { Table } from '@teable/v2-core';

import { executeTableSchemaStatements } from '../../../shared/db';
import type { SchemaRuleManualRepairValues, TableSchemaStatementBuilder } from '../core';
import { getRuleRepairHint } from '../core/RuleRepairMetadata';
import {
  createSchemaRulePlanner,
  getSchemaRulePlanningStageDescription,
  type SchemaRulePlannerParams,
} from '../planner/SchemaRulePlanner';
import {
  type SchemaRepairResult,
  type SchemaRepairSqlStatement,
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
  readonly manualRepairValues?: SchemaRuleManualRepairValues;
  readonly targetStatuses?: ReadonlyArray<'warn' | 'error'>;
}

const compileRepairStatements = (
  db: SchemaRepairerParams['db'],
  statements: ReadonlyArray<TableSchemaStatementBuilder>
): ReadonlyArray<SchemaRepairSqlStatement> =>
  statements.map((statement) => {
    const compiled = statement.compile(db);

    return {
      sql: compiled.sql,
      parameters: compiled.parameters ?? [],
    };
  });

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
          const currentStatus: 'warn' | 'error' = rule.required ? 'error' : 'warn';

          if (options?.targetStatuses?.length && !options.targetStatuses.includes(currentStatus)) {
            yield skippedResult(pending, 'Skipped: status not selected for repair');
            repairedRules.set(rule.id, false);
            continue;
          }

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
            missingItems: validation.missingItems,
            extra: validation.extra,
            extraItems: validation.extraItems,
          };
          const repairResult = getRuleRepairHint(rule, ctx, validation);
          const repair = repairResult.isOk() ? repairResult.value : undefined;

          if (rule.repairMode === 'manual') {
            if (!options?.manualRepairValues) {
              yield {
                ...warnResult(pending, 'Rule requires manual repair', 'manual', details),
                repair,
              };
              repairedRules.set(rule.id, false);
              continue;
            }

            if (!rule.manualRepair) {
              yield {
                ...errorResult(pending, 'Manual repair executor is not implemented', details),
                repair,
              };
              repairedRules.set(rule.id, false);
              continue;
            }

            const manualRepairResult = await rule.manualRepair(ctx, options.manualRepairValues, {
              dryRun: options.dryRun,
            });

            if (manualRepairResult.isErr()) {
              yield {
                ...errorResult(pending, manualRepairResult.error.message, details),
                repair,
              };
              repairedRules.set(rule.id, false);
              continue;
            }

            if (options?.dryRun) {
              yield {
                ...successResult(pending, 'Dry run: manual repair ready', 'repaired', details),
                repair,
              };
              repairedRules.set(rule.id, true);
              continue;
            }

            const revalidationResult = await rule.isValid(ctx);
            if (revalidationResult.isErr()) {
              yield {
                ...errorResult(pending, revalidationResult.error.message, details),
                repair,
              };
              repairedRules.set(rule.id, false);
              continue;
            }

            if (!revalidationResult.value.valid) {
              yield {
                ...errorResult(pending, 'Repair executed but schema is still invalid', {
                  missing: revalidationResult.value.missing,
                  missingItems: revalidationResult.value.missingItems,
                  extra: revalidationResult.value.extra,
                  extraItems: revalidationResult.value.extraItems,
                }),
                repair,
              };
              repairedRules.set(rule.id, false);
              continue;
            }

            yield {
              ...successResult(pending, 'Schema repaired successfully', 'repaired'),
              repair,
            };
            repairedRules.set(rule.id, true);
            continue;
          }

          if (repair && !repair.available && repair.mode === 'auto') {
            yield {
              ...skippedResult(pending, 'Skipped: repair unavailable', details),
              repair,
            };
            repairedRules.set(rule.id, false);
            continue;
          }

          const statementsResult = rule.up(ctx);
          if (statementsResult.isErr()) {
            yield {
              ...errorResult(pending, statementsResult.error.message, details),
              repair,
            };
            repairedRules.set(rule.id, false);
            continue;
          }

          const statements = statementsResult.value;
          if (statements.length === 0) {
            yield {
              ...warnResult(pending, 'No repair statements available', 'manual', details),
              repair,
            };
            repairedRules.set(rule.id, false);
            continue;
          }

          if (options?.dryRun) {
            const compiledStatements = compileRepairStatements(ctx.db, statements);
            yield {
              ...successResult(
                pending,
                `Dry run: ${statements.length} statements ready`,
                'repaired',
                {
                  ...details,
                  statementCount: statements.length,
                  statements: compiledStatements,
                }
              ),
              repair,
            };
            repairedRules.set(rule.id, true);
            continue;
          }

          await executeTableSchemaStatements(ctx.db, statements);

          const revalidationResult = await rule.isValid(ctx);
          if (revalidationResult.isErr()) {
            yield {
              ...errorResult(pending, revalidationResult.error.message, {
                ...details,
                statementCount: statements.length,
              }),
              repair,
            };
            repairedRules.set(rule.id, false);
            continue;
          }

          if (!revalidationResult.value.valid) {
            yield {
              ...errorResult(pending, 'Repair executed but schema is still invalid', {
                missing: revalidationResult.value.missing,
                missingItems: revalidationResult.value.missingItems,
                extra: revalidationResult.value.extra,
                extraItems: revalidationResult.value.extraItems,
                statementCount: statements.length,
              }),
              repair,
            };
            repairedRules.set(rule.id, false);
            continue;
          }

          yield {
            ...successResult(pending, 'Schema repaired successfully', 'repaired', {
              statementCount: statements.length,
            }),
            repair,
          };
          repairedRules.set(rule.id, true);
        } catch (error) {
          yield {
            ...errorResult(
              pending,
              error instanceof Error ? error.message : 'Unknown error during repair'
            ),
            repair: undefined,
          };
          repairedRules.set(rule.id, false);
        }
      }
    }
  }
}

export const createSchemaRepairer = (params: SchemaRepairerParams): SchemaRepairer =>
  new SchemaRepairer(params);
