import { domainError } from '@teable/v2-core';
import { err, ok, safeTry } from 'neverthrow';
import { z } from 'zod';
import {
  bindParameterValues,
  aliasSchema as alias,
  dataQueryNameSchema,
  dataQueryParameterDefinitionSchema,
  dataQueryParameterUsage,
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

export function prepareDataQueryComposition(
  definition: DataQueryComposition,
  sourceOutputs: readonly DataQueryOutput[],
  source: {
    definition: DataQueryDefinitionInput;
    parameters: Record<string, DataQueryParameterDefinition>;
    optionalParameters: ReadonlySet<string>;
  }
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
