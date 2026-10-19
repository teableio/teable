import type { DomainError } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import {
  DataQueryDefinition,
  dataQueryDefinitionInputSchema,
  dataQueryNameSchema,
  dataQueryParameterDefinitionSchema,
  freezeQueryValue,
  isPlainData,
  queryError,
  validateDataQueryParameterDefaults,
} from './DataQueryDefinition';

const reservedNames: Readonly<Record<string, boolean>> = {
  ['__proto__']: true,
  prototype: true,
  constructor: true,
  then: true,
  await: true,
  break: true,
  case: true,
  catch: true,
  class: true,
  const: true,
  continue: true,
  debugger: true,
  default: true,
  delete: true,
  do: true,
  else: true,
  enum: true,
  export: true,
  extends: true,
  false: true,
  finally: true,
  for: true,
  function: true,
  if: true,
  implements: true,
  import: true,
  in: true,
  instanceof: true,
  interface: true,
  let: true,
  new: true,
  null: true,
  package: true,
  private: true,
  protected: true,
  public: true,
  return: true,
  static: true,
  super: true,
  switch: true,
  this: true,
  throw: true,
  true: true,
  try: true,
  typeof: true,
  var: true,
  void: true,
  while: true,
  with: true,
  yield: true,
};

/** Stable app-local identifiers, never an authorization credential. */
export const dataQueryIdSchema = z
  .string()
  .min(1)
  .max(128)
  // `$` also accepts a final newline; query names require the absolute end of input.
  // eslint-disable-next-line regexp/prefer-predefined-assertion
  .regex(/^[a-z_$][\w$]*(?![\s\S])/i)
  .refine((value) => !Object.hasOwn(reservedNames, value));

const fallbackOutputSchema = z
  .object({
    alias: dataQueryNameSchema,
    wireType: z.enum(['string', 'numberOrString', 'boolean', 'unknown']).optional(),
    nullable: z.boolean().optional(),
  })
  .strict();

const fallbackSchema = z
  .object({
    sql: z.string().min(1).max(200_000),
    outputs: z.array(fallbackOutputSchema).nonempty().optional(),
    parameters: z.record(dataQueryNameSchema, dataQueryParameterDefinitionSchema).optional(),
    parameterOrder: z.array(dataQueryNameSchema).optional(),
  })
  .strict();

const dataQueryManifestQuerySchema = z
  .object({
    mode: z.enum(['structured', 'auto', 'sql-query']).optional(),
    definition: dataQueryDefinitionInputSchema.optional(),
    result: z.enum(['many', 'one']).optional(),
    fallback: fallbackSchema.optional(),
  })
  .strict();
type DataQueryManifestQuery = z.infer<typeof dataQueryManifestQuerySchema>;

const addManifestIssue = (context: z.RefinementCtx, path: (string | number)[], message: string) =>
  context.addIssue({ code: 'custom', path, message });

const validateManifestMode = (
  queryId: string,
  query: DataQueryManifestQuery,
  context: z.RefinementCtx
) => {
  const mode = query.mode ?? 'structured';
  if (mode === 'structured' && !query.definition)
    addManifestIssue(
      context,
      ['queries', queryId, 'definition'],
      'Structured queries require a definition'
    );
  if (mode === 'sql-query' && query.definition)
    addManifestIssue(
      context,
      ['queries', queryId, 'definition'],
      'SQL-query mode must not include a structured definition'
    );
  if (mode === 'sql-query' && !query.fallback)
    addManifestIssue(
      context,
      ['queries', queryId, 'fallback'],
      'SQL-query mode requires a SQL fallback'
    );
  if (mode === 'auto' && !query.definition)
    addManifestIssue(
      context,
      ['queries', queryId, 'definition'],
      'Auto queries require a structured definition'
    );
  if (mode === 'auto' && !query.fallback)
    addManifestIssue(
      context,
      ['queries', queryId, 'fallback'],
      'Auto queries require a SQL fallback'
    );
};

const validateManifestDefinition = (
  queryId: string,
  query: DataQueryManifestQuery,
  context: z.RefinementCtx
) => {
  if (!query.definition) return;
  const definition = DataQueryDefinition.create(query.definition);
  if (definition.isErr())
    addManifestIssue(context, ['queries', queryId, 'definition'], definition.error.message);
};

const validateManifestFallback = (
  queryId: string,
  query: DataQueryManifestQuery,
  context: z.RefinementCtx
) => {
  const parameterDefinitions = query.definition?.parameters ?? query.fallback?.parameters;
  const parameterOrder = query.fallback?.parameterOrder ?? [];
  if (query.definition && query.fallback?.parameters)
    addManifestIssue(
      context,
      ['queries', queryId, 'fallback', 'parameters'],
      'Fallback parameters must reuse the structured definition parameters'
    );
  if (new Set(parameterOrder).size !== parameterOrder.length)
    addManifestIssue(
      context,
      ['queries', queryId, 'fallback', 'parameterOrder'],
      'Fallback parameterOrder must not contain duplicates'
    );
  for (const name of parameterOrder)
    if (!parameterDefinitions || !Object.hasOwn(parameterDefinitions, name))
      addManifestIssue(
        context,
        ['queries', queryId, 'fallback', 'parameterOrder'],
        `Fallback parameter \`${name}\` is not declared`
      );
  if (query.fallback?.parameters) {
    const defaults = validateDataQueryParameterDefaults(query.fallback.parameters);
    if (defaults.isErr())
      addManifestIssue(
        context,
        ['queries', queryId, 'fallback', 'parameters'],
        defaults.error.message
      );
  }
};

const validateManifestFallbackOutputs = (
  queryId: string,
  query: DataQueryManifestQuery,
  context: z.RefinementCtx
) => {
  const outputs = query.fallback?.outputs;
  if (!outputs) {
    if (!query.definition && query.fallback)
      addManifestIssue(
        context,
        ['queries', queryId, 'fallback', 'outputs'],
        'Legacy and auto fallback queries require output aliases'
      );
    return;
  }
  const aliases = outputs.map((output) => output.alias);
  if (new Set(aliases).size !== aliases.length)
    addManifestIssue(
      context,
      ['queries', queryId, 'fallback', 'outputs'],
      'Fallback output aliases must be unique'
    );
  if (query.definition) {
    const definitionAliases =
      query.definition.kind === 'records'
        ? query.definition.select.map((projection) => projection.alias)
        : [...(query.definition.groupBy ?? []), ...query.definition.aggregates].map(
            (projection) => projection.alias
          );
    if (
      aliases.length !== definitionAliases.length ||
      aliases.some((alias) => !definitionAliases.includes(alias))
    )
      addManifestIssue(
        context,
        ['queries', queryId, 'fallback', 'outputs'],
        'Fallback output aliases must match the structured definition'
      );
  }
};

const validateManifestResult = (
  queryId: string,
  query: DataQueryManifestQuery,
  context: z.RefinementCtx
) => {
  if (
    query.result === 'one' &&
    query.definition &&
    (query.definition.kind !== 'records' || query.definition.recordId === undefined)
  )
    addManifestIssue(
      context,
      ['queries', queryId, 'result'],
      'One-result structured queries require a records definition with recordId'
    );
};

const validateManifestQuery = (
  queryId: string,
  query: DataQueryManifestQuery,
  context: z.RefinementCtx
) => {
  validateManifestMode(queryId, query, context);
  validateManifestDefinition(queryId, query, context);
  validateManifestFallback(queryId, query, context);
  validateManifestFallbackOutputs(queryId, query, context);
  validateManifestResult(queryId, query, context);
};

export const dataQueryManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    queries: z.record(dataQueryIdSchema, dataQueryManifestQuerySchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    for (const [queryId, query] of Object.entries(manifest.queries))
      validateManifestQuery(queryId, query, context);
  });

export type DataQueryManifest = z.infer<typeof dataQueryManifestSchema>;

/** Own query ids that the plain-data guard would hide, including `__proto__`. */
const illegalQueryName = (value: unknown): string | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const queries = Object.getOwnPropertyDescriptor(value, 'queries')?.value;
  if (queries === null || typeof queries !== 'object' || Array.isArray(queries)) return undefined;
  for (const key of Reflect.ownKeys(queries)) {
    if (typeof key === 'string' && !dataQueryIdSchema.safeParse(key).success) return key;
  }
  return undefined;
};

export const dataQueryManifestJsonSchema = () =>
  z.toJSONSchema(dataQueryManifestSchema, { target: 'draft-2020-12', io: 'input' });

export const parseDataQueryManifest = (value: unknown): Result<DataQueryManifest, DomainError> => {
  try {
    const illegalName = illegalQueryName(value);
    if (illegalName) {
      return err(
        queryError('invalid_manifest', `queries.${illegalName}: query name is not allowed`)
      );
    }
    if (!isPlainData(value))
      return err(queryError('invalid_manifest', 'Manifest must contain plain data'));
    const parsed = dataQueryManifestSchema.safeParse(value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err(
        queryError('invalid_manifest', `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
      );
    }
    return ok(freezeQueryValue(parsed.data));
  } catch {
    return err(queryError('invalid_manifest', 'Invalid query manifest'));
  }
};
