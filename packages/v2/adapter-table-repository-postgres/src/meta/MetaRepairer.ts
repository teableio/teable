import { FieldHasError, type Table } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import type { SchemaRuleRepairHint } from '../schema/rules/core/ISchemaRule';
import type { SchemaRepairOptions } from '../schema/rules/repairer/SchemaRepairer';
import {
  errorResult,
  pendingResult,
  runningResult,
  skippedResult,
  successResult,
  type SchemaRepairDetails,
  type SchemaRepairResult,
} from '../schema/rules/repairer/SchemaRepairResult';
import { checkTableMetaWithTables } from './MetaChecker';
import type { MetaValidationIssue, MetaValidationSeverity } from './MetaValidationResult';

export const metaRuleDescription = 'Metadata reference validation';
export const metaRuleIdPrefix = 'meta:';

export interface MetaRepairerParams {
  readonly db: Kysely<V1TeableDatabase>;
}

export interface MetaRepairTarget {
  readonly fieldId?: string;
  readonly ruleId?: string;
}

export type MetaRepairOptions = Pick<SchemaRepairOptions, 'dryRun' | 'targetStatuses'>;

export const getMetaRuleId = (issue: Pick<MetaValidationIssue, 'category'>): string =>
  `${metaRuleIdPrefix}${issue.category}`;

export const isMetaRuleId = (ruleId: string | undefined): ruleId is string =>
  Boolean(ruleId?.startsWith(metaRuleIdPrefix));

export const getMetaIssueDetails = (
  issue: MetaValidationIssue
): SchemaRepairDetails | undefined => {
  const missing = [
    issue.details?.relatedTableId,
    issue.details?.relatedFieldId,
    issue.details?.path,
  ].filter((value): value is string => Boolean(value));

  return missing.length ? { missing } : undefined;
};

export const getMetaRepairHint = (issue: MetaValidationIssue): SchemaRuleRepairHint => ({
  available: true,
  mode: 'auto',
  reason: {
    fallback: `Automatic repair will mark "${issue.fieldName}" as hasError.`,
  },
  description: {
    fallback:
      'This keeps the broken computed field from participating in computed SQL until its metadata references are fixed manually.',
  },
});

export class MetaRepairer {
  constructor(private readonly params: MetaRepairerParams) {}

  async *repairTable(
    table: Table,
    allTables: ReadonlyArray<Table>,
    options: MetaRepairOptions = {}
  ): AsyncGenerator<SchemaRepairResult, void, unknown> {
    yield* this.repairInternal(table, allTables, {}, options);
  }

  async *repairField(
    table: Table,
    allTables: ReadonlyArray<Table>,
    fieldId: string,
    options: MetaRepairOptions = {}
  ): AsyncGenerator<SchemaRepairResult, void, unknown> {
    yield* this.repairInternal(table, allTables, { fieldId }, options);
  }

  async *repairRule(
    table: Table,
    allTables: ReadonlyArray<Table>,
    fieldId: string,
    ruleId: string,
    options: MetaRepairOptions = {}
  ): AsyncGenerator<SchemaRepairResult, void, unknown> {
    yield* this.repairInternal(table, allTables, { fieldId, ruleId }, options);
  }

  private async *repairInternal(
    table: Table,
    allTables: ReadonlyArray<Table>,
    target: MetaRepairTarget,
    options: MetaRepairOptions
  ): AsyncGenerator<SchemaRepairResult, void, unknown> {
    const repairedFieldIds = new Set<string>();

    for await (const issue of checkTableMetaWithTables(table, table.baseId(), allTables)) {
      const currentStatus = toRepairableMetaStatus(issue.severity);
      if (!currentStatus || !matchesMetaRepairTarget(issue, target)) {
        continue;
      }

      const pending = createMetaRepairPending(issue);
      const details = getMetaIssueDetails(issue);
      const repair = getMetaRepairHint(issue);

      yield withRepair(runningResult(pending), repair);

      if (shouldSkipRepairStatus(currentStatus, options.targetStatuses)) {
        yield withRepair(
          skippedResult(pending, 'Skipped: status not selected for repair', details),
          repair
        );
        continue;
      }

      if (repairedFieldIds.has(issue.fieldId)) {
        yield withRepair(
          successResult(pending, 'Field already marked hasError', 'unchanged', details),
          repair
        );
        continue;
      }

      if (options.dryRun) {
        repairedFieldIds.add(issue.fieldId);
        const compiled = this.createMarkFieldHasErrorQuery(issue).compile();
        yield withRepair(
          successResult(pending, 'Dry run: field will be marked hasError', 'repaired', {
            ...details,
            statementCount: 1,
            statements: [
              {
                sql: compiled.sql,
                parameters: compiled.parameters,
              },
            ],
          }),
          repair
        );
        continue;
      }

      const repairResult = await this.markFieldHasError(table, issue, pending, details, repair);
      yield repairResult;
      if (repairResult.status === 'success') {
        repairedFieldIds.add(issue.fieldId);
      }
    }
  }

  private async markFieldHasError(
    table: Table,
    issue: MetaValidationIssue,
    pending: SchemaRepairResult,
    details: SchemaRepairDetails | undefined,
    repair: SchemaRuleRepairHint
  ): Promise<SchemaRepairResult> {
    try {
      await this.createMarkFieldHasErrorQuery(issue).execute();

      table
        .getFields()
        .find((field) => field.id().toString() === issue.fieldId)
        ?.setHasError(FieldHasError.error());

      return withRepair(
        successResult(pending, 'Field marked hasError', 'repaired', {
          ...details,
          statementCount: 1,
        }),
        repair
      );
    } catch (error) {
      return withRepair(
        errorResult(
          pending,
          error instanceof Error ? error.message : 'Unknown error during meta repair',
          details
        ),
        repair
      );
    }
  }

  private createMarkFieldHasErrorQuery(issue: MetaValidationIssue) {
    return this.params.db
      .updateTable('field')
      .set({ has_error: true })
      .where('id', '=', issue.fieldId);
  }
}

export const createMetaRepairer = (params: MetaRepairerParams): MetaRepairer =>
  new MetaRepairer(params);

const createMetaRepairPending = (issue: MetaValidationIssue): SchemaRepairResult =>
  pendingResult(issue.fieldId, issue.fieldName, getMetaRuleId(issue), metaRuleDescription, true);

const toRepairableMetaStatus = (severity: MetaValidationSeverity): 'warn' | 'error' | undefined => {
  if (severity === 'error') {
    return 'error';
  }
  if (severity === 'warning') {
    return 'warn';
  }
};

const matchesMetaRepairTarget = (issue: MetaValidationIssue, target: MetaRepairTarget): boolean => {
  if (target.fieldId && issue.fieldId !== target.fieldId) {
    return false;
  }

  return !target.ruleId || getMetaRuleId(issue) === target.ruleId;
};

const shouldSkipRepairStatus = (
  status: 'warn' | 'error',
  targetStatuses?: ReadonlyArray<'warn' | 'error'>
): boolean => Boolean(targetStatuses?.length && !targetStatuses.includes(status));

const withRepair = (
  result: SchemaRepairResult,
  repair: SchemaRuleRepairHint
): SchemaRepairResult => ({
  ...result,
  repair,
});
