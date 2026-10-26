import { collectDataQuerySourceFieldUsages, sortDataQueryFieldUsages } from './DataQueryFieldUsage';
import type { DataQueryManifest } from './DataQueryManifest';
import type { DataQueryFieldUsage } from './types';

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export type DataQueryManifestQueryFieldDependency = {
  readonly fieldId: string;
  readonly usages: ReadonlyArray<DataQueryFieldUsage>;
};

export type DataQueryManifestQueryRelationDependency = {
  readonly alias: string;
  readonly tableId: string;
  readonly fields: ReadonlyArray<DataQueryManifestQueryFieldDependency>;
};

export type DataQueryManifestQueryDependency = {
  readonly queryId: string;
  readonly mode: 'structured' | 'auto' | 'sql-query';
  readonly result: 'many' | 'one';
  /**
   * `null` for `mode: sql-query`, whose table is only named inside SQL text this
   * index deliberately does not parse.
   */
  readonly tableId: string | null;
  readonly fields: ReadonlyArray<DataQueryManifestQueryFieldDependency>;
  /** Declared v2 targets; root fields remain in `fields`. */
  readonly relations?: ReadonlyArray<DataQueryManifestQueryRelationDependency>;
  /**
   * Every field this query *declares* is listed. False when a SQL path can run:
   * `mode: sql-query` has no structured definition, and a query that declares a
   * `fallback` keeps that SQL reachable for `data_query.unsupported_*` failures
   * even in `structured`/default mode. Never read `fields: []` as "this query
   * reads nothing" without this flag.
   */
  readonly complete: boolean;
  /**
   * `complete` speaks only about direct, declared references. A computed field
   * (formula, lookup, rollup) reads further fields transitively, and this
   * offline index never expands those internals, so the transitive set stays
   * unknown for every query.
   */
  readonly transitiveDependencies: 'not-expanded';
};

export type DataQueryManifestTableDependency = {
  readonly tableId: string;
  readonly queryIds: ReadonlyArray<string>;
  readonly fields: ReadonlyArray<
    DataQueryManifestQueryFieldDependency & { readonly queryIds: ReadonlyArray<string> }
  >;
};

export type DataQueryManifestDependencyIndex = {
  readonly queries: ReadonlyArray<DataQueryManifestQueryDependency>;
  readonly tables: ReadonlyArray<DataQueryManifestTableDependency>;
  /** Query ids whose complete field set is not declared offline. */
  readonly incompleteQueryIds: ReadonlyArray<string>;
  readonly summary: {
    readonly queryCount: number;
    readonly structuredCount: number;
    readonly autoCount: number;
    readonly sqlQueryCount: number;
    readonly fieldCount: number;
  };
};

const queryDependency = (
  queryId: string,
  query: DataQueryManifest['queries'][string]
): DataQueryManifestQueryDependency => {
  const mode = query.mode ?? 'structured';
  const definition = query.definition;
  const result = query.result ?? 'many';
  const sourceUsages = definition
    ? collectDataQuerySourceFieldUsages(definition)
    : new Map<string, Map<string, Set<DataQueryFieldUsage>>>();
  const fieldsFrom = (source: string): DataQueryManifestQueryFieldDependency[] =>
    [...(sourceUsages.get(source) ?? [])]
      .map(([fieldId, usages]) => ({ fieldId, usages: sortDataQueryFieldUsages(usages) }))
      .sort((left, right) => compareText(left.fieldId, right.fieldId));
  const fields = fieldsFrom('root');
  const relations =
    definition?.version === 2
      ? Object.entries(definition.relations ?? {}).map(([alias, relation]) => ({
          alias,
          tableId: relation.tableId,
          fields: fieldsFrom(alias),
        }))
      : undefined;
  return {
    queryId,
    mode,
    result,
    tableId: definition?.tableId ?? null,
    fields,
    ...(relations?.length ? { relations } : {}),
    // The generated client runs a declared fallback for any reachable
    // `data_query.unsupported_*` failure, whatever the mode says, and that SQL
    // can read columns this index cannot see. Only a query with no fallback has
    // a fully declared field set offline.
    complete: definition !== undefined && query.fallback === undefined,
    transitiveDependencies: 'not-expanded',
  };
};

type MutableTableDependency = {
  queryIds: Set<string>;
  fields: Map<string, { usages: Set<DataQueryFieldUsage>; queryIds: Set<string> }>;
};

const buildTableIndex = (
  queries: ReadonlyArray<DataQueryManifestQueryDependency>
): DataQueryManifestTableDependency[] => {
  const tables = new Map<string, MutableTableDependency>();
  const addTable = (
    tableId: string,
    fields: ReadonlyArray<DataQueryManifestQueryFieldDependency>,
    queryId: string
  ): void => {
    const table = tables.get(tableId) ?? { queryIds: new Set(), fields: new Map() };
    table.queryIds.add(queryId);
    for (const field of fields) {
      const entry = table.fields.get(field.fieldId) ?? {
        usages: new Set<DataQueryFieldUsage>(),
        queryIds: new Set<string>(),
      };
      for (const usage of field.usages) entry.usages.add(usage);
      entry.queryIds.add(queryId);
      table.fields.set(field.fieldId, entry);
    }
    tables.set(tableId, table);
  };
  for (const query of queries) {
    if (query.tableId === null) continue;
    addTable(query.tableId, query.fields, query.queryId);
    for (const relation of query.relations ?? []) {
      addTable(relation.tableId, relation.fields, query.queryId);
    }
  }

  return [...tables.entries()]
    .map(([tableId, table]) => ({
      tableId,
      queryIds: [...table.queryIds].sort(compareText),
      fields: [...table.fields.entries()]
        .map(([fieldId, entry]) => ({
          fieldId,
          usages: sortDataQueryFieldUsages(entry.usages),
          queryIds: [...entry.queryIds].sort(compareText),
        }))
        .sort((left, right) => compareText(left.fieldId, right.fieldId)),
    }))
    .sort((left, right) => compareText(left.tableId, right.tableId));
};

const countModes = (
  queries: ReadonlyArray<DataQueryManifestQueryDependency>,
  mode: DataQueryManifestQueryDependency['mode']
): number => queries.filter((query) => query.mode === mode).length;

/**
 * Offline, field-level dependency index over one App query manifest.
 *
 * It is a pure function of the manifest text: no schema, permission or host
 * lookup is involved. Callers must consult `complete` before treating the
 * result as an exhaustive list of what an App reads.
 */
export const collectDataQueryManifestDependencies = (
  manifest: DataQueryManifest
): DataQueryManifestDependencyIndex => {
  const queries = Object.entries(manifest.queries)
    .map(([queryId, query]) => queryDependency(queryId, query))
    .sort((left, right) => compareText(left.queryId, right.queryId));
  const tables = buildTableIndex(queries);

  return {
    queries,
    tables,
    incompleteQueryIds: queries.filter((query) => !query.complete).map((query) => query.queryId),
    summary: {
      queryCount: queries.length,
      structuredCount: countModes(queries, 'structured'),
      autoCount: countModes(queries, 'auto'),
      sqlQueryCount: countModes(queries, 'sql-query'),
      fieldCount: tables.reduce((count, table) => count + table.fields.length, 0),
    },
  };
};
