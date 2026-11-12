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
} from './BoundDataQueryExpression';
import { queryError } from './DataQueryDefinition';
import type {
  DataQueryFormulaExpression,
  DataQueryFormulaReference,
  DataQueryPredicateV3,
} from './DataQueryExpression';
import type { DataQueryOutput, DataQueryParameterDefinition } from './types';

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

export const bindDataQueryFormulaExpression = (
  expression: DataQueryFormulaExpression,
  context: DataQueryExpressionBindingContext
): Result<BoundDataQueryFormulaExpression, DomainError> =>
  safeTry(function* () {
    const references: Record<string, BoundDataQueryReferenceExpression> = Object.create(null);
    const dependencies: {
      id: string;
      valueType: { cellValueType: CellValueType; isMultipleCellValue: CellValueMultiplicity };
    }[] = [];
    for (const [alias, reference] of Object.entries(expression.references)) {
      if (
        !alias ||
        alias !== alias.trim() ||
        /[{}]/.test(alias) ||
        ['__proto__', 'prototype', 'constructor'].includes(alias)
      )
        return err(queryError('expression_invalid', 'Invalid formula reference alias'));
      const bound = yield* bindReference(reference, context);
      references[alias] = bound;
      dependencies.push({
        id: alias,
        valueType: { cellValueType: bound.valueType, isMultipleCellValue: bound.multiplicity },
      });
    }
    const timeZone =
      expression.timeZone === undefined
        ? undefined
        : yield* TimeZone.create(expression.timeZone).mapErr(() =>
            queryError('expression_invalid', 'Invalid formula time zone')
          );
    const formula = yield* FormulaExpression.create(
      expression.formula,
      context.formulaSourceBudget
    ).mapErr(formulaDiagnostic);
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
    if (result.isMultipleCellValue.isMultiple())
      return err(invalid('Query formula output must be scalar'));
    return ok({
      kind: 'formula' as const,
      formula: expression.formula,
      references,
      recordSource: context.localSource ?? 'root',
      ...(timeZone ? { timeZone: timeZone.toString() } : {}),
      valueType: result.cellValueType,
      multiplicity: result.isMultipleCellValue,
      nullable: true,
    });
  });

export const bindDataQueryExpressionPredicate = (
  predicate: DataQueryPredicateV3,
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
