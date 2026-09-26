import {
  FormulaField,
  domainError,
  type DomainError,
  type FieldId,
  type Table,
} from '@teable/v2-core';
import {
  checkFormulaSqlBudget,
  isFormulaCompileBudgetError,
  resolveFormulaCompileBudget,
  type FormulaCompileBudgetConfig,
  type FormulaCompileBudgetOptions,
  type IPgTypeValidationStrategy,
} from '@teable/v2-formula-sql-pg';
import type { CompiledQuery, Kysely } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import type { DynamicDB, QB } from '../query-builder';
import {
  SameTableBatchQueryBuilder,
  type SameTableFieldLevel,
} from '../query-builder/computed/SameTableBatchQueryBuilder';
import type { ComputedActivityFieldError } from './activity/IComputedActivityProjector';
import { UpdateFromSelectBuilder, type UpdateWithReturningResult } from './UpdateFromSelectBuilder';

export type FormulaUpdateQueryPlan = {
  selectQuery: QB;
  fieldIds: ReadonlyArray<FieldId>;
  formulaBudget: FormulaCompileBudgetOptions;
  compiled: CompiledQuery;
  returning?: UpdateWithReturningResult;
};

type Candidate = {
  fieldLevels: ReadonlyArray<SameTableFieldLevel>;
  recordIds?: ReadonlyArray<string>;
};

const retainFields = (candidate: Candidate, ids: ReadonlySet<string>): Candidate => ({
  ...candidate,
  fieldLevels: candidate.fieldLevels
    .map((level) => ({ ...level, fieldIds: level.fieldIds.filter((id) => ids.has(id.toString())) }))
    .filter((level) => level.fieldIds.length > 0),
});

/** Only roots decide policy grouping. Dependencies are compiled under their root's policy. */
const groupByRootPolicy = (
  table: Table,
  levels: ReadonlyArray<SameTableFieldLevel>,
  config: FormulaCompileBudgetConfig
): Result<ReadonlyArray<ReadonlyArray<SameTableFieldLevel>>, DomainError> => {
  const modes = new Map<string, 'observe' | 'enforce'>();
  for (const level of levels) {
    for (const id of level.fieldIds) {
      const field = table.getField((field) => field.id().equals(id));
      if (field.isErr()) return err(field.error);
      if (!(field.value instanceof FormulaField))
        return err(
          domainError.invariant({ message: 'Formula batch contains a non-formula field' })
        );
      const policy = resolveFormulaCompileBudget(field.value, config);
      if (policy.isErr()) return err(policy.error);
      modes.set(id.toString(), policy.value.mode);
    }
  }
  if (new Set(modes.values()).size <= 1) return ok([levels]);
  const groups: SameTableFieldLevel[][] = [];
  for (const level of [...levels].sort((a, b) => a.level - b.level)) {
    const byMode = new Map<string, FieldId[]>();
    for (const id of level.fieldIds) {
      const mode = modes.get(id.toString())!;
      const ids = byMode.get(mode) ?? [];
      ids.push(id);
      byMode.set(mode, ids);
    }
    for (const fieldIds of byMode.values()) groups.push([{ level: level.level, fieldIds }]);
  }
  return ok(groups);
};

/** Plan first, execute later: no successful SQL can precede discovery of an unsafe root. */
export const planFormulaUpdateBatches = (params: {
  db: Kysely<DynamicDB>;
  table: Table;
  fieldLevels: ReadonlyArray<SameTableFieldLevel>;
  recordChunks: ReadonlyArray<ReadonlyArray<string> | undefined>;
  typeValidationStrategy: IPgTypeValidationStrategy;
  config: FormulaCompileBudgetConfig;
  dirtyFilter: {
    tableId: string;
    dirtyTableName: string;
    tableIdColumn: string;
    recordIdColumn: string;
  };
  isolateFailures: boolean;
  collectChanges: boolean;
  deferVersion?: boolean;
  maxPlans?: number;
  dirtyRecordCount: number;
  blocked: ReadonlyMap<string, ComputedActivityFieldError>;
  onFailure: (fieldId: FieldId, error: DomainError) => void;
}): Result<{ plans: FormulaUpdateQueryPlan[]; deferVersion: boolean }, DomainError> => {
  const groups = groupByRootPolicy(params.table, params.fieldLevels, params.config);
  if (groups.isErr()) return err(groups.error);
  const builder = new SameTableBatchQueryBuilder(
    params.db,
    params.typeValidationStrategy,
    params.config
  );
  const updateBuilder = new UpdateFromSelectBuilder(params.db);
  const plans: FormulaUpdateQueryPlan[] = [];
  const compilePlan = (
    selectQuery: QB,
    fieldIds: ReadonlyArray<FieldId>,
    formulaBudget: FormulaCompileBudgetOptions,
    incrementVersion: boolean
  ): Result<FormulaUpdateQueryPlan, DomainError> => {
    const update = { table: params.table, fieldIds, selectQuery, incrementVersion };
    if (params.collectChanges) {
      return updateBuilder.buildWithReturning(update).andThen((returning) =>
        checkFormulaSqlBudget(returning.compiled.sql, formulaBudget).map(() => ({
          selectQuery,
          fieldIds,
          formulaBudget,
          compiled: returning.compiled,
          returning,
        }))
      );
    }
    return updateBuilder
      .build({ ...update, returnRecordIds: !incrementVersion })
      .andThen((compiled) =>
        checkFormulaSqlBudget(compiled.sql, formulaBudget).map(() => ({
          selectQuery,
          fieldIds,
          formulaBudget,
          compiled,
        }))
      );
  };

  for (const group of groups.value) {
    for (const recordIds of params.recordChunks) {
      const pending: Candidate[] = [{ fieldLevels: group, recordIds }];
      while (pending.length > 0) {
        const original = pending.pop()!;
        const candidate = retainFields(
          original,
          new Set(
            original.fieldLevels
              .flatMap((level) => level.fieldIds)
              .filter((id) => !params.blocked.has(id.toString()))
              .map((id) => id.toString())
          )
        );
        const fieldIds = candidate.fieldLevels.flatMap((level) => level.fieldIds);
        if (fieldIds.length === 0) continue;
        const first = params.table.getField((field) => field.id().equals(fieldIds[0]));
        if (first.isErr()) return err(first.error);
        if (!(first.value instanceof FormulaField))
          return err(
            domainError.invariant({ message: 'Formula batch contains a non-formula field' })
          );
        const budget = resolveFormulaCompileBudget(first.value, params.config);
        if (budget.isErr()) return err(budget.error);
        const built = builder.build({
          table: params.table,
          ...candidate,
          dirtyFilter: params.dirtyFilter,
        });
        const compiled = built.andThen((batch) =>
          compilePlan(batch.selectQuery, fieldIds, budget.value, !params.deferVersion)
        );
        if (compiled.isOk()) {
          if (params.maxPlans && plans.length >= params.maxPlans) {
            return err(
              domainError.infrastructure({
                code: 'computed.statement_budget_exceeded',
                message: 'Computed statement work requires a smaller record stage',
                details: {
                  attempted: plans.length + 1,
                  max: params.maxPlans,
                  dirtyRecordCount: params.dirtyRecordCount,
                },
              })
            );
          }
          plans.push(compiled.value);
          continue;
        }
        if (!isFormulaCompileBudgetError(compiled.error)) return err(compiled.error);
        if (fieldIds.length > 1) {
          const middle = Math.floor(fieldIds.length / 2);
          const left = retainFields(
            candidate,
            new Set(fieldIds.slice(0, middle).map((id) => id.toString()))
          );
          const right = retainFields(
            candidate,
            new Set(fieldIds.slice(middle).map((id) => id.toString()))
          );
          pending.push(right, left);
          continue;
        }
        if (candidate.recordIds && candidate.recordIds.length > 1) {
          const middle = Math.floor(candidate.recordIds.length / 2);
          pending.push(
            { ...candidate, recordIds: candidate.recordIds.slice(middle) },
            { ...candidate, recordIds: candidate.recordIds.slice(0, middle) }
          );
          continue;
        }
        if (!params.isolateFailures) return err(compiled.error);
        params.onFailure(fieldIds[0], compiled.error);
      }
    }
  }

  // Distinct field sets can update the same row. Their old versions must remain identical.
  const deferVersion =
    params.deferVersion ||
    new Set(plans.map((plan) => plan.fieldIds.map((id) => id.toString()).join(','))).size > 1;
  if (deferVersion && !params.deferVersion) {
    for (const plan of plans) {
      const compiled = compilePlan(plan.selectQuery, plan.fieldIds, plan.formulaBudget, false);
      if (compiled.isErr()) {
        // Re-plan at most once with the exact deferred-version wrapper before choosing cuts.
        if (isFormulaCompileBudgetError(compiled.error))
          return planFormulaUpdateBatches({ ...params, deferVersion: true });
        return err(compiled.error);
      }
      Object.assign(plan, compiled.value);
    }
  }
  return ok({ plans, deferVersion });
};
