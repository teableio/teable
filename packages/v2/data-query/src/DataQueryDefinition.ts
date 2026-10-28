import {
  domainError,
  FieldId,
  isoDateTimeWithOffsetSchema,
  RecordConditionDateValue,
  RecordId,
  recordFilterConditionSchema,
  recordFilterDateModeSchema,
  recordFilterOperatorSchema,
  recordFilterSchema,
  TableId,
  TIME_ZONE_LIST,
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
  DataQueryRelationAggregate,
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
    exactDate: isoDateTimeWithOffsetSchema().optional(),
    exactDateEnd: isoDateTimeWithOffsetSchema().optional(),
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
// PostgreSQL interprets a POSIX-style offset with the opposite sign from ISO-8601
// (`'+05:00'` becomes UTC-5), so only the curated IANA names are accepted.
const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) =>
    (TIME_ZONE_LIST as ReadonlyArray<string>).includes(
      value.toUpperCase() === 'UTC' ? 'utc' : value
    )
  );
const bucketLabelSchema = dataQueryNameSchema.refine(
  (value) => !value.includes('\0') && utf8Encoder.encode(value).length <= 128
);
const bucketEdgeSchema = z
  .object({ maxExclusive: z.number().finite(), label: bucketLabelSchema })
  .strict();
const bucketEdgesSchema = z
  .tuple([bucketEdgeSchema])
  .rest(bucketEdgeSchema)
  .refine((edges) => edges.length <= 8, 'A bucket accepts at most eight edges')
  .refine(
    (edges) =>
      edges.every(
        (edge, index) => index === 0 || edge.maxExclusive > edges[index - 1].maxExclusive
      ),
    'Bucket edges must be strictly ascending'
  )
  .refine(
    (edges) => new Set(edges.map((edge) => edge.label)).size === edges.length,
    'Bucket labels must be unique'
  );
const bucketSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('dateTrunc'),
      unit: z.enum(['day', 'week', 'month', 'quarter', 'year']),
      timeZone: timeZoneSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('numericRange'),
      edges: bucketEdgesSchema,
      fallbackLabel: bucketLabelSchema,
      nullLabel: bucketLabelSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('dateDifferenceRange'),
      unit: z.enum(['day', 'month']),
      timeZone: timeZoneSchema,
      anchor: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine((value) => {
          const parsed = new Date(`${value}T00:00:00.000Z`);
          return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
        }, 'Anchor must be a real calendar date')
        .optional(),
      edges: bucketEdgesSchema,
      fallbackLabel: bucketLabelSchema,
      nullLabel: bucketLabelSchema.optional(),
    })
    .strict(),
]);
const fieldProjectionSchema = z
  .object({ fieldId: fieldIdSchema, alias: aliasSchema, arrayDistinct: z.boolean().optional() })
  .strict();
const systemProjectionSchema = z.object({ system: systemSchema, alias: aliasSchema }).strict();
const sourceRefShape = { source: dataQueryNameSchema.optional() };
const v2FieldProjectionSchema = fieldProjectionSchema
  .extend({ ...sourceRefShape, bucket: bucketSchema.optional() })
  .strict();
const v2SystemProjectionSchema = systemProjectionSchema.extend(sourceRefShape).strict();
const relationStatisticSchema = z.enum(['count', 'unique', 'sum', 'average', 'min', 'max']);
const relationAggregateSchema = z
  .object({
    source: dataQueryNameSchema,
    fieldId: fieldIdSchema.optional(),
    statisticFunc: relationStatisticSchema,
    alias: aliasSchema,
  })
  .strict();
const v2ProjectionSchema = z.union([
  v2FieldProjectionSchema,
  v2SystemProjectionSchema,
  relationAggregateSchema,
]);
/** A grouped report combines root-field statistics with to-many relation metrics. */
const rootAggregateSchema = z
  .object({
    fieldId: fieldIdSchema,
    statisticFunc: z.enum(tableRecordAggregationFunctionValues),
    alias: aliasSchema,
  })
  .strict();
const v2AggregateSchema = z.union([rootAggregateSchema, relationAggregateSchema]);
const relationSchema = z
  .object({
    linkFieldId: fieldIdSchema,
    tableId: tableIdSchema,
    filter: filterSchema.optional(),
    via: dataQueryNameSchema.optional(),
  })
  .strict();
const orderSchema = z.enum(['asc', 'desc']);
const sortTargetSchema = z.union([
  z.object({ fieldId: fieldIdSchema }).strict(),
  z.object({ system: systemSchema }).strict(),
  z.object({ source: dataQueryNameSchema, fieldId: fieldIdSchema }).strict(),
  z.object({ source: dataQueryNameSchema, system: systemSchema }).strict(),
]);
/**
 * A parameterized sort never accepts a raw identifier. `allowed` is the complete
 * set of concrete targets the runtime parameter may resolve to.
 */
const sortNullsSchema = z.enum(['first', 'last']);
const parameterizedSortSchema = z
  .object({
    field: referenceSchema,
    order: z.union([orderSchema, referenceSchema]),
    allowed: z.array(sortTargetSchema).nonempty(),
    optional: z.boolean().optional(),
    nulls: sortNullsSchema.optional(),
  })
  .strict();
const sortItemSchema = z.union([
  z
    .object({ fieldId: fieldIdSchema, order: orderSchema, nulls: sortNullsSchema.optional() })
    .strict(),
  z
    .object({ system: systemSchema, order: orderSchema, nulls: sortNullsSchema.optional() })
    .strict(),
  z
    .object({
      source: dataQueryNameSchema,
      fieldId: fieldIdSchema,
      order: orderSchema,
      nulls: sortNullsSchema.optional(),
    })
    .strict(),
  z
    .object({
      source: dataQueryNameSchema,
      system: systemSchema,
      order: orderSchema,
      nulls: sortNullsSchema.optional(),
    })
    .strict(),
  z.object({ alias: aliasSchema, order: orderSchema, nulls: sortNullsSchema.optional() }).strict(),
  parameterizedSortSchema,
]);
const baseShape = {
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
const v1Schema = z.discriminatedUnion('kind', [
  z
    .object({
      ...baseShape,
      version: z.literal(1),
      kind: z.literal('records'),
      recordId: z
        .union([z.string().refine((value) => RecordId.create(value).isOk()), referenceSchema])
        .optional(),
      select: z
        .tuple([z.union([fieldProjectionSchema, systemProjectionSchema])])
        .rest(z.union([fieldProjectionSchema, systemProjectionSchema])),
    })
    .strict(),
  z
    .object({
      ...baseShape,
      version: z.literal(1),
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
const v2BaseShape = {
  ...baseShape,
  version: z.literal(2),
  relations: z.record(dataQueryNameSchema, relationSchema).optional(),
};
const v2Schema = z.discriminatedUnion('kind', [
  z
    .object({
      ...v2BaseShape,
      kind: z.literal('records'),
      recordId: z
        .union([z.string().refine((value) => RecordId.create(value).isOk()), referenceSchema])
        .optional(),
      select: z.tuple([v2ProjectionSchema]).rest(v2ProjectionSchema),
    })
    .strict(),
  z
    .object({
      ...v2BaseShape,
      kind: z.literal('aggregate'),
      aggregates: z.tuple([v2AggregateSchema]).rest(v2AggregateSchema),
      groupBy: z.array(v2FieldProjectionSchema).optional(),
    })
    .strict(),
]);
export const dataQueryDefinitionInputSchema: z.ZodType<
  DataQueryDefinitionInput,
  DataQueryDefinitionInput
> = z.union([v1Schema, v2Schema]);

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
// oxlint-disable-next-line sonarjs/cognitive-complexity -- one branch per parameter position
export const dataQueryParameterUsage = (definition: DataQueryDefinitionInput): ParameterUsage => {
  const required = new Set<string>();
  const optional = new Set<string>();
  const record: ParameterReferenceRecorder = (reference, isOptional) => {
    (isOptional ? optional : required).add(reference.name);
  };
  if (definition.filter) collectFilterReferenceUsages(definition.filter, record);
  // A relation filter is bound and executed like the root filter; an optional leaf
  // there must not force the parameter to be required in the generated client.
  if (definition.version === 2) {
    for (const relation of Object.values(definition.relations ?? {})) {
      if (relation.filter) collectFilterReferenceUsages(relation.filter, record);
    }
  }
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
    readonly relationFilters: Readonly<Record<string, RecordFilter>> | undefined,
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
    freezeQueryValue(relationFilters);
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
  // The runtime parameter selects a target by field/system name only, so the same name
  // must not appear twice even across sources; that would be ambiguous.
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
  outputAliases: ReadonlySet<string>,
  relationAggregateAliases: ReadonlySet<string>
): Result<void, DomainError> => {
  // A records sort may order by the one-row-per-root relation aggregate, never by a
  // stored projection alias: only that alias has a documented ordering contract.
  const allowed =
    value.kind === 'aggregate'
      ? outputAliases.has(sort.alias)
      : relationAggregateAliases.has(sort.alias);
  return allowed
    ? ok(undefined)
    : err(queryError('aggregate_sort', 'Alias sorting requires an aggregate output alias'));
};

const validateFieldSort = (
  value: DataQueryDefinitionInput,
  sort: ParameterizedSort,
  parameters: ParameterDefinitions,
  groupFieldIds: ReadonlySet<string>,
  ambiguousGroupFieldIds: ReadonlySet<string>,
  index: number
): Result<DataQueryParameterReference[], DomainError> => {
  const references = validateParameterizedSort(sort, parameters, index);
  if (references.isErr()) return err(references.error);
  const relations = value.version === 2 ? (value.relations ?? {}) : {};
  for (const target of sort.allowed) {
    if ('source' in target && !Object.hasOwn(relations, target.source)) {
      return err(
        queryError('join_source_unknown', 'A sort references an undeclared source', {
          source: target.source,
        })
      );
    }
    if (value.kind === 'aggregate' && 'source' in target) {
      return err(
        queryError(
          'aggregate_sort',
          'Aggregate sorting must use the output alias of a source group'
        )
      );
    }
    if ('fieldId' in target && ambiguousGroupFieldIds.has(target.fieldId)) {
      return err(
        queryError('bucket_sort', 'A bucketed grouping field must be sorted by its alias')
      );
    }
  }
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
  groupFieldIds: ReadonlySet<string>,
  ambiguousGroupFieldIds: ReadonlySet<string>
): Result<void, DomainError> => {
  if ('source' in sort) {
    const relations = value.version === 2 ? (value.relations ?? {}) : {};
    if (!Object.hasOwn(relations, sort.source)) {
      return err(
        queryError('join_source_unknown', 'A sort references an undeclared source', {
          source: sort.source,
        })
      );
    }
    return value.kind === 'aggregate'
      ? err(
          queryError(
            'aggregate_sort',
            'Aggregate sorting must use the output alias of a source group'
          )
        )
      : ok(undefined);
  }
  if ('fieldId' in sort && ambiguousGroupFieldIds.has(sort.fieldId)) {
    return err(queryError('bucket_sort', 'A bucketed grouping field must be sorted by its alias'));
  }
  return value.kind !== 'aggregate' || ('fieldId' in sort && groupFieldIds.has(sort.fieldId))
    ? ok(undefined)
    : err(
        queryError('aggregate_sort', 'Aggregate sorting must reference a grouping field or alias')
      );
};

type SortContext = {
  groupFieldIds: ReadonlySet<string>;
  /** Fields whose only grouping uses a bucket; sorting them by field id is ambiguous. */
  ambiguousGroupFieldIds: ReadonlySet<string>;
  outputAliases: ReadonlySet<string>;
  relationAggregateAliases: ReadonlySet<string>;
};

const sortContext = (value: DataQueryDefinitionInput): SortContext => {
  const groups = value.kind === 'aggregate' ? (value.groupBy ?? []) : [];
  // A source group is ordered by its output alias only; field-id sorting refers to root groups.
  const rootGroups = groups.filter(
    (group) => !('source' in group) || group.source === undefined || group.source === 'root'
  );
  const bucketed = new Set<string>();
  const plain = new Set<string>();
  for (const group of rootGroups) {
    if ('bucket' in group && group.bucket !== undefined) bucketed.add(group.fieldId);
    else plain.add(group.fieldId);
  }
  return {
    groupFieldIds: new Set(rootGroups.map((group) => group.fieldId)),
    ambiguousGroupFieldIds: new Set([...bucketed].filter((fieldId) => !plain.has(fieldId))),
    outputAliases: new Set(
      value.kind === 'records'
        ? value.select.map((projection) => projection.alias)
        : [...(value.groupBy ?? []), ...value.aggregates].map((output) => output.alias)
    ),
    relationAggregateAliases: new Set(
      value.kind === 'records'
        ? value.select
            .filter(
              (projection): projection is DataQueryRelationAggregate =>
                'statisticFunc' in projection
            )
            .map((projection) => projection.alias)
        : []
    ),
  };
};

const validateSorts = (
  value: DataQueryDefinitionInput,
  parameters: ParameterDefinitions
): Result<DataQueryParameterReference[], DomainError> => {
  const references: DataQueryParameterReference[] = [];
  const { groupFieldIds, ambiguousGroupFieldIds, outputAliases, relationAggregateAliases } =
    sortContext(value);
  for (const [index, sort] of (value.sort ?? []).entries()) {
    if ('alias' in sort) {
      const validated = validateAliasSort(value, sort, outputAliases, relationAggregateAliases);
      if (validated.isErr()) return err(validated.error);
      continue;
    }
    if ('field' in sort) {
      const validated = validateFieldSort(
        value,
        sort,
        parameters,
        groupFieldIds,
        ambiguousGroupFieldIds,
        index
      );
      if (validated.isErr()) return err(validated.error);
      references.push(...validated.value);
      continue;
    }
    const validated = validateLiteralSort(value, sort, groupFieldIds, ambiguousGroupFieldIds);
    if (validated.isErr()) return err(validated.error);
  }
  return ok(references);
};

/** Upper bound on independent to-many branches a single query may compile. */
const MAX_RELATION_AGGREGATES = 8;

const validateRelationAggregateEntry = (
  aggregate: DataQueryRelationAggregate,
  location: string,
  allowUnique: boolean,
  sources: ReadonlySet<string>
): Result<void, DomainError> => {
  if (aggregate.source === 'root') {
    return err(
      queryError(
        'relation_aggregate_source',
        `${location}: relation aggregates require a relation source`
      )
    );
  }
  if (!sources.has(aggregate.source)) {
    return err(
      queryError('join_source_unknown', 'A projection references an undeclared source', {
        source: aggregate.source,
      })
    );
  }
  // Distinctness inside one root is meaningful; across roots it cannot be
  // recovered from per-root pre-aggregates, so a grouped report rejects it.
  if (aggregate.statisticFunc === 'unique' && !allowUnique) {
    return err(
      queryError(
        'relation_aggregate_group_unique',
        `${location}: a grouped report cannot return unique relation counts`,
        { source: aggregate.source }
      )
    );
  }
  if (aggregate.statisticFunc === 'count') {
    if (aggregate.fieldId !== undefined) {
      return err(
        queryError(
          'relation_aggregate_field',
          `${location}: count counts related records and takes no fieldId`
        )
      );
    }
    return ok(undefined);
  }
  if (aggregate.fieldId === undefined) {
    return err(
      queryError(
        'relation_aggregate_field',
        `${location}: ${aggregate.statisticFunc} requires a fieldId`
      )
    );
  }
  return ok(undefined);
};

// eslint-disable-next-line sonarjs/cognitive-complexity -- one linear contract per hop
const validateRelations = (value: DataQueryDefinitionInput): Result<void, DomainError> => {
  if (value.version !== 2) return ok(undefined);
  const relations = value.relations ?? {};
  const aliases = Object.keys(relations);
  if (aliases.length > 4) {
    return err(queryError('join_count', 'A query may declare at most four relations'));
  }
  if (aliases.includes('root')) {
    return err(queryError('join_alias_reserved', '`root` is reserved for the root source'));
  }
  // JS reorders integer-like object keys, so their declaration order (and the
  // earlier-alias rule for `via`) cannot be recovered after parsing.
  const numericAlias = aliases.find((alias) => /^(?:0|[1-9]\d*)$/.test(alias));
  if (numericAlias !== undefined) {
    return err(
      queryError(
        'join_alias_order',
        'Relation aliases must not be integer-like; declaration order is not preserved',
        { source: numericAlias }
      )
    );
  }
  // `via` may only name a relation declared earlier. Insertion order is the public
  // declaration order, so cycles are unrepresentable and a chain stops at four hops.
  const declared = new Set<string>();
  const depths = new Map<string, number>();
  for (const alias of aliases) {
    const via = relations[alias]!.via;
    if (via === undefined) {
      depths.set(alias, 0);
    } else {
      if (!declared.has(via)) {
        return err(
          queryError(
            'join_via',
            `relations.${alias}.via: \`${via}\` must name an earlier relation`,
            {
              source: alias,
            }
          )
        );
      }
      const depth = (depths.get(via) ?? 0) + 1;
      if (depth > 3) {
        return err(
          queryError(
            'join_depth',
            `relations.${alias}.via: a relation chain may span at most three hops`,
            { source: alias }
          )
        );
      }
      depths.set(alias, depth);
    }
    declared.add(alias);
  }
  const sources = new Set(['root', ...aliases]);
  const relationAggregates: Array<{
    aggregate: DataQueryRelationAggregate;
    location: string;
    allowUnique: boolean;
  }> = [];
  if (value.kind === 'records') {
    for (const [index, projection] of value.select.entries()) {
      if (
        'source' in projection &&
        projection.source !== undefined &&
        !sources.has(projection.source)
      ) {
        return err(
          queryError('join_source_unknown', 'A projection references an undeclared source', {
            source: projection.source,
          })
        );
      }
      if (
        'bucket' in projection &&
        projection.bucket !== undefined &&
        'arrayDistinct' in projection &&
        projection.arrayDistinct === true
      ) {
        return err(
          queryError(
            'bucket_array_distinct',
            `select.${index}: a bucket cannot be combined with arrayDistinct`
          )
        );
      }
      if ('statisticFunc' in projection) {
        relationAggregates.push({
          aggregate: projection,
          location: `select.${index}`,
          allowUnique: true,
        });
      }
    }
  } else {
    for (const [index, group] of (value.groupBy ?? []).entries()) {
      if ('source' in group && group.source !== undefined && !sources.has(group.source)) {
        return err(
          queryError('join_source_unknown', 'A projection references an undeclared source', {
            source: group.source,
          })
        );
      }
      if ('bucket' in group && group.bucket !== undefined && group.arrayDistinct === true) {
        return err(
          queryError(
            'bucket_array_distinct',
            `groupBy.${index}: a bucket cannot be combined with arrayDistinct`
          )
        );
      }
    }
    for (const [index, aggregate] of value.aggregates.entries()) {
      if (!('source' in aggregate)) continue;
      relationAggregates.push({
        aggregate,
        location: `aggregates.${index}`,
        allowUnique: false,
      });
    }
  }
  if (relationAggregates.length > MAX_RELATION_AGGREGATES) {
    return err(
      queryError(
        'relation_aggregate_count',
        `A query may declare at most ${MAX_RELATION_AGGREGATES} relation aggregates`
      )
    );
  }
  for (const { aggregate, location, allowUnique } of relationAggregates) {
    const validated = validateRelationAggregateEntry(aggregate, location, allowUnique, sources);
    if (validated.isErr()) return err(validated.error);
  }
  return ok(undefined);
};

const relationFilterParameterReferences = (
  value: DataQueryDefinitionInput,
  parameters: ParameterDefinitions
): Result<DataQueryParameterReference[], DomainError> =>
  safeTry(function* () {
    if (value.version !== 2 || !value.relations) return ok([]);
    const references: DataQueryParameterReference[] = [];
    for (const relation of Object.values(value.relations)) {
      references.push(...(yield* filterParameterReferences(relation.filter, parameters)));
    }
    return ok(references);
  });

const validateDefinition = (value: DataQueryDefinitionInput): Result<void, DomainError> =>
  safeTry(function* () {
    const relations = validateRelations(value);
    if (relations.isErr()) return err(relations.error);
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
      ...(yield* relationFilterParameterReferences(value, parameters)),
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
    : (page?.limit ?? 100);
  const offset = isParameterReference(page?.offset)
    ? values.get(page.offset.name)
    : (page?.offset ?? 0);
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
  return ok({
    ...('fieldId' in target ? { fieldId: target.fieldId } : { system: target.system }),
    ...('source' in target ? { source: target.source } : {}),
    order,
    ...(item.nulls ? { nulls: item.nulls } : {}),
  });
};

type LiteralSort = Exclude<DataQuerySort, { field: DataQueryParameterReference }>;

const resolveLiteralSort = (item: LiteralSort): DataQuerySortResolved => {
  const nulls = item.nulls ? { nulls: item.nulls } : {};
  if ('source' in item) {
    return 'fieldId' in item
      ? { source: item.source, fieldId: item.fieldId, order: item.order, ...nulls }
      : { source: item.source, system: item.system, order: item.order, ...nulls };
  }
  if ('fieldId' in item) return { fieldId: item.fieldId, order: item.order, ...nulls };
  if ('system' in item) return { system: item.system, order: item.order, ...nulls };
  return { alias: item.alias, order: item.order, ...nulls };
};

const bindSort = (
  sort: DataQuerySort[] | undefined,
  values: ParameterValues
): Result<DataQuerySortResolved[], DomainError> => {
  const resolved: DataQuerySortResolved[] = [];
  for (const item of sort ?? []) {
    if (!('field' in item)) {
      resolved.push(resolveLiteralSort(item));
      continue;
    }
    const parameterized = resolveParameterizedSort(item, values);
    if (parameterized.isErr()) return err(parameterized.error);
    if (parameterized.value !== undefined) resolved.push(parameterized.value);
  }
  return ok(resolved);
};

const bindRelationFilters = (
  value: DataQueryDefinitionInput,
  values: ParameterValues
): Result<Record<string, RecordFilter> | undefined, DomainError> =>
  safeTry(function* () {
    if (value.version !== 2 || !value.relations) return ok(undefined);
    const resolved: Record<string, RecordFilter> = {};
    for (const [alias, relation] of Object.entries(value.relations)) {
      const filter = yield* resolveDataQueryFilter(relation.filter, values);
      if (filter !== undefined) resolved[alias] = filter;
    }
    return ok(Object.keys(resolved).length > 0 ? resolved : undefined);
  });

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
          const relationFilters = yield* bindRelationFilters(this.value, values);
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
              relationFilters,
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
