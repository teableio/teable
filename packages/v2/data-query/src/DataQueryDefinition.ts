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
  DataQueryParameterDefinition,
  DataQueryParameterReference,
} from './types';

export const queryError = (code: string, message: string): DomainError =>
  domainError.validation({ code: `data_query.${code}`, message });

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
const fieldProjectionSchema = z.object({ fieldId: fieldIdSchema, alias: aliasSchema }).strict();
const orderSchema = z.enum(['asc', 'desc']);
const baseShape = {
  version: z.literal(1),
  tableId: tableIdSchema,
  parameters: z.record(dataQueryNameSchema, dataQueryParameterDefinitionSchema).optional(),
  filter: filterSchema.optional(),
  page: z
    .object({
      limit: z.union([z.number().int().min(1).max(1000), referenceSchema]),
      offset: z.union([z.number().int().min(0).max(2147483647), referenceSchema]).optional(),
    })
    .strict()
    .optional(),
  sort: z
    .array(
      z.union([
        z.object({ fieldId: fieldIdSchema, order: orderSchema }).strict(),
        z.object({ system: systemSchema, order: orderSchema }).strict(),
      ])
    )
    .optional(),
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
    readonly recordId?: string
  ) {
    if (token !== boundQueryToken)
      throw new Error('Bound queries must be created by definition.bind');
    freezeQueryValue(definition);
    freezeQueryValue(filter);
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

const filterParameterReferences = (
  filter: DataQueryFilter | undefined,
  parameters: ParameterDefinitions
): Result<DataQueryParameterReference[], DomainError> => {
  if (!filter) return ok([]);
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

const validateDefinition = (value: DataQueryDefinitionInput): Result<void, DomainError> =>
  safeTry(function* () {
    const parameters = value.parameters ?? {};
    yield* validateDataQueryParameterDefaults(parameters);
    const outputs =
      value.kind === 'records' ? value.select : [...(value.groupBy ?? []), ...value.aggregates];
    if (new Set(outputs.map((output) => output.alias)).size !== outputs.length) {
      return err(queryError('duplicate_alias', 'Output aliases must be unique'));
    }
    const references = [
      ...(yield* filterParameterReferences(value.filter, parameters)),
      ...(yield* pageParameterReferences(value.page, parameters)),
      ...(value.kind === 'records' && isParameterReference(value.recordId) ? [value.recordId] : []),
    ];
    if (references.some((reference) => !Object.hasOwn(parameters, reference.name))) {
      return err(queryError('unknown_parameter', 'Query references an undeclared parameter'));
    }
    yield* validateRecordIdParameter(value, parameters);
    if (
      value.kind === 'aggregate' &&
      value.sort?.some(
        (sort) =>
          !('fieldId' in sort) || !value.groupBy?.some((group) => group.fieldId === sort.fieldId)
      )
    ) {
      return err(queryError('aggregate_sort', 'Aggregate sorting must reference a grouping field'));
    }
    return ok(undefined);
  });

const assertDeclaredParameters = (
  values: Readonly<Record<string, unknown>>,
  definitions: ParameterDefinitions
): Result<void, DomainError> => {
  for (const key of Object.keys(values)) {
    if (!Object.hasOwn(definitions, key)) {
      return err(queryError('unknown_parameter', 'An undeclared parameter was provided'));
    }
  }
  return ok(undefined);
};

const bindParameterValues = (
  definitions: ParameterDefinitions,
  input: Readonly<Record<string, unknown>>
): Result<ParameterValues, DomainError> =>
  safeTry(function* () {
    if (!isParameterMap(input) || !isPlainData(input)) {
      return err(queryError('parameter_map', 'Parameters must be own-key plain data maps'));
    }
    yield* assertDeclaredParameters(input, definitions);
    const values = new Map<string, RecordFilterValue>();
    for (const [name, definition] of Object.entries(definitions)) {
      if (!Object.hasOwn(input, name) && !Object.hasOwn(definition, 'default')) {
        return err(queryError('missing_parameter', 'A required parameter is missing'));
      }
      const parsed = yield* parameterValue(
        definition,
        Object.hasOwn(input, name) ? input[name] : definition.default
      );
      values.set(name, parsed);
    }
    return ok(values);
  });

const bindPage = (
  page: DataQueryDefinitionInput['page'],
  values: ParameterValues
): Result<{ limit: number; offset: number }, DomainError> => {
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

const bindFilter = (
  filter: DataQueryFilter | undefined,
  values: ParameterValues
): Result<RecordFilter | undefined, DomainError> => {
  if (!filter) return ok(undefined);
  const parsed = recordFilterSchema.safeParse(
    mapQueryFilter(filter, (reference) => values.get(reference.name)!)
  );
  return parsed.success
    ? ok(parsed.data)
    : err(queryError('invalid_filter', 'Bound parameters are incompatible with the query filter'));
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
          const values = yield* bindParameterValues(this.value.parameters ?? {}, input);
          const { limit, offset } = yield* bindPage(this.value.page, values);
          const filter = yield* bindFilter(this.value.filter, values);
          const rawRecordId = this.value.kind === 'records' ? this.value.recordId : undefined;
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
