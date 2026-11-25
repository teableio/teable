import { domainError, isoDateTimeWithOffsetSchema } from '@teable/v2-core';
import { err, ok, safeTry } from 'neverthrow';
import { z } from 'zod';
import {
  bindParameterValues,
  aliasSchema as alias,
  dataQueryNameSchema,
  dataQueryParameterDefinitionSchema,
  dataQueryParameterUsage,
  isPlainData,
  queryError,
  validateDataQueryParameterDefaults,
} from './DataQueryDefinition';
import type {
  DataQueryDefinitionInput,
  DataQueryOutput,
  DataQueryParameterDefinition,
} from './types';

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const parameter = z.object({ type: z.literal('parameter'), name: dataQueryNameSchema }).strict();
const comparison = z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']);
const nullCheck = z.enum(['isNull', 'isNotNull']);
export const dataQueryCompositionSchema = z
  .object({
    kind: z.literal('composition'),
    source: z
      .object({ id: z.string().regex(/^qlb[0-9a-f]{16}$/), revision: z.number().int().positive() })
      .strict(),
    parameters: z.record(dataQueryNameSchema, dataQueryParameterDefinitionSchema).optional(),
    select: z.array(alias).min(1).max(100).optional(),
    filter: z
      .array(
        z.union([
          z.object({ alias, operator: comparison, value: z.union([scalar, parameter]) }).strict(),
          z.object({ alias, operator: nullCheck }).strict(),
        ])
      )
      .max(50)
      .optional(),
    groupBy: z.array(alias).min(1).max(20).optional(),
    /** Declares a shared metric and the source aliases its callers may group or filter by. */
    metricDimensions: z.array(alias).max(20).optional(),
    metrics: z
      .array(
        z
          .object({
            alias,
            statistic: z.enum(['count', 'sum', 'average', 'min', 'max']),
            input: alias.optional(),
          })
          .strict()
      )
      .min(1)
      .max(20)
      .optional(),
    orderBy: z
      .array(z.object({ alias, order: z.enum(['asc', 'desc']) }).strict())
      .max(20)
      .optional(),
    page: z
      .object({
        limit: z.number().int().min(1).max(1000),
        offset: z.number().int().min(0).max(2147483647).optional(),
        includeTotal: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type DataQueryComposition = z.infer<typeof dataQueryCompositionSchema>;
type Filter = NonNullable<DataQueryComposition['filter']>[number];
type Scalar = z.infer<typeof scalar>;
export type BoundDataQueryComposition = {
  definition: DataQueryComposition;
  sourceOutputs: readonly DataQueryOutput[];
  outputs: readonly DataQueryOutput[];
  filters: readonly { alias: string; operator: Filter['operator']; value?: Scalar | null }[];
};

const invalid = (message: string) =>
  domainError.validation({ code: 'data_query.invalid_composition', message });

/** The source's display sort/page never participates in the derived relation. */
export function dataQueryCompositionSource(definition: DataQueryDefinitionInput) {
  if (
    definition.kind !== 'records' ||
    definition.version === 9 ||
    ('distinct' in definition && definition.distinct)
  ) {
    return err(invalid('A composition requires a row-grain records source'));
  }
  const { sort: _sort, page: _page, ...rest } = definition;
  const unpaged: DataQueryDefinitionInput = rest.version === 7 ? { ...rest, version: 6 } : rest;
  const before = dataQueryParameterUsage(definition);
  const after = dataQueryParameterUsage(unpaged);
  const optionalParameters = new Set(after.optional);
  const parameters = definition.parameters ?? {};
  const executionParameters = Object.entries(parameters).filter(([name]) => {
    if (after.required.has(name) || after.optional.has(name)) return true;
    if (!before.required.has(name) && !before.optional.has(name)) return true;
    optionalParameters.add(name);
    return false;
  });
  return ok({
    definition: { ...unpaged, parameters: Object.fromEntries(executionParameters) },
    parameters,
    optionalParameters,
  });
}

const scalarType = (output: DataQueryOutput) => {
  if (output.isMultipleCellValue) return undefined;
  if (output.wireType === 'numberOrString') return 'number';
  if (output.wireType === 'string' || output.wireType === 'boolean') return output.wireType;
  return undefined;
};

function compositionMetricOutput(
  metric: NonNullable<DataQueryComposition['metrics']>[number],
  byAlias: ReadonlyMap<string, DataQueryOutput>
) {
  const input = metric.input === undefined ? undefined : byAlias.get(metric.input);
  if (
    (metric.input !== undefined && !input) ||
    (metric.statistic !== 'count' && (!input || scalarType(input) !== 'number'))
  ) {
    return err(invalid(`Unsupported metric input: ${metric.alias}`));
  }
  return ok<DataQueryOutput>({
    alias: metric.alias,
    wireType: 'numberOrString',
    cellValueType: 'number',
    nullable: metric.statistic !== 'count',
    isMultipleCellValue: false,
  });
}

function compositionOutputs(
  definition: DataQueryComposition,
  source: readonly DataQueryOutput[],
  byAlias: ReadonlyMap<string, DataQueryOutput>
) {
  if ((definition.groupBy && !definition.metrics) || (definition.select && definition.metrics)) {
    return err(invalid('Specify a record projection or an aggregate projection'));
  }
  return safeTry(function* () {
    const outputs: DataQueryOutput[] = [];
    const select = definition.groupBy ?? definition.select;
    const projectedAliases = select ?? (definition.metrics ? [] : source.map(({ alias }) => alias));
    for (const name of projectedAliases) {
      const output = byAlias.get(name);
      if (!output || (definition.groupBy && !scalarType(output)))
        return err(invalid(`Unsupported projection alias: ${name}`));
      outputs.push(output);
    }
    for (const metric of definition.metrics ?? []) {
      outputs.push(yield* compositionMetricOutput(metric, byAlias));
    }
    const selected = new Map(outputs.map((output) => [output.alias, output]));
    if (selected.size !== outputs.length) return err(invalid('Output aliases must be unique'));
    const invalidSort = definition.orderBy?.find(({ alias }) => {
      const output = selected.get(alias);
      return !output || !scalarType(output);
    });
    if (invalidSort) return err(invalid(`Unsupported sort alias: ${invalidSort.alias}`));
    return ok(outputs);
  });
}

function validateCompositionFilter(
  filter: Filter,
  byAlias: ReadonlyMap<string, DataQueryOutput>,
  parameters: Record<string, DataQueryParameterDefinition>
) {
  const output = byAlias.get(filter.alias);
  if (!output) return err(invalid(`Unknown filter alias: ${filter.alias}`));
  if (!('value' in filter)) return ok(undefined);
  const expected = scalarType(output);
  const actual =
    typeof filter.value === 'object' && Object.hasOwn(parameters, filter.value.name)
      ? parameters[filter.value.name].type
      : typeof filter.value;
  if (
    !expected ||
    actual !== expected ||
    (expected === 'boolean' && filter.operator !== 'eq' && filter.operator !== 'ne')
  ) {
    return err(invalid(`Incompatible filter for alias: ${filter.alias}`));
  }
  return ok(undefined);
}

function bindCompositionFilter(filter: Filter, valueFor: (name: string) => unknown) {
  if (!('value' in filter)) return ok(filter);
  const { value, alias, operator } = filter;
  if (typeof value !== 'object') return ok({ alias, operator, value });
  const { name } = value;
  const parsed = scalar.nullable().safeParse(valueFor(name));
  if (!parsed.success) return err(invalid(`Missing or invalid filter parameter: ${name}`));
  if (parsed.data === null && filter.operator !== 'eq' && filter.operator !== 'ne') {
    return err(invalid(`Null filter parameter requires equality: ${name}`));
  }
  return ok({ ...filter, value: parsed.data });
}

type CompositionSource = {
  definition: DataQueryDefinitionInput;
  parameters: Record<string, DataQueryParameterDefinition>;
  optionalParameters: ReadonlySet<string>;
};

function prepareFixedComposition(
  definition: DataQueryComposition,
  sourceOutputs: readonly DataQueryOutput[],
  source: CompositionSource
) {
  const requiredByComposition = new Set(
    (definition.filter ?? []).flatMap((filter) =>
      'value' in filter && typeof filter.value === 'object' ? [filter.value.name] : []
    )
  );
  return safeTry(function* () {
    const ownParameters = definition.parameters ?? {};
    for (const name of Object.keys(ownParameters)) {
      if (Object.hasOwn(source.parameters, name))
        return err(invalid(`Parameter already declared by source: ${name}`));
    }
    yield* validateDataQueryParameterDefaults(ownParameters);
    const parameters = { ...source.parameters, ...ownParameters };
    const byAlias = new Map(sourceOutputs.map((item) => [item.alias, item]));
    const optionalParameters = new Set(
      [...source.optionalParameters].filter((name) => !requiredByComposition.has(name))
    );
    const outputs = yield* compositionOutputs(definition, sourceOutputs, byAlias);
    for (const filter of definition.filter ?? []) {
      yield* validateCompositionFilter(filter, byAlias, parameters);
    }
    return ok({
      outputs,
      parameters,
      optionalParameters: [...optionalParameters],
      bind(input: Readonly<Record<string, unknown>> = {}) {
        return safeTry(function* () {
          const values = yield* bindParameterValues(parameters, input, optionalParameters);
          const executionParameters = source.definition.parameters ?? {};
          const forwarded: Record<string, unknown> = Object.create(null);
          for (const [name, value] of Object.entries(input)) {
            if (Object.hasOwn(executionParameters, name)) forwarded[name] = value;
          }
          const filters: BoundDataQueryComposition['filters'][number][] = [];
          for (const filter of definition.filter ?? []) {
            filters.push(yield* bindCompositionFilter(filter, (name) => values.get(name)));
          }
          const composition: BoundDataQueryComposition = {
            definition,
            sourceOutputs,
            outputs,
            filters,
          };
          return ok({ composition, parameters: forwarded });
        });
      },
    });
  });
}

function metricControls(dimensions: readonly DataQueryOutput[]) {
  const controls: Record<string, DataQueryParameterDefinition> = { groupBy: { type: 'string[]' } };
  for (const output of dimensions) {
    const type = scalarType(output);
    if (!type) return err(invalid(`Unsupported metric dimension: ${output.alias}`));
    controls[`where_${output.alias}`] = { type, nullable: true };
  }
  return ok(controls);
}

// PostgreSQL may return an exact numeric dimension as text, including exponent notation.
const metricDecimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const metricNumericSpecials = ['NaN', 'Infinity', '-Infinity'];
const metricTimestamp = isoDateTimeWithOffsetSchema();

function isMetricNumber(value: unknown): value is number | string {
  if (typeof value === 'number') return Number.isFinite(value);
  return (
    typeof value === 'string' &&
    (metricDecimal.test(value) || metricNumericSpecials.includes(value))
  );
}

function metricEpochMillis(value: string) {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return undefined;
  // Date.toISOString() uses signed six-digit years outside 0000–9999.
  if (metricTimestamp.safeParse(value).success || new Date(instant).toISOString() === value) {
    return instant;
  }
  return undefined;
}

function metricFilterValue(name: string, output: DataQueryOutput, value: unknown) {
  if (value === null) return ok(null);
  if (output.wireType === 'numberOrString' && isMetricNumber(value)) return ok(value);
  if (output.wireType === 'boolean' && typeof value === 'boolean') return ok(value);
  if (output.wireType === 'string' && typeof value === 'string') {
    if (output.cellValueType !== 'dateTime') return ok(value);
    const instant = metricEpochMillis(value);
    if (instant !== undefined) return ok(instant);
  }
  return err(
    queryError('parameter_type', 'Parameter has an invalid type or value', {
      path: `parameters.${name}`,
    })
  );
}

function metricGroupBy(value: unknown, dimensions: readonly string[]) {
  if (value === undefined) return ok<string[]>([]);
  if (
    !Array.isArray(value) ||
    value.length > dimensions.length ||
    !value.every((item): item is string => typeof item === 'string' && dimensions.includes(item)) ||
    new Set(value).size !== value.length
  ) {
    return err(invalid('groupBy must contain unique admitted metric dimensions'));
  }
  return ok(value);
}

function prepareSharedMetric(
  definition: DataQueryComposition,
  dimensions: string[],
  sourceOutputs: readonly DataQueryOutput[],
  source: CompositionSource
) {
  if (definition.page?.offset) {
    return err(invalid('A shared metric must start at the first group. Remove the page offset.'));
  }
  if (
    definition.metrics?.length !== 1 ||
    definition.groupBy ||
    definition.select ||
    definition.orderBy
  ) {
    return err(invalid('A shared metric requires one aggregate and caller-selected dimensions'));
  }
  return safeTry(function* () {
    const fixed = yield* prepareFixedComposition(
      { ...definition, groupBy: dimensions },
      sourceOutputs,
      source
    );
    // The source and owner-defined filters use their saved defaults on every metric run.
    const base = yield* fixed.bind();
    const dimensionOutputs = fixed.outputs.slice(0, dimensions.length);
    const parameters = yield* metricControls(dimensionOutputs);
    const filterOutputs = new Map<string, DataQueryOutput>(
      dimensionOutputs.map((output) => [`where_${output.alias}`, output])
    );
    const optionalParameters = Object.keys(parameters);
    const outputs = [
      ...dimensionOutputs.map((output) => ({ ...output, nullable: true })),
      ...fixed.outputs.slice(dimensions.length),
    ];
    return ok({
      outputs,
      parameters,
      optionalParameters,
      bind(input: Readonly<Record<string, unknown>> = {}) {
        return safeTry(function* () {
          if (!input || typeof input !== 'object' || Array.isArray(input) || !isPlainData(input)) {
            return err(invalid('Metric parameters must be a plain object'));
          }
          const { groupBy, ...filterInput } = input;
          const groups = yield* metricGroupBy(groupBy, dimensions);
          const filters = [...base.composition.filters];
          for (const [name, inputValue] of Object.entries(filterInput)) {
            const output = filterOutputs.get(name);
            if (!output) {
              return err(
                queryError('unknown_parameter', 'An undeclared parameter was provided', {
                  path: `parameters.${name}`,
                })
              );
            }
            const value = yield* metricFilterValue(name, output, inputValue);
            filters.push({ alias: output.alias, operator: 'eq', value });
          }
          return ok({
            parameters: base.parameters,
            composition: {
              ...base.composition,
              definition: { ...definition, groupBy: groups },
              outputs,
              filters,
            },
          });
        });
      },
    });
  });
}

export function prepareDataQueryComposition(
  definition: DataQueryComposition,
  sourceOutputs: readonly DataQueryOutput[],
  source: CompositionSource
) {
  return definition.metricDimensions
    ? prepareSharedMetric(definition, definition.metricDimensions, sourceOutputs, source)
    : prepareFixedComposition(definition, sourceOutputs, source);
}
