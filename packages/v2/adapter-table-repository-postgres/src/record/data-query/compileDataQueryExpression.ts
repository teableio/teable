import type { DomainError, Field } from '@teable/v2-core';
import type {
  BoundDataQueryPredicate,
  BoundDataQueryFormulaExpression,
  BoundDataQueryReferenceExpression,
  DataQueryFilter,
  DataQuerySystemField,
} from '@teable/v2-data-query';
import {
  FormulaSqlPgTranslator,
  finalizeFormulaOutputSql,
  guardValueSql,
  type FormulaCompileBudgetConfig,
  type FormulaSqlPgReference,
  type IPgTypeValidationStrategy,
} from '@teable/v2-formula-sql-pg';
import { sql, type RawBuilder } from 'kysely';
import { ok, safeTry, type Result } from 'neverthrow';

const formulaInputAlias = '__dq_formula_inputs';

export interface DataQueryExpressionSqlContext {
  resolveFormulaField(
    source: string,
    fieldId: string
  ): Result<
    {
      readonly field: Field;
      readonly value: RawBuilder<unknown>;
      readonly actorIdFallback?: RawBuilder<unknown>;
    },
    DomainError
  >;
  resolveSystem(
    source: string,
    system: DataQuerySystemField
  ): Result<RawBuilder<unknown>, DomainError>;
  resolveParameter(name: string): Result<unknown, DomainError>;
  resolveRowAlias(source: string): Result<string, DomainError>;
  readonly typeValidationStrategy: IPgTypeValidationStrategy;
  readonly formulaCompileBudget: FormulaCompileBudgetConfig;
  compileLegacyFilter(
    source: string,
    filter: DataQueryFilter
  ): Result<RawBuilder<unknown> | undefined, DomainError>;
}

export const compileDataQueryFormulaExpression = (
  expression: BoundDataQueryFormulaExpression,
  context: DataQueryExpressionSqlContext,
  mode: 'value' | 'display' | 'predicate' = 'value'
): Result<RawBuilder<unknown>, DomainError> =>
  safeTry(function* () {
    const columns: RawBuilder<unknown>[] = [];
    const references = new Map<string, FormulaSqlPgReference>();
    let index = 0;
    for (const [alias, reference] of Object.entries(expression.references)) {
      const column = `arg_${index++}`;
      const valueSql = `"${formulaInputAlias}"."${column}"`;
      if (reference.kind === 'field') {
        const resolved = yield* context.resolveFormulaField(reference.source, reference.fieldId);
        const actorColumn = `actor_${index}`;
        references.set(alias, {
          field: resolved.field,
          resolveFieldSql: () => ok({ valueSql, valueType: 'unknown', isArray: false }),
          ...(resolved.actorIdFallback
            ? { actorIdFallbackSql: `"${formulaInputAlias}"."${actorColumn}"` }
            : {}),
        });
        columns.push(sql`${resolved.value} as ${sql.id(column)}`);
        if (resolved.actorIdFallback)
          columns.push(sql`${resolved.actorIdFallback} as ${sql.id(actorColumn)}`);
      } else {
        const value = yield* resolveFormulaReference(reference, context);
        references.set(alias, {
          valueSql,
          valueType: reference.valueType,
          multiplicity: reference.multiplicity,
        });
        columns.push(sql`${value} as ${sql.id(column)}`);
      }
    }
    if (columns.length === 0) columns.push(sql`1 as ${sql.id('__unit')}`);
    const rowAlias = yield* context.resolveRowAlias(expression.recordSource);
    const translator = new FormulaSqlPgTranslator({
      references,
      tableAlias: rowAlias,
      typeValidationStrategy: context.typeValidationStrategy,
      compileBudget: { ...context.formulaCompileBudget, mode: 'enforce' },
      maxReptBytes: 1024 * 1024,
      ...(expression.timeZone !== undefined ? { timeZone: expression.timeZone } : {}),
    });
    const translated = yield* translator.translateExpression(expression.formula);
    const rendered = yield* translator.renderExpression(translated, (value, budget) =>
      mode === 'predicate'
        ? guardValueSql(value.valueSql, value.errorConditionSql, budget)
        : finalizeFormulaOutputSql(value, expression, context.typeValidationStrategy, budget)
    );
    return ok(
      sql`(select ${sql.raw(rendered)} from (select ${sql.join(columns)} offset 0) as ${sql.id(formulaInputAlias)})`
    );
  });

const resolveFormulaReference = (
  reference: Exclude<BoundDataQueryReferenceExpression, { kind: 'field' }>,
  context: DataQueryExpressionSqlContext
): Result<RawBuilder<unknown>, DomainError> => {
  if (reference.kind === 'system') return context.resolveSystem(reference.source, reference.system);
  return context
    .resolveParameter(reference.name)
    .map((value) => (Array.isArray(value) ? sql`${JSON.stringify(value)}::jsonb` : sql`${value}`));
};

/** Optional legacy leaves prune in-place, never as an independently ANDed filter. */
export const compileDataQueryPredicate = (
  predicate: BoundDataQueryPredicate,
  context: DataQueryExpressionSqlContext
): Result<RawBuilder<unknown> | undefined, DomainError> =>
  safeTry(function* () {
    switch (predicate.kind) {
      case 'legacy':
        return context.compileLegacyFilter(predicate.source, predicate.filter);
      case 'formula':
        // Formula predicates use Teable truthiness: a blank is false before NOT
        // or grouping. Do not normalize legacy leaves or optional-filter pruning.
        return compileDataQueryFormulaExpression(predicate.expression, context, 'predicate').map(
          (compiled) => sql`coalesce(${compiled}, false)`
        );
      case 'group': {
        const items: RawBuilder<unknown>[] = [];
        for (const item of predicate.items) {
          const compiled = yield* compileDataQueryPredicate(item, context);
          if (compiled) items.push(compiled);
        }
        return ok(
          items.length
            ? sql`(${sql.join(items, predicate.conjunction === 'and' ? sql` and ` : sql` or `)})`
            : undefined
        );
      }
      case 'not': {
        const compiled = yield* compileDataQueryPredicate(predicate.predicate, context);
        return ok(compiled ? sql`(not (${compiled}))` : undefined);
      }
    }
  });
