import type { DomainError } from '@teable/v2-core';
import { recordFilterDateModeSchema, TIME_ZONE_LIST } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';
import { isAlias, isMap, isScalar, isSeq, parseDocument, type YAMLMap } from 'yaml';
import { z } from 'zod';

import { dataQueryOptionalParameters, queryError } from './DataQueryDefinition';
import {
  dataQueryIdSchema,
  dataQueryManifestJsonSchema,
  parseDataQueryManifest,
  type DataQueryManifest,
} from './DataQueryManifest';
import type { DataQueryParameterDefinition, DataQueryOutput } from './types';

export type AppQueryDescriptions = Readonly<
  Record<string, { outputs: ReadonlyArray<DataQueryOutput> }>
>;

const inspectYamlMap = (node: YAMLMap, path: string, depth: number): string | undefined => {
  for (const pair of node.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string')
      return `${path}: mapping keys must be strings`;
    const invalid = inspectYamlNode(pair.value, `${path}.${pair.key.value}`, depth + 1);
    if (invalid) return invalid;
  }
  return undefined;
};

const inspectYamlMetadata = (node: unknown, path: string, depth: number): string | undefined => {
  if (depth > 100) return `${path}: manifest nesting exceeds 100 levels`;
  if (isAlias(node)) return `${path}: YAML aliases are not supported`;
  if (isScalar(node) || isMap(node) || isSeq(node)) {
    if (node.tag && !node.tag.startsWith('tag:yaml.org,2002:'))
      return `${path}: custom YAML tags are not supported`;
    if (node.anchor) return `${path}: YAML anchors are not supported`;
  }
  return undefined;
};

const inspectYamlNode = (node: unknown, path: string, depth: number): string | undefined => {
  const metadataError = inspectYamlMetadata(node, path, depth);
  if (metadataError) return metadataError;
  if (isMap(node)) return inspectYamlMap(node, path, depth);
  if (isSeq(node)) {
    for (let index = 0; index < node.items.length; index++) {
      const invalid = inspectYamlNode(node.items[index], `${path}[${index}]`, depth + 1);
      if (invalid) return invalid;
    }
  }
  return undefined;
};
/** YAML `__proto__` is not an own key after toJS, so name it before conversion. */
const illegalYamlQueryName = (node: unknown): string | undefined => {
  if (!isMap(node)) return undefined;
  const queries = node.items.find(
    (pair) => isScalar(pair.key) && pair.key.value === 'queries' && isMap(pair.value)
  )?.value;
  if (!isMap(queries)) return undefined;
  for (const pair of queries.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string') continue;
    if (!dataQueryIdSchema.safeParse(pair.key.value).success) return pair.key.value;
  }
  return undefined;
};

/** Parse YAML 1.2 (including JSON) without resolving aliases or accepting custom tags. */
export function parseDataQueryManifestText(text: string): Result<DataQueryManifest, DomainError> {
  try {
    const document = parseDocument(text, {
      version: '1.2',
      uniqueKeys: true,
      strict: true,
      prettyErrors: false,
    });
    const issue = document.errors[0] ?? document.warnings[0];
    if (issue) {
      const offset = issue.pos[0];
      const prefix = text.slice(0, offset);
      const line = prefix.split('\n').length;
      const column = offset - prefix.lastIndexOf('\n');
      return err(
        queryError('manifest_yaml', `Manifest at line ${line}, column ${column}: ${issue.code}`)
      );
    }
    const invalid = inspectYamlNode(document.contents, '$', 0);
    if (invalid) return err(queryError('manifest_yaml', invalid));
    const illegalName = illegalYamlQueryName(document.contents);
    if (illegalName) {
      return err(
        queryError('invalid_manifest', `queries.${illegalName}: query name is not allowed`)
      );
    }
    return parseDataQueryManifest(document.toJS({ maxAliasCount: 0 }));
  } catch {
    return err(queryError('manifest_yaml', 'Manifest must be valid YAML 1.2 or JSON'));
  }
}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([key, child]) => [key, stableValue(child)])
    );
  }
  return value;
};
const json = (value: unknown): string => JSON.stringify(stableValue(value), null, 2);
const outputType = (output: DataQueryOutput): string => {
  if (output.wireType === 'unknown') return 'unknown';
  const primitive: Record<Exclude<DataQueryOutput['wireType'], 'unknown'>, string> = {
    string: 'string',
    numberOrString: 'number | string',
    boolean: 'boolean',
  };
  const type = primitive[output.wireType];
  return `${output.isMultipleCellValue ? `Array<${type}>` : type}${output.nullable ? ' | null' : ''}`;
};
type FallbackOutput = {
  alias: string;
  wireType?: DataQueryOutput['wireType'];
  nullable?: boolean;
};

const fallbackOutputType = (output: FallbackOutput): string => {
  const primitive: Record<DataQueryOutput['wireType'], string> = {
    string: 'string',
    numberOrString: 'number | string',
    boolean: 'boolean',
    unknown: 'unknown',
  };
  return `${primitive[output.wireType ?? 'unknown']}${output.nullable ? ' | null' : ''}`;
};

/**
 * Offline system-field types. A joined source is left-joined, so every target system value
 * can be null; root system values keep their stored nullability.
 */
const offlineSystemType = (system: string, joined: boolean): string => {
  const type = ['autoNumber', 'version'].includes(system) ? 'number | string' : 'string';
  return joined || system === 'lastModifiedTime' ? `${type} | null` : type;
};

/** Pure, deterministic generator. Live descriptions refine otherwise unknown field values. */
// eslint-disable-next-line sonarjs/cognitive-complexity
export function generateAppQueryArtifacts(
  input: DataQueryManifest,
  descriptions?: AppQueryDescriptions
): Result<{ module: string; schema: string }, DomainError> {
  const parsed = parseDataQueryManifest(input);
  if (parsed.isErr()) return err(parsed.error);
  const manifest = parsed.value;
  const ids = Object.keys(manifest.queries).sort();
  const rows: string[] = [];
  const parameters: string[] = [];
  const functions: string[] = [];
  const usesPage = Object.values(manifest.queries).some(
    (query) => query.definition?.page?.includeTotal === true
  );
  for (const id of ids) {
    const query = manifest.queries[id];
    const definition = query.definition;
    const aliases = definition
      ? definition.kind === 'records'
        ? definition.select.map((projection) => projection.alias)
        : [...(definition.groupBy ?? []), ...definition.aggregates].map(
            (projection) => projection.alias
          )
      : [];
    const outputs = descriptions?.[id]?.outputs;
    if (
      outputs &&
      (outputs.length !== aliases.length ||
        new Set(outputs.map((output) => output.alias)).size !== aliases.length ||
        outputs.some((output) => !aliases.includes(output.alias)))
    ) {
      return err(
        queryError(
          'manifest_outputs',
          `queries.${id}: live output aliases do not match the definition`
        )
      );
    }
    const fallbackOutputs = (query.fallback?.outputs ?? []) as FallbackOutput[];
    const properties = definition
      ? aliases.map((alias) => {
          const output = outputs?.find((candidate) => candidate.alias === alias);
          const projection =
            definition.kind === 'records'
              ? definition.select.find((item) => item.alias === alias)
              : undefined;
          const joined =
            projection !== undefined &&
            'source' in projection &&
            projection.source !== undefined &&
            projection.source !== 'root';
          const systemType =
            projection && 'system' in projection
              ? offlineSystemType(projection.system, joined)
              : 'unknown';
          return `    ${JSON.stringify(alias)}: ${output ? outputType(output) : systemType};`;
        })
      : fallbackOutputs.length
        ? fallbackOutputs.map(
            (output) => `    ${JSON.stringify(output.alias)}: ${fallbackOutputType(output)};`
          )
        : ['    [key: string]: unknown;'];
    rows.push(`  ${JSON.stringify(id)}: {\n${properties.join('\n')}\n  };`);
    const parameterDefinitions = (definition?.parameters ??
      query.fallback?.parameters ??
      {}) as Record<string, DataQueryParameterDefinition>;
    const parameterEntries = Object.entries(parameterDefinitions).sort(([a], [b]) =>
      a.localeCompare(b, 'en')
    );
    const optionalParameters = definition
      ? dataQueryOptionalParameters(definition)
      : new Set<string>();
    const isOptionalParameter = (name: string, parameter: DataQueryParameterDefinition) =>
      parameter.default !== undefined || optionalParameters.has(name);
    parameters.push(
      `  ${JSON.stringify(id)}: {\n${parameterEntries
        .map(
          ([name, parameter]) =>
            `    ${JSON.stringify(name)}${
              isOptionalParameter(name, parameter) ? '?' : ''
            }: ${parameter.type === 'date' ? 'QueryDate' : parameter.type}${
              parameter.nullable ? ' | null' : ''
            };`
        )
        .join('\n')}\n  };`
    );
    const optional = parameterEntries.every(([name, parameter]) =>
      isOptionalParameter(name, parameter)
    );
    const withPage = definition?.page?.includeTotal === true;
    // Existing queries must keep byte-identical generated modules: only opted-in totals
    // change the call shape, so already-generated clients still pass the save gate.
    const returnType = withPage
      ? `QueryPageResult<QueryRows[${JSON.stringify(id)}]>`
      : query.result === 'one'
        ? `QueryRows[${JSON.stringify(id)}] | null`
        : `Array<QueryRows[${JSON.stringify(id)}]>`;
    const signature = `  ${JSON.stringify(id)}: (parameters: QueryParameters[${JSON.stringify(
      id
    )}]${optional ? ' = {}' : ''}): Promise<${returnType}>`;
    functions.push(
      withPage
        ? `${signature} => execute(${JSON.stringify(
            id
          )}, parameters, false, true) as unknown as Promise<${returnType}>,`
        : `${signature} => execute(${JSON.stringify(id)}, parameters, ${query.result === 'one'})${
            usesPage ? ` as unknown as Promise<${returnType}>` : ''
          },`
    );
  }
  const definitions = Object.fromEntries(
    ids.map((id) => [id, manifest.queries[id].definition ?? null])
  );
  const fallbacks = Object.fromEntries(
    ids.map((id) => {
      const query = manifest.queries[id];
      const fallback = query.fallback;
      const mode = query.mode ?? (query.definition ? 'structured' : 'sql-query');
      const parameterDefinitions = query.definition?.parameters ?? fallback?.parameters ?? {};
      const outputs =
        fallback?.outputs?.map((output) => ({
          alias: output.alias,
          wireType: output.wireType ?? 'unknown',
          nullable: output.nullable ?? false,
        })) ??
        (query.definition
          ? query.definition.kind === 'records'
            ? query.definition.select.map((projection) => ({
                alias: projection.alias,
                wireType: 'unknown',
                nullable: true,
              }))
            : [...(query.definition.groupBy ?? []), ...query.definition.aggregates].map(
                (projection) => ({ alias: projection.alias, wireType: 'unknown', nullable: true })
              )
          : []);
      return [
        id,
        fallback
          ? {
              sql: fallback.sql,
              outputs,
              parameterOrder: fallback.parameterOrder ?? [],
              parameters: parameterDefinitions,
              plannedMode: mode === 'sql-query' ? 'sql-query' : 'structured',
              isFallback: mode !== 'sql-query',
            }
          : null,
      ];
    })
  );
  const hasDateParameters = Object.values(manifest.queries).some(
    (query) =>
      query.fallback &&
      Object.values(query.definition?.parameters ?? query.fallback.parameters ?? {}).some(
        (parameter) => parameter.type === 'date'
      )
  );
  const module = `// Generated from teable/queries.yaml. Do not edit.
import 'server-only';
import { getConfig, request } from './request';

export type QueryId = ${ids.length ? ids.map((id) => JSON.stringify(id)).join(' | ') : 'never'};
export type QueryDate = {
  mode: ${recordFilterDateModeSchema.options.map((mode) => JSON.stringify(mode)).join(' | ')};
  timeZone: string;
  numberOfDays?: number;
  exactDate?: string;
  exactDateEnd?: string;
};
export type QueryParameters = {
${parameters.join('\n')}
};
export type QueryRows = {
${rows.join('\n')}
};
${
  usesPage
    ? `export type QueryPage = { limit: number; offset: number; total: number };
export type QueryPageResult<Row> = { rows: Array<Row>; page: QueryPage };
const isQueryPage = (value: unknown): value is QueryPage =>
  isObject(value) && typeof value.limit === 'number' && typeof value.offset === 'number' &&
  typeof value.total === 'number';
`
    : ''
}const definitions = ${json(definitions)};
const fallbacks = ${json(fallbacks)};

export class QueryError extends Error {
  constructor(public readonly code: string, public readonly queryId: QueryId) {
    super(\`Query \${queryId} failed (\${code})\`);
    this.name = 'QueryError';
  }
}
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const canFallback = (code: string): boolean => code.startsWith('data_query.unsupported_');

type SqlParameter = {
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'date';
  nullable?: boolean;
  default?: unknown;
};
const isParameterMap = (value: unknown): value is Record<string, unknown> =>
  isObject(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const isPlainParameterData = (value: unknown, ancestors = new WeakSet<object>()): boolean => {
  if (value === null || typeof value !== 'object') return typeof value !== 'function' && typeof value !== 'symbol';
  if (ancestors.has(value) || (!Array.isArray(value) && !isParameterMap(value))) return false;
  ancestors.add(value);
  const valid = Reflect.ownKeys(value).every((key) => {
    if (Array.isArray(value) && key === 'length') return true;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key) &&
      descriptor.enumerable === true && 'value' in descriptor && isPlainParameterData(descriptor.value, ancestors);
  });
  ancestors.delete(value);
  return valid;
};
${
  hasDateParameters
    ? `const queryDateModes: Record<string, true> = ${JSON.stringify(Object.fromEntries(recordFilterDateModeSchema.options.map((mode) => [mode, true])))};
const queryTimeZones: Record<string, true> = ${JSON.stringify(Object.fromEntries(TIME_ZONE_LIST.map((zone) => [zone, true])))};
const queryDateTimePattern = ${z.regexes.datetime({ offset: true })};
const isQueryDate = (value: unknown): boolean => {
  if (!isParameterMap(value) || Object.keys(value).some((key) => !['mode', 'timeZone', 'numberOfDays', 'exactDate', 'exactDateEnd'].includes(key))) return false;
  const { mode, timeZone, numberOfDays, exactDate, exactDateEnd } = value;
  if (typeof mode !== 'string' || !Object.hasOwn(queryDateModes, mode) || typeof timeZone !== 'string' || !Object.hasOwn(queryTimeZones, timeZone.toUpperCase() === 'UTC' ? 'utc' : timeZone)) return false;
  if (numberOfDays !== undefined && (typeof numberOfDays !== 'number' || !Number.isSafeInteger(numberOfDays) || numberOfDays < 0)) return false;
  if ([exactDate, exactDateEnd].some((date) => date !== undefined && (typeof date !== 'string' || !queryDateTimePattern.test(date)))) return false;
  if (['exactDate', 'exactDateTime', 'exactFormatDate'].includes(mode) && exactDate === undefined) return false;
  if (['daysAgo', 'daysFromNow', 'pastNumberOfDays', 'nextNumberOfDays'].includes(mode) && numberOfDays === undefined) return false;
  return mode !== 'dateRange' || (typeof exactDate === 'string' && typeof exactDateEnd === 'string' && Date.parse(exactDate) <= Date.parse(exactDateEnd));
};`
    : ''
}
const isSqlParameterValue = (type: SqlParameter['type'], value: unknown): boolean => {
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string' || type === 'boolean') return typeof value === type;
  if (type === 'date') return ${hasDateParameters ? 'isQueryDate(value)' : 'false'};
  if (!Array.isArray(value) || value.length === 0) return false;
  const itemType = type.slice(0, -2) as 'string' | 'number' | 'boolean';
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index) || !isSqlParameterValue(itemType, value[index])) return false;
  }
  return true;
};
function bindSqlParameters(queryId: QueryId, definitions: Record<string, SqlParameter>, parameters: unknown): Map<string, unknown> {
  if (!isParameterMap(parameters) || !isPlainParameterData(parameters)) throw new QueryError('data_query.parameter_map', queryId);
  if (Object.keys(parameters).some((name) => !Object.hasOwn(definitions, name))) throw new QueryError('data_query.unknown_parameter', queryId);
  const values = new Map<string, unknown>();
  for (const [name, definition] of Object.entries(definitions)) {
    if (!Object.hasOwn(parameters, name) && !Object.hasOwn(definition, 'default')) throw new QueryError('data_query.missing_parameter', queryId);
    const value = Object.hasOwn(parameters, name) ? parameters[name] : definition.default;
    if (value === null ? !definition.nullable : !isSqlParameterValue(definition.type, value)) throw new QueryError('data_query.parameter_type', queryId);
    values.set(name, value);
  }
  return values;
}

async function executeLegacy<K extends QueryId, One extends boolean>(
  queryId: K,
  parameters: QueryParameters[K],
  one: One,
  reason: string
): Promise<One extends true ? QueryRows[K] | null : Array<QueryRows[K]>> {
  const fallback = fallbacks[queryId] as {
    sql: string;
    outputs: Array<{ alias: string; wireType: 'string' | 'numberOrString' | 'boolean' | 'unknown'; nullable: boolean }>;
    parameterOrder: string[];
    parameters: Record<string, SqlParameter>;
    plannedMode: 'structured' | 'sql-query';
    isFallback: boolean;
  } | null;
  if (!fallback) throw new QueryError('data_query.fallback_unconfigured', queryId);
  const boundParameters = bindSqlParameters(queryId, fallback.parameters, parameters);
  const values = fallback.parameterOrder.map((name) => boundParameters.get(name));
  let response: unknown;
  try {
    const { baseId } = getConfig();
    if (!baseId) throw new Error('TEABLE_BASE_ID is not configured');
    response = await request<unknown>(\`/base/\${encodeURIComponent(baseId)}/sql-query\`, {
      method: 'POST',
      acceptErrorResponse: true,
      headers: {
        'x-teable-query-id': queryId,
        'x-teable-query-planned-mode': fallback.plannedMode,
        'x-teable-query-selected-mode': 'sql-query',
        'x-teable-query-fallback': fallback.isFallback ? 'true' : 'false',
        'x-teable-query-fallback-reason': fallback.isFallback ? reason : 'sql_query_by_design',
      },
      body: { sql: fallback.sql, ...(values.length ? { parameters: values } : {}) },
    });
  } catch {
    throw new QueryError('data_query.sql_query_transport_failed', queryId);
  }
  if (!isObject(response) || !Array.isArray(response.rows) || !response.rows.every(isObject)) {
    throw new QueryError('data_query.sql_query_invalid_response', queryId);
  }
  const rows = response.rows;
  const invalidOutput = fallback.outputs.find((output) =>
    rows.some((row) => {
      if (!Object.hasOwn(row, output.alias)) return true;
      const value = row[output.alias];
      if (value == null) return !output.nullable;
      if (output.wireType === 'string') return typeof value !== 'string';
      if (output.wireType === 'numberOrString') return typeof value !== 'number' && typeof value !== 'string';
      if (output.wireType === 'boolean') return typeof value !== 'boolean';
      return false;
    })
  );
  if (invalidOutput) throw new QueryError('data_query.sql_query_output_mismatch', queryId);
  const projectedRows = rows.map((row) =>
    Object.fromEntries(fallback.outputs.map((output) => [output.alias, row[output.alias]]))
  );
  if (one && projectedRows.length > 1) throw new QueryError('data_query.cardinality', queryId);
  return (one ? projectedRows[0] ?? null : projectedRows) as One extends true ? QueryRows[K] | null : Array<QueryRows[K]>;
}

${
  usesPage
    ? `async function execute<K extends QueryId>(
  queryId: K, parameters: QueryParameters[K], one: boolean, withPage = false
): Promise<QueryRows[K] | Array<QueryRows[K]> | QueryPageResult<QueryRows[K]> | null> {
  const queryFallback = fallbacks[queryId] as { isFallback: boolean } | null;
  if (definitions[queryId] === null) {
    // The SQL fallback cannot produce a same-scope total, so never fake one.
    if (withPage) throw new QueryError('data_query.unsupported_include_total', queryId);
    return executeLegacy(
      queryId,
      parameters,
      one,
      queryFallback?.isFallback ? 'unsupported_definition' : 'sql_query_by_design'
    );
  }
  let response: unknown;
  try {
    response = await request<unknown>('/v2/queries/execute', {
      method: 'POST', acceptErrorResponse: true,
      body: { queryId, definition: definitions[queryId], parameters },
    });
  } catch {
    throw new QueryError('data_query.transport_failed', queryId);
  }
  if (!isObject(response)) throw new QueryError('data_query.invalid_response', queryId);
  if (response.ok === false && isObject(response.error) && typeof response.error.code === 'string') {
    if (canFallback(response.error.code) && queryFallback && !withPage)
      return executeLegacy(queryId, parameters, one, response.error.code);
    throw new QueryError(response.error.code, queryId);
  }
  if (response.ok !== true || !isObject(response.data) || !Array.isArray(response.data.rows) || !response.data.rows.every(isObject)) {
    throw new QueryError('data_query.invalid_response', queryId);
  }
  const rows = response.data.rows;
  if (one && rows.length > 1) throw new QueryError('data_query.cardinality', queryId);
  if (withPage) {
    if (!isQueryPage(response.data.page)) throw new QueryError('data_query.invalid_response', queryId);
    return { rows, page: response.data.page } as QueryPageResult<QueryRows[K]>;
  }
  return (one ? rows[0] ?? null : rows) as QueryRows[K] | Array<QueryRows[K]>;
}
`
    : `async function execute<K extends QueryId, One extends boolean>(
  queryId: K, parameters: QueryParameters[K], one: One
): Promise<One extends true ? QueryRows[K] | null : Array<QueryRows[K]>> {
  const queryFallback = fallbacks[queryId] as { isFallback: boolean } | null;
  if (definitions[queryId] === null)
    return executeLegacy(
      queryId,
      parameters,
      one,
      queryFallback?.isFallback ? 'unsupported_definition' : 'sql_query_by_design'
    );
  let response: unknown;
  try {
    response = await request<unknown>('/v2/queries/execute', {
      method: 'POST', acceptErrorResponse: true,
      body: { queryId, definition: definitions[queryId], parameters },
    });
  } catch {
    throw new QueryError('data_query.transport_failed', queryId);
  }
  if (!isObject(response)) throw new QueryError('data_query.invalid_response', queryId);
  if (response.ok === false && isObject(response.error) && typeof response.error.code === 'string') {
    if (canFallback(response.error.code) && queryFallback)
      return executeLegacy(queryId, parameters, one, response.error.code);
    throw new QueryError(response.error.code, queryId);
  }
  if (response.ok !== true || !isObject(response.data) || !Array.isArray(response.data.rows) || !response.data.rows.every(isObject)) {
    throw new QueryError('data_query.invalid_response', queryId);
  }
  const rows = response.data.rows;
  if (one && rows.length > 1) throw new QueryError('data_query.cardinality', queryId);
  return (one ? rows[0] ?? null : rows) as One extends true ? QueryRows[K] | null : Array<QueryRows[K]>;
}
`
}
export const queries = {
${functions.join('\n')}
};
`;
  return ok({ module, schema: `${json(dataQueryManifestJsonSchema())}\n` });
}
