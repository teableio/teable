import {
  CellValueMultiplicity,
  CellValueType,
  domainError,
  FormulaExpression,
  TimeZone,
  type DomainError,
  type FormulaSourceBudget,
} from '@teable/v2-core';
import { err, ok, safeTry, type Result } from 'neverthrow';
import type {
  BoundDataQueryReferenceExpression,
  BoundDataQueryExpressionType,
  BoundDataQueryPredicate,
  BoundDataQueryFormulaExpression,
  BoundDataQueryHavingExpression,
  BoundDataQueryHavingReference,
} from './BoundDataQueryExpression';
import { queryError } from './DataQueryDefinition';
import type {
  DataQueryFormulaExpression,
  DataQueryFormulaReference,
  DataQueryPredicateV5,
  DataQueryHavingExpression,
} from './DataQueryExpression';
import type { DataQueryAggregate, DataQueryOutput, DataQueryParameterDefinition } from './types';

export type DataQueryExpressionBindingContext = {
  readonly formulaSourceBudget: FormulaSourceBudget;
  readonly parameters?: Readonly<Record<string, DataQueryParameterDefinition>>;
  readonly localSource?: string;
  readonly resolveField: (
    source: string,
    fieldId: string
  ) => Result<BoundDataQueryExpressionType, DomainError>;
  readonly resolveSource: (
    source: string
  ) => Result<{ readonly nullable: boolean; readonly cardinality: 'one' | 'many' }, DomainError>;
};
const invalid = (message: string) => queryError('unsupported_type', message);
const sourceFor = (
  source: string | undefined,
  context: DataQueryExpressionBindingContext
): Result<string, DomainError> => {
  const resolved = source ?? context.localSource ?? 'root';
  if (context.localSource !== undefined && resolved !== context.localSource)
    return err(
      queryError('unsupported_expression_source', 'A predicate may only read its own source')
    );
  return context
    .resolveSource(resolved)
    .andThen((capability) =>
      capability.cardinality === 'many' && context.localSource === undefined
        ? err(
            queryError(
              'unsupported_expression_source',
              'Scalar projections require root or to-one sources'
            )
          )
        : ok(resolved)
    );
};
/** Parser and type diagnostics can quote source text; policy limits never can. */
const formulaDiagnostic = (error: DomainError): DomainError =>
  error.code.startsWith('validation.limit.')
    ? error
    : domainError.validation({ code: error.code, message: 'Invalid formula expression' });
const bindParameterReference = (
  reference: Extract<DataQueryFormulaReference, { type: 'parameter' }>,
  context: DataQueryExpressionBindingContext
): Result<BoundDataQueryReferenceExpression, DomainError> => {
  const definition =
    context.parameters && Object.hasOwn(context.parameters, reference.name)
      ? context.parameters[reference.name]
      : undefined;
  if (!definition)
    return err(queryError('unknown_parameter', 'Query references an undeclared parameter'));
  if (definition.type === 'date')
    return err(invalid('Date filter objects cannot be used as formula scalar parameters'));
  const valueType =
    definition.type === 'number' || definition.type === 'number[]'
      ? CellValueType.number()
      : definition.type === 'boolean' || definition.type === 'boolean[]'
        ? CellValueType.boolean()
        : CellValueType.string();
  return ok({
    kind: 'parameter' as const,
    name: reference.name,
    valueType,
    multiplicity: definition.type.endsWith('[]')
      ? CellValueMultiplicity.multiple()
      : CellValueMultiplicity.single(),
    nullable: definition.nullable === true,
  });
};
const bindReference = (
  reference: DataQueryFormulaReference,
  context: DataQueryExpressionBindingContext
): Result<BoundDataQueryReferenceExpression, DomainError> =>
  safeTry(function* () {
    if (reference.type === 'field') {
      const source = yield* sourceFor(reference.source, context);
      const metadata = yield* context.resolveField(source, reference.fieldId);
      return ok({ kind: 'field' as const, source, fieldId: reference.fieldId, ...metadata });
    }
    if (reference.type === 'system') {
      const source = yield* sourceFor(reference.source, context);
      const capability = yield* context.resolveSource(source);
      const valueType =
        reference.system === 'id'
          ? CellValueType.string()
          : reference.system === 'autoNumber' || reference.system === 'version'
            ? CellValueType.number()
            : CellValueType.dateTime();
      return ok({
        kind: 'system' as const,
        source,
        system: reference.system,
        valueType,
        multiplicity: CellValueMultiplicity.single(),
        nullable: capability.nullable || reference.system === 'lastModifiedTime',
      });
    }
    return bindParameterReference(reference, context);
  });

const inferFormula = (
  expression: { formula: string; timeZone?: string },
  references: Readonly<Record<string, BoundDataQueryExpressionType>>,
  budget: FormulaSourceBudget,
  outputStage = false
): Result<BoundDataQueryExpressionType & { timeZone?: string }, DomainError> =>
  safeTry(function* () {
    const dependencies = Object.entries(references).map(([id, bound]) => ({
      id,
      valueType: { cellValueType: bound.valueType, isMultipleCellValue: bound.multiplicity },
    }));
    const timeZone =
      expression.timeZone === undefined
        ? undefined
        : yield* TimeZone.create(expression.timeZone).mapErr(() =>
            queryError('expression_invalid', 'Invalid formula time zone')
          );
    const formula = yield* FormulaExpression.create(expression.formula, budget).mapErr(
      formulaDiagnostic
    );
    const identifiers = yield* formula.getReferencedIdentifiers().mapErr(formulaDiagnostic);
    for (const alias of identifiers)
      if (!Object.hasOwn(references, alias))
        return err(queryError('expression_invalid', 'Formula reference is not declared'));
    const result = yield* formula.getParsedValueType(dependencies).mapErr(formulaDiagnostic);
    const hasTrackedClock = yield* formula.hasLastModifiedTimeParams().mapErr(formulaDiagnostic);
    if (hasTrackedClock)
      return err(
        queryError(
          'unsupported_expression_context',
          'Inline field-tracking last-modified time is not supported; reference a stored formula field instead'
        )
      );
    if (outputStage) {
      const hasRecordContext = yield* formula.hasRecordContextFunctions().mapErr(formulaDiagnostic);
      if (hasRecordContext)
        return err(
          queryError('unsupported_expression_context', 'HAVING has no source row context')
        );
      if (!result.cellValueType.equals(CellValueType.boolean()))
        return err(invalid('HAVING must return a boolean'));
    }
    if (result.isMultipleCellValue.isMultiple())
      return err(invalid('Query formula output must be scalar'));
    return ok({
      valueType: result.cellValueType,
      multiplicity: result.isMultipleCellValue,
      nullable: true,
      ...(timeZone ? { timeZone: timeZone.toString() } : {}),
    });
  });

export const bindDataQueryFormulaExpression = (
  expression: DataQueryFormulaExpression,
  context: DataQueryExpressionBindingContext
): Result<BoundDataQueryFormulaExpression, DomainError> =>
  safeTry(function* () {
    const references: Record<string, BoundDataQueryReferenceExpression> = Object.create(null);
    for (const [alias, reference] of Object.entries(expression.references)) {
      if (
        !alias ||
        alias !== alias.trim() ||
        /[{}]/.test(alias) ||
        ['__proto__', 'prototype', 'constructor'].includes(alias)
      )
        return err(queryError('expression_invalid', 'Invalid formula reference alias'));
      references[alias] = yield* bindReference(reference, context);
    }
    const inferred = yield* inferFormula(expression, references, context.formulaSourceBudget);
    return ok({
      kind: 'formula' as const,
      formula: expression.formula,
      references,
      recordSource: context.localSource ?? 'root',
      ...inferred,
    });
  });

export const bindDataQueryHavingExpression = (
  expression: DataQueryHavingExpression,
  outputs: readonly DataQueryOutput[],
  parameters: Readonly<Record<string, DataQueryParameterDefinition>> | undefined,
  formulaSourceBudget: FormulaSourceBudget
): Result<BoundDataQueryHavingExpression, DomainError> =>
  safeTry(function* () {
    const references: Record<string, BoundDataQueryHavingReference> = Object.create(null);
    for (const [alias, reference] of Object.entries(expression.references)) {
      if (reference.type === 'parameter') {
        const parameter = yield* bindParameterReference(reference, {
          parameters,
          formulaSourceBudget,
          resolveField: () => err(invalid('HAVING cannot reference a field')),
          resolveSource: () => err(invalid('HAVING has no source row context')),
        });
        if (parameter.kind !== 'parameter') return err(invalid('Invalid HAVING parameter'));
        references[alias] = parameter;
      } else {
        const output = outputs.find((candidate) => candidate.alias === reference.alias);
        if (!output)
          return err(queryError('having_output_unknown', 'HAVING references an unselected output'));
        if (output.wireType === 'unknown')
          return err(invalid('HAVING requires scalar typed outputs'));
        references[alias] = {
          kind: 'output',
          alias: reference.alias,
          valueType: yield* CellValueType.create(output.cellValueType),
          multiplicity: yield* CellValueMultiplicity.create(output.isMultipleCellValue),
          nullable: output.nullable,
        };
      }
    }
    const inferred = yield* inferFormula(expression, references, formulaSourceBudget, true);
    return ok({ kind: 'formula' as const, formula: expression.formula, references, ...inferred });
  });

export const bindDataQueryExpressionPredicate = (
  predicate: DataQueryPredicateV5,
  context: DataQueryExpressionBindingContext
): Result<BoundDataQueryPredicate, DomainError> =>
  safeTry(function* () {
    if ('items' in predicate) {
      const items: BoundDataQueryPredicate[] = [];
      for (const child of predicate.items)
        items.push(yield* bindDataQueryExpressionPredicate(child, context));
      return ok({ kind: 'group' as const, conjunction: predicate.conjunction, items });
    }
    if ('not' in predicate)
      return ok({
        kind: 'not' as const,
        predicate: yield* bindDataQueryExpressionPredicate(predicate.not, context),
      });
    if ('relation' in predicate) {
      if (context.localSource !== 'root' || predicate.relation === 'root')
        return err(queryError('join_source_unknown', 'Existence requires a declared relation'));
      yield* context.resolveSource(predicate.relation);
      return ok({ kind: 'exists' as const, ...predicate });
    }
    if ('type' in predicate) {
      const expression = yield* bindDataQueryFormulaExpression(predicate, context);
      if (!expression.valueType.equals(CellValueType.boolean()))
        return err(invalid('Query formula predicates must return a boolean'));
      return ok({ kind: 'formula' as const, expression });
    }
    return ok({
      kind: 'legacy' as const,
      source: context.localSource ?? 'root',
      filter: predicate,
    });
  });
export const dataQueryExpressionOutput = (
  alias: string,
  expression: BoundDataQueryFormulaExpression
): DataQueryOutput => {
  const cellValueType = expression.valueType.toString();
  return {
    alias,
    wireType:
      cellValueType === 'number'
        ? 'numberOrString'
        : cellValueType === 'boolean'
          ? 'boolean'
          : 'string',
    cellValueType,
    isMultipleCellValue: expression.multiplicity.toBoolean(),
    nullable: expression.nullable,
  };
};

/** Statistics operate on the inferred scalar domain, never a fabricated stored Field. */
export const dataQueryAggregateExpressionOutput = (
  alias: string,
  statisticFunc: DataQueryAggregate['statisticFunc'],
  expression: BoundDataQueryFormulaExpression,
  relation: boolean
): Result<DataQueryOutput, DomainError> => {
  const type = expression.valueType.toString();
  const common = [
    'count',
    'empty',
    'filled',
    'unique',
    'percentEmpty',
    'percentFilled',
    'percentUnique',
  ];
  const compatible =
    type === 'number'
      ? [...common, 'sum', 'average', 'min', 'max']
      : type === 'dateTime'
        ? [...common, 'earliestDate', 'latestDate', 'dateRangeOfDays', 'dateRangeOfMonths']
        : type === 'boolean'
          ? ['count', 'checked', 'unChecked', 'percentChecked', 'percentUnChecked']
          : common;
  if (
    !compatible.includes(statisticFunc) ||
    (relation && !['count', 'unique', 'sum', 'average', 'min', 'max'].includes(statisticFunc))
  )
    return err(
      queryError(
        'aggregate_incompatible',
        'Aggregation function is incompatible with its expression'
      )
    );
  const dateOutput = statisticFunc === 'earliestDate' || statisticFunc === 'latestDate';
  return ok({
    alias,
    wireType: dateOutput ? 'string' : 'numberOrString',
    cellValueType: dateOutput ? 'dateTime' : 'number',
    isMultipleCellValue: false,
    nullable: !common.includes(statisticFunc) && statisticFunc !== 'count',
  });
};
