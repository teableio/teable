import {
  domainError,
  FieldId,
  RecordConditionDateValue,
  RecordId,
  recordFilterConditionSchema,
  recordFilterDateModeSchema,
  recordFilterOperatorSchema,
  recordFilterSchema,
  TableId,
  tableRecordAggregationFunctionValues,
  type DomainError,
  type RecordFilter,
  type RecordFilterNode,
  type RecordFilterValue,
} from '@teable/v2-core';
import { err, ok, safeTry, type Result } from 'neverthrow';
import { z } from 'zod';

import type {
  BoundDataQuery,
  DataQueryDefinitionInput,
  DataQueryFilter,
  DataQueryFilterLeaf,
  DataQueryParameterDefinition,
  DataQueryParameterReference,
  DataQuerySort,
  DataQuerySortResolved,
} from './types';

export const queryError = (
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>
): DomainError =>
  domainError.validation({
    code: `data_query.${code}`,
    message,
    ...(details ? { details } : {}),
  });

export const freezeQueryValue = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeQueryValue(child);
    Object.freeze(value);
  }
  return value;
};

export const dataQueryNameSchema = z
  .string()
  .min(1)
  .refine((value) => value !== '__proto__' && value !== 'prototype' && value !== 'constructor');
const utf8Encoder = new TextEncoder();
const aliasSchema = dataQueryNameSchema.refine(
  (value) => !value.includes('\0') && utf8Encoder.encode(value).length <= 63
);
const fieldIdSchema = z.string().refine((value) => FieldId.create(value).isOk());
const tableIdSchema = z.string().refine((value) => TableId.create(value).isOk());
const referenceSchema = z
  .object({ type: z.literal('parameter'), name: dataQueryNameSchema })
  .strict();
const dateSchema = z
  .object({
    mode: recordFilterDateModeSchema,
    numberOfDays: z.number().int().nonnegative().optional(),
    exactDate: z.string().datetime({ offset: true }).optional(),
    exactDateEnd: z.string().datetime({ offset: true }).optional(),
    timeZone: z.string(),
  })
  .strict()
  .refine((value) => RecordConditionDateValue.create(value).isOk())
  .refine(
    (value) =>
      value.mode !== 'dateRange' ||
      (value.exactDate !== undefined &&
        value.exactDateEnd !== undefined &&
        Date.parse(value.exactDate) <= Date.parse(value.exactDateEnd))
  );
const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
const valueSchema = z
  .union([
    scalarSchema,
    z.array(scalarSchema).nonempty(),
    dateSchema,
    z
      .object({
        type: z.literal('field'),
        fieldId: fieldIdSchema,
        tableId: tableIdSchema.optional(),
      })
      .strict(),
  ])
  .nullable();
const filterSchema: z.ZodType<DataQueryFilter, DataQueryFilter> = z.lazy(() =>
  z.union([
    z
      .object({ conjunction: z.enum(['and', 'or']), items: z.array(filterSchema).nonempty() })
      .strict(),
    z.object({ not: filterSchema }).strict(),
    z
      .object({
        fieldId: fieldIdSchema,
        operator: recordFilterOperatorSchema,
        value: z.union([referenceSchema, valueSchema]),
        /** Only meaningful for parameter values: an absent parameter removes this leaf. */
        optional: z.boolean().optional(),
      })
      .strict(),
  ])
);
export const dataQueryParameterDefinitionSchema = z
  .object({
    type: z.enum(['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]', 'date']),
    nullable: z.boolean().optional(),
    default: valueSchema.optional(),
  })
  .strict();
const systemSchema = z.enum(['id', 'createdTime', 'lastModifiedTime', 'autoNumber', 'version']);
const fieldProjectionSchema = z
  .object({ fieldId: fieldIdSchema, alias: aliasSchema, arrayDistinct: z.boolean().optional() })
  .strict();
const orderSchema = z.enum(['asc', 'desc']);
const sortTargetSchema = z.union([
  z.object({ fieldId: fieldIdSchema }).strict(),
  z.object({ system: systemSchema }).strict(),
]);
/**
 * A parameterized sort never accepts a raw identifier. `allowed` is the complete
 * set of concrete targets the runtime parameter may resolve to.
 */
const parameterizedSortSchema = z
  .object({
    field: referenceSchema,
    order: z.union([orderSchema, referenceSchema]),
    allowed: z.array(sortTargetSchema).nonempty(),
    optional: z.boolean().optional(),
  })
  .strict();
const sortItemSchema = z.union([
  z.object({ fieldId: fieldIdSchema, order: orderSchema }).strict(),
  z.object({ system: systemSchema, order: orderSchema }).strict(),
  z.object({ alias: aliasSchema, order: orderSchema }).strict(),
  parameterizedSortSchema,
]);
const baseShape = {
  version: z.literal(1),
  tableId: tableIdSchema,
  parameters: z.record(dataQueryNameSchema, dataQueryParameterDefinitionSchema).optional(),
  filter: filterSchema.optional(),
  page: z
    .object({
      limit: z.union([z.number().int().min(1).max(1000), referenceSchema]),
      offset: z.union([z.number().int().min(0).max(2147483647), referenceSchema]).optional(),
      includeTotal: z.boolean().optional(),
    })
    .strict()
    .optional(),
  sort: z.array(sortItemSchema).optional(),
};
export const dataQueryDefinitionInputSchema: z.ZodType<
  DataQueryDefinitionInput,
  DataQueryDefinitionInput
> = z.discriminatedUnion('kind', [
  z
    .object({
      ...baseShape,
      kind: z.literal('records'),
      recordId: z
        .union([z.string().refine((value) => RecordId.create(value).isOk()), referenceSchema])
        .optional(),
      select: z
        .tuple([
          z.union([
            fieldProjectionSchema,
            z.object({ system: systemSchema, alias: aliasSchema }).strict(),
          ]),
        ])
        .rest(
          z.union([
            fieldProjectionSchema,
            z.object({ system: systemSchema, alias: aliasSchema }).strict(),
          ])
        ),
    })
    .strict(),
  z
    .object({
      ...baseShape,
      kind: z.literal('aggregate'),
      aggregates: z
        .tuple([
          z
            .object({
              fieldId: fieldIdSchema,
              statisticFunc: z.enum(tableRecordAggregationFunctionValues),
              alias: aliasSchema,
            })
            .strict(),
        ])
        .rest(
          z
            .object({
              fieldId: fieldIdSchema,
              statisticFunc: z.enum(tableRecordAggregationFunctionValues),
              alias: aliasSchema,
            })
            .strict()
        ),
      groupBy: z.array(fieldProjectionSchema).optional(),
    })
    .strict(),
]);

export const isParameterReference = (value: unknown): value is DataQueryParameterReference =>
  value !== null && typeof value === 'object' && 'type' in value && value.type === 'parameter';

const parameterValueSchemas = {
  string: z.string(),
  number: z.number().finite(),
  boolean: z.boolean(),
  'string[]': z.array(z.string()).nonempty(),
  'number[]': z.array(z.number().finite()).nonempty(),
  'boolean[]': z.array(z.boolean()).nonempty(),
  date: dateSchema,
};

const parameterValue = (
  definition: DataQueryParameterDefinition,
  raw: unknown
): Result<RecordFilterValue, DomainError> => {
  if (raw === null)
    return definition.nullable
      ? ok(null)
      : err(queryError('parameter_type', 'Parameter does not allow null'));
  const parsed = parameterValueSchemas[definition.type].safeParse(raw);
  return parsed.success
    ? ok(parsed.data)
    : err(queryError('parameter_type', 'Parameter has an invalid type or value'));
};

export const representativeParameterValue = (
  definition: DataQueryParameterDefinition
): RecordFilterValue => {
  const values: Record<DataQueryParameterDefinition['type'], RecordFilterValue> = {
    string: 'sample',
    number: 1,
    boolean: true,
    'string[]': ['sample'],
    'number[]': [1],
    'boolean[]': [true],
    date: { mode: 'exactDate', exactDate: '2026-01-01T00:00:00.000Z', timeZone: 'UTC' },
  };
  return values[definition.type];
};

export const mapQueryFilter = (
  filter: DataQueryFilter,
  resolve: (reference: DataQueryParameterReference) => RecordFilterValue
): RecordFilterNode => {
  if ('items' in filter)
    return {
      conjunction: filter.conjunction,
      items: filter.items.map((item) => mapQueryFilter(item, resolve)),
    };
  if ('not' in filter) return { not: mapQueryFilter(filter.not, resolve) };
  return {
    ...filter,
    value: isParameterReference(filter.value) ? resolve(filter.value) : filter.value,
  };
};

type ParameterUsage = { required: Set<string>; optional: Set<string> };
type ParameterReferenceRecorder = (
  reference: DataQueryParameterReference,
  isOptional: boolean
) => void;

const collectFilterReferenceUsages = (
  node: DataQueryFilter,
  record: ParameterReferenceRecorder
): void => {
  if ('items' in node) {
    node.items.forEach((item) => collectFilterReferenceUsages(item, record));
    return;
  }
  if ('not' in node) {
    collectFilterReferenceUsages(node.not, record);
    return;
  }
  if (isParameterReference(node.value)) record(node.value, node.optional === true);
};

/**
 * A parameter without its own default may be omitted only when every reference to it belongs
 * to an optional construct. Anything referenced by a required position stays mandatory.
 */
export const dataQueryParameterUsage = (definition: DataQueryDefinitionInput): ParameterUsage => {
  const required = new Set<string>();
  const optional = new Set<string>();
  const record: ParameterReferenceRecorder = (reference, isOptional) => {
    (isOptional ? optional : required).add(reference.name);
  };
  if (definition.filter) collectFilterReferenceUsages(definition.filter, record);
  for (const sort of definition.sort ?? []) {
    if (!('field' in sort)) continue;
    record(sort.field, sort.optional === true);
    if (isParameterReference(sort.order)) record(sort.order, sort.optional === true);
  }
  for (const value of [definition.page?.limit, definition.page?.offset]) {
    if (isParameterReference(value)) record(value, false);
  }
  if (definition.kind === 'records' && isParameterReference(definition.recordId)) {
    record(definition.recordId, false);
  }
  for (const name of required) optional.delete(name);
  return { required, optional };
};

/** The parameters a caller may omit because no required position references them. */
export const dataQueryOptionalParameters = (
  definition: DataQueryDefinitionInput
): ReadonlySet<string> => dataQueryParameterUsage(definition).optional;

type FilterGroup = Extract<DataQueryFilter, { items: DataQueryFilter[] }>;
type FilterNegation = Extract<DataQueryFilter, { not: DataQueryFilter }>;

const resolveFilterGroup = (
  node: FilterGroup,
  values: ReadonlyMap<string, RecordFilterValue>
): Result<RecordFilterNode | undefined, DomainError> => {
  const items: RecordFilterNode[] = [];
  for (const item of node.items) {
    const resolved = resolveFilterNode(item, values);
    if (resolved.isErr()) return err(resolved.error);
    if (resolved.value !== undefined) items.push(resolved.value);
  }
  // An optional-only group disappears instead of becoming an invalid empty group.
  return items.length === 0 ? ok(undefined) : ok({ conjunction: node.conjunction, items });
};

const resolveFilterNegation = (
  node: FilterNegation,
  values: ReadonlyMap<string, RecordFilterValue>
): Result<RecordFilterNode | undefined, DomainError> => {
  const resolved = resolveFilterNode(node.not, values);
  if (resolved.isErr()) return err(resolved.error);
  // The negation of a condition the caller never supplied is not a predicate.
  return ok(resolved.value === undefined ? undefined : { not: resolved.value });
};

const resolveFilterLeaf = (
  node: DataQueryFilterLeaf,
  values: ReadonlyMap<string, RecordFilterValue>
): Result<RecordFilterNode | undefined, DomainError> => {
  if (!isParameterReference(node.value)) {
    return ok({ fieldId: node.fieldId, operator: node.operator, value: node.value });
  }
  if (!values.has(node.value.name)) {
    return node.optional === true
      ? ok(undefined)
      : err(queryError('missing_parameter', 'A required filter parameter is missing'));
  }
  return ok({
    fieldId: node.fieldId,
    operator: node.operator,
    value: values.get(node.value.name)!,
  });
};

function resolveFilterNode(
  node: DataQueryFilter,
  values: ReadonlyMap<string, RecordFilterValue>
): Result<RecordFilterNode | undefined, DomainError> {
  if ('items' in node) return resolveFilterGroup(node, values);
  if ('not' in node) return resolveFilterNegation(node, values);
  return resolveFilterLeaf(node, values);
}

/**
 * Removes absent optional leaves and any group they leave empty, then validates the result.
 * `values` without a key means the parameter was absent; an explicit `null` is a value.
 */
export const resolveDataQueryFilter = (
  filter: DataQueryFilter | undefined,
  values: ReadonlyMap<string, RecordFilterValue>
): Result<RecordFilter | undefined, DomainError> => {
  if (!filter) return ok(undefined);
  const resolved = resolveFilterNode(filter, values);
  if (resolved.isErr()) return err(resolved.error);
  if (resolved.value === undefined) return ok(undefined);
  const parsed = recordFilterSchema.safeParse(resolved.value);
  return parsed.success
    ? ok(parsed.data)
    : err(queryError('invalid_filter', 'Bound parameters are incompatible with the query filter'));
};

const isParameterMap = (raw: unknown): raw is Readonly<Record<string, unknown>> => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const prototype = Object.getPrototypeOf(raw);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(raw).every((key) => typeof key === 'string')
  );
};

export const isPlainData = (value: unknown, ancestors = new WeakSet<object>()): boolean => {
  if (value === null || typeof value !== 'object')
    return typeof value !== 'function' && typeof value !== 'symbol';
  if (ancestors.has(value)) return false;
  if (!Array.isArray(value) && !isParameterMap(value)) return false;
  ancestors.add(value);
  const valid = Reflect.ownKeys(value).every((key) => {
    if (Array.isArray(value) && key === 'length') return true;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return (
      typeof key === 'string' &&
      key !== '__proto__' &&
      key !== 'constructor' &&
      key !== 'prototype' &&
      descriptor.enumerable === true &&
      'value' in descriptor &&
      isPlainData(descriptor.value, ancestors)
    );
  });
  ancestors.delete(value);
  return valid;
};

const boundQueryToken = Symbol('bound-query');

class BoundDataQueryValue implements BoundDataQuery {
  readonly #bound = true;

  constructor(
    token: symbol,
    readonly validatedDefinition: DataQueryDefinition,
    readonly definition: DataQueryDefinitionInput,
    readonly filter: RecordFilter | undefined,
    readonly limit: number,
    readonly offset: number,
    readonly sort: ReadonlyArray<DataQuerySortResolved>,
    readonly includeTotal: boolean,
    readonly recordId?: string
  ) {
    if (token !== boundQueryToken)
      throw new Error('Bound queries must be created by definition.bind');
    freezeQueryValue(definition);
    freezeQueryValue(filter);
    freezeQueryValue(sort);
    Object.freeze(this);
  }

  static isBound(value: unknown): value is BoundDataQueryValue {
    return value !== null && typeof value === 'object' && #bound in value && value.#bound;
  }
}

/** Bound values are transient immutable execution inputs, not caller-reconstructable DTOs. */
export const isBoundDataQuery = (value: unknown): value is BoundDataQuery =>
  BoundDataQueryValue.isBound(value);

type ParameterDefinitions = NonNullable<DataQueryDefinitionInput['parameters']>;
type ParameterValues = ReadonlyMap<string, RecordFilterValue>;

export const validateDataQueryParameterDefaults = (
  parameters: ParameterDefinitions
): Result<void, DomainError> => {
  for (const parameter of Object.values(parameters)) {
    if (Object.hasOwn(parameter, 'default') && parameterValue(parameter, parameter.default).isErr())
      return err(queryError('parameter_default', 'Parameter default has an invalid type or value'));
  }
  return ok(undefined);
};

const hasValidFilterLiterals = (node: DataQueryFilter): boolean => {
  if ('items' in node) return node.items.every(hasValidFilterLiterals);
  if ('not' in node) return hasValidFilterLiterals(node.not);
  return isParameterReference(node.value) || recordFilterConditionSchema.safeParse(node).success;
};

const validateOptionalFilters = (node: DataQueryFilter): Result<void, DomainError> => {
  if ('items' in node) {
    for (const item of node.items) {
      const validated = validateOptionalFilters(item);
      if (validated.isErr()) return validated;
    }
    return ok(undefined);
  }
  if ('not' in node) return validateOptionalFilters(node.not);
  return node.optional === true && !isParameterReference(node.value)
    ? err(queryError('invalid_optional_filter', 'Optional filters require a parameter value'))
    : ok(undefined);
};

const filterParameterReferences = (
  filter: DataQueryFilter | undefined,
  parameters: ParameterDefinitions
): Result<DataQueryParameterReference[], DomainError> => {
  if (!filter) return ok([]);
  const optional = validateOptionalFilters(filter);
  if (optional.isErr()) return err(optional.error);
  const references: DataQueryParameterReference[] = [];
  let undeclared: string | undefined;
  const representative = mapQueryFilter(filter, (reference) => {
    references.push(reference);
    if (!Object.hasOwn(parameters, reference.name)) {
      undeclared ??= reference.name;
      return null;
    }
    return representativeParameterValue(parameters[reference.name]);
  });
  if (undeclared !== undefined) {
    return err(queryError('unknown_parameter', `Parameter \`${undeclared}\` is not declared`));
  }
  if (!recordFilterSchema.safeParse(representative).success || !hasValidFilterLiterals(filter)) {
    return err(queryError('invalid_filter', 'Invalid query filter'));
  }
  return ok(references);
};

const pageParameterReferences = (
  page: DataQueryDefinitionInput['page'],
  parameters: ParameterDefinitions
): Result<DataQueryParameterReference[], DomainError> => {
  const references: DataQueryParameterReference[] = [];
  for (const value of [page?.limit, page?.offset]) {
    if (!isParameterReference(value)) continue;
    references.push(value);
    const parameter = Object.hasOwn(parameters, value.name) ? parameters[value.name] : undefined;
    if (parameter && (parameter.type !== 'number' || parameter.nullable)) {
      return err(
        queryError('page_parameter', 'Pagination requires a non-nullable number parameter')
      );
    }
  }
  return ok(references);
};

const validateRecordIdParameter = (
  value: DataQueryDefinitionInput,
  parameters: ParameterDefinitions
): Result<void, DomainError> => {
  if (value.kind !== 'records' || !isParameterReference(value.recordId)) return ok(undefined);
  const parameter = parameters[value.recordId.name];
  if (parameter.type !== 'string' || parameter.nullable) {
    return err(
      queryError('record_id_parameter', 'Record identity requires a non-nullable string parameter')
    );
  }
  if (parameter.default !== undefined && RecordId.create(String(parameter.default)).isErr()) {
    return err(
      queryError('record_id_parameter', 'Record identity requires a valid record ID default')
    );
  }
  return ok(undefined);
};

type ParameterizedSort = Extract<DataQuerySort, { field: DataQueryParameterReference }>;

const validateParameterizedSort = (
  sort: ParameterizedSort,
  parameters: ParameterDefinitions,
  index: number
): Result<DataQueryParameterReference[], DomainError> => {
  const isSortParameter = (reference: DataQueryParameterReference): boolean => {
    const parameter = parameters[reference.name];
    return parameter?.type === 'string' && !parameter.nullable;
  };
  if (!isSortParameter(sort.field)) {
    return err(
      queryError(
        'sort_parameter',
        `sort.${index}.field: parameter \`${sort.field.name}\` must be a non-nullable string`
      )
    );
  }
  const references = [sort.field];
  if (isParameterReference(sort.order)) {
    if (!isSortParameter(sort.order)) {
      return err(
        queryError(
          'sort_parameter',
          `sort.${index}.order: parameter \`${sort.order.name}\` must be a non-nullable string`
        )
      );
    }
    references.push(sort.order);
  }
  const targets = sort.allowed.map((target) =>
    'fieldId' in target ? `field:${target.fieldId}` : `system:${target.system}`
  );
  return new Set(targets).size === targets.length
    ? ok(references)
    : err(queryError('sort_parameter', 'Sort allow-lists must not contain duplicates'));
};

const validateAliasSort = (
  value: DataQueryDefinitionInput,
  sort: Extract<DataQuerySort, { alias: string }>,
  outputAliases: ReadonlySet<string>
): Result<void, DomainError> =>
  value.kind === 'aggregate' && outputAliases.has(sort.alias)
    ? ok(undefined)
    : err(queryError('aggregate_sort', 'Alias sorting requires an aggregate output alias'));

const validateFieldSort = (
  value: DataQueryDefinitionInput,
  sort: ParameterizedSort,
  parameters: ParameterDefinitions,
  groupFieldIds: ReadonlySet<string>,
  index: number
): Result<DataQueryParameterReference[], DomainError> => {
  const references = validateParameterizedSort(sort, parameters, index);
  if (references.isErr()) return err(references.error);
  if (
    value.kind === 'aggregate' &&
    sort.allowed.some((target) => !('fieldId' in target) || !groupFieldIds.has(target.fieldId))
  ) {
    return err(queryError('aggregate_sort', 'Aggregate sorting must reference a grouping field'));
  }
  return references;
};

const validateLiteralSort = (
  value: DataQueryDefinitionInput,
  sort: Exclude<DataQuerySort, ParameterizedSort | { alias: string }>,
  groupFieldIds: ReadonlySet<string>
): Result<void, DomainError> =>
  value.kind !== 'aggregate' || ('fieldId' in sort && groupFieldIds.has(sort.fieldId))
    ? ok(undefined)
    : err(
        queryError('aggregate_sort', 'Aggregate sorting must reference a grouping field or alias')
      );

type SortContext = { groupFieldIds: ReadonlySet<string>; outputAliases: ReadonlySet<string> };

const sortContext = (value: DataQueryDefinitionInput): SortContext => ({
  groupFieldIds: new Set(
    (value.kind === 'aggregate' ? value.groupBy ?? [] : []).map((group) => group.fieldId)
  ),
  outputAliases: new Set(
    value.kind === 'records'
      ? value.select.map((projection) => projection.alias)
      : [...(value.groupBy ?? []), ...value.aggregates].map((output) => output.alias)
  ),
});

const validateSorts = (
  value: DataQueryDefinitionInput,
  parameters: ParameterDefinitions
): Result<DataQueryParameterReference[], DomainError> => {
  const references: DataQueryParameterReference[] = [];
  const { groupFieldIds, outputAliases } = sortContext(value);
  for (const [index, sort] of (value.sort ?? []).entries()) {
    if ('alias' in sort) {
      const validated = validateAliasSort(value, sort, outputAliases);
      if (validated.isErr()) return err(validated.error);
      continue;
    }
    if ('field' in sort) {
      const validated = validateFieldSort(value, sort, parameters, groupFieldIds, index);
      if (validated.isErr()) return err(validated.error);
      references.push(...validated.value);
      continue;
    }
    const validated = validateLiteralSort(value, sort, groupFieldIds);
    if (validated.isErr()) return err(validated.error);
  }
  return ok(references);
};

const validateDefinition = (value: DataQueryDefinitionInput): Result<void, DomainError> =>
  safeTry(function* () {
    const parameters = value.parameters ?? {};
    yield* validateDataQueryParameterDefaults(parameters);
    const outputs =
      value.kind === 'records' ? value.select : [...(value.groupBy ?? []), ...value.aggregates];
    if (new Set(outputs.map((output) => output.alias)).size !== outputs.length) {
      return err(queryError('duplicate_alias', 'Output aliases must be unique'));
    }
    if (value.kind === 'aggregate') {
      const invalidGroup = (value.groupBy ?? []).findIndex((group) => group.arrayDistinct === true);
      if (invalidGroup >= 0) {
        return err(
          queryError(
            'array_distinct_scope',
            `groupBy.${invalidGroup}: arrayDistinct is only available on records projections`
          )
        );
      }
    }
    const references = [
      ...(yield* filterParameterReferences(value.filter, parameters)),
      ...(yield* pageParameterReferences(value.page, parameters)),
      ...(yield* validateSorts(value, parameters)),
      ...(value.kind === 'records' && isParameterReference(value.recordId) ? [value.recordId] : []),
    ];
    if (references.some((reference) => !Object.hasOwn(parameters, reference.name))) {
      return err(queryError('unknown_parameter', 'Query references an undeclared parameter'));
    }
    yield* validateRecordIdParameter(value, parameters);
    return ok(undefined);
  });

const assertDeclaredParameters = (
  values: Readonly<Record<string, unknown>>,
  definitions: ParameterDefinitions
): Result<void, DomainError> => {
  for (const key of Object.keys(values)) {
    if (!Object.hasOwn(definitions, key)) {
      return err(
        queryError('unknown_parameter', 'An undeclared parameter was provided', {
          path: `parameters.${key}`,
        })
      );
    }
  }
  return ok(undefined);
};

const bindParameterValues = (
  definitions: ParameterDefinitions,
  input: Readonly<Record<string, unknown>>,
  optional: ReadonlySet<string>
): Result<ParameterValues, DomainError> =>
  safeTry(function* () {
    if (!isParameterMap(input) || !isPlainData(input)) {
      return err(queryError('parameter_map', 'Parameters must be own-key plain data maps'));
    }
    yield* assertDeclaredParameters(input, definitions);
    const values = new Map<string, RecordFilterValue>();
    for (const [name, definition] of Object.entries(definitions)) {
      if (!Object.hasOwn(input, name) && !Object.hasOwn(definition, 'default')) {
        // Absent, not null: no entry in the map, so optional constructs can recognize it.
        if (optional.has(name)) continue;
        return err(
          queryError('missing_parameter', 'A required parameter is missing', {
            path: `parameters.${name}`,
          })
        );
      }
      const parsed = yield* parameterValue(
        definition,
        Object.hasOwn(input, name) ? input[name] : definition.default
      ).mapErr((error) =>
        error.details
          ? error
          : domainError.validation({
              code: error.code,
              message: error.message,
              details: { path: `parameters.${name}` },
            })
      );
      values.set(name, parsed);
    }
    return ok(values);
  });

const bindPage = (
  page: DataQueryDefinitionInput['page'],
  values: ParameterValues
): Result<{ limit: number; offset: number }, DomainError> => {
  for (const value of [page?.limit, page?.offset]) {
    if (isParameterReference(value) && !values.has(value.name)) {
      return err(queryError('missing_parameter', 'A required pagination parameter is missing'));
    }
  }
  const limit = isParameterReference(page?.limit)
    ? values.get(page.limit.name)
    : page?.limit ?? 100;
  const offset = isParameterReference(page?.offset)
    ? values.get(page.offset.name)
    : page?.offset ?? 0;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return err(queryError('invalid_page', 'Pagination must use bounded integers'));
  }
  if (
    typeof offset !== 'number' ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 2147483647
  ) {
    return err(queryError('invalid_page', 'Pagination must use bounded integers'));
  }
  return ok({ limit, offset });
};

const resolveParameterizedSort = (
  item: ParameterizedSort,
  values: ParameterValues
): Result<DataQuerySortResolved | undefined, DomainError> => {
  const fieldPresent = values.has(item.field.name);
  const orderPresent = !isParameterReference(item.order) || values.has(item.order.name);
  if (!fieldPresent || !orderPresent) {
    return item.optional === true
      ? ok(undefined)
      : err(queryError('missing_parameter', 'A required sort parameter is missing'));
  }
  const field = values.get(item.field.name);
  const target = item.allowed.find((candidate) =>
    'fieldId' in candidate ? candidate.fieldId === field : candidate.system === field
  );
  if (!target) {
    return err(
      queryError(
        'sort_field',
        `Sort field parameter \`${item.field.name}\` does not name an allowed sort target`
      )
    );
  }
  const order = isParameterReference(item.order) ? values.get(item.order.name) : item.order;
  if (order !== 'asc' && order !== 'desc') {
    const source = isParameterReference(item.order)
      ? `parameter \`${item.order.name}\``
      : 'literal';
    return err(queryError('sort_order', `Sort order ${source} must be either asc or desc`));
  }
  return ok(
    'fieldId' in target ? { fieldId: target.fieldId, order } : { system: target.system, order }
  );
};

const bindSort = (
  sort: DataQuerySort[] | undefined,
  values: ParameterValues
): Result<DataQuerySortResolved[], DomainError> => {
  const resolved: DataQuerySortResolved[] = [];
  for (const item of sort ?? []) {
    if (!('field' in item)) {
      resolved.push(
        'fieldId' in item
          ? { fieldId: item.fieldId, order: item.order }
          : 'system' in item
            ? { system: item.system, order: item.order }
            : { alias: item.alias, order: item.order }
      );
      continue;
    }
    const parameterized = resolveParameterizedSort(item, values);
    if (parameterized.isErr()) return err(parameterized.error);
    if (parameterized.value !== undefined) resolved.push(parameterized.value);
  }
  return ok(resolved);
};

export class DataQueryDefinition {
  private constructor(private readonly value: DataQueryDefinitionInput) {
    Object.freeze(this);
  }

  static create(raw: unknown): Result<DataQueryDefinition, DomainError> {
    try {
      if (!isPlainData(raw))
        return err(queryError('invalid_definition', 'Query definitions must contain plain data'));
      const parsed = dataQueryDefinitionInputSchema.safeParse(raw);
      if (!parsed.success)
        return err(queryError('invalid_definition', 'Invalid structured query definition'));
      const value: DataQueryDefinitionInput = parsed.data;
      return validateDefinition(value).map(() => new DataQueryDefinition(freezeQueryValue(value)));
    } catch {
      return err(queryError('invalid_definition', 'Invalid structured query definition'));
    }
  }

  snapshot(): DataQueryDefinitionInput {
    return structuredClone(this.value);
  }

  bind(input: Readonly<Record<string, unknown>>): Result<BoundDataQuery, DomainError> {
    try {
      return safeTry(
        function* (this: DataQueryDefinition) {
          const values = yield* bindParameterValues(
            this.value.parameters ?? {},
            input,
            dataQueryOptionalParameters(this.value)
          );
          const { limit, offset } = yield* bindPage(this.value.page, values);
          // Undefined is absence (optional leaves/items are skipped); null stays an explicit value.
          const filter = yield* resolveDataQueryFilter(this.value.filter, values);
          const sort = yield* bindSort(this.value.sort, values);
          const rawRecordId = this.value.kind === 'records' ? this.value.recordId : undefined;
          if (isParameterReference(rawRecordId) && !values.has(rawRecordId.name)) {
            return err(queryError('missing_parameter', 'A required record identity is missing'));
          }
          const recordId = isParameterReference(rawRecordId)
            ? values.get(rawRecordId.name)
            : rawRecordId;
          if (
            recordId !== undefined &&
            (typeof recordId !== 'string' || RecordId.create(recordId).isErr())
          ) {
            return err(queryError('record_id', 'Invalid record identity'));
          }
          return ok(
            new BoundDataQueryValue(
              boundQueryToken,
              this,
              this.snapshot(),
              filter,
              limit,
              offset,
              sort,
              this.value.page?.includeTotal === true,
              recordId
            )
          );
        }.bind(this)
      );
    } catch {
      return err(queryError('parameter_type', 'Invalid query parameter values'));
    }
  }
}
