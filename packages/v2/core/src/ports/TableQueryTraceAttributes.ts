import type { SpanAttributes } from './Tracer';

export type TableQueryKind =
  | 'record_list'
  | 'search'
  | 'filter'
  | 'sort'
  | 'group'
  | 'aggregation'
  | 'row_count'
  | 'search_index'
  | 'search_vector_validation'
  | 'search_vector_execution';

export type TableQuerySource =
  | 'api.record_list'
  | 'v2.list_records'
  | 'repository.record_find'
  | 'repository.record_count'
  | 'admin.table_query_ops'
  | 'devtools.table_query_ops'
  | 'runtime_observation';

export type TableSearchAccessPath =
  | 'none'
  | 'default_ilike'
  | 'trigram'
  | 'generated_text_trigram'
  | 'generated_text_bigram'
  | 'generated_tsvector'
  | 'fallback';

export type TableSearchMode = 'none' | 'ilike' | 'substring' | 'trigram' | 'full_text';

export type TableSearchScope = 'none' | 'all_fields' | 'selected_fields';

export type TableQueryBucket = 'none' | 'zero' | 'one' | 'small' | 'medium' | 'large' | 'huge';

export type SearchValueLengthBucket = 'none' | 'short' | 'medium' | 'long';

export const TableQueryTraceAttributes = {
  SPACE_ID: 'teable.space_id',
  BASE_ID: 'teable.base_id',
  TABLE_ID: 'teable.table_id',
  VIEW_ID: 'teable.view_id',
  QUERY_KIND: 'teable.query.kind',
  QUERY_SOURCE: 'teable.query.source',
  QUERY_SHAPE_HASH: 'teable.query.shape_hash',
  QUERY_HAS_FILTER: 'teable.query.has_filter',
  QUERY_HAS_SORT: 'teable.query.has_sort',
  QUERY_HAS_GROUP: 'teable.query.has_group',
  QUERY_INCLUDE_TOTAL: 'teable.query.include_total',
  QUERY_RESULT_COUNT_BUCKET: 'teable.query.result_count_bucket',
  QUERY_ESTIMATED_ROWS_BUCKET: 'teable.query.estimated_rows_bucket',
  SEARCH_MODE: 'teable.search.mode',
  SEARCH_ACCESS_PATH: 'teable.search.access_path',
  SEARCH_SCOPE: 'teable.search.scope',
  SEARCH_LANGUAGE_CONFIG: 'teable.search.language_config',
  SEARCH_FALLBACK_REASON: 'teable.search.fallback_reason',
  SEARCH_VALUE_LENGTH_BUCKET: 'teable.search.value_length_bucket',
  SEARCH_FIELD_COUNT_BUCKET: 'teable.search.field_count_bucket',
  SEARCH_ALL_FIELDS: 'teable.search.all_fields',
  SEARCH_VECTOR_COLUMN: 'teable.search.vector_column',
  SEARCH_INDEX_NAME: 'teable.search.index_name',
  SEARCH_INDEX_PROVIDER: 'teable.search.index_provider',
  ERROR_KIND: 'teable.error.kind',
} as const;

const isPresent = (value: string | undefined): value is string =>
  typeof value === 'string' && value.length > 0;

export const bucketSearchValueLength = (value: string | undefined): SearchValueLengthBucket => {
  if (!value) return 'none';
  if (value.length <= 8) return 'short';
  if (value.length <= 64) return 'medium';
  return 'long';
};

export const bucketCount = (value: number | undefined): TableQueryBucket => {
  if (value == null || !Number.isFinite(value)) return 'none';
  if (value <= 0) return 'zero';
  if (value === 1) return 'one';
  if (value <= 10) return 'small';
  if (value <= 100) return 'medium';
  if (value <= 10_000) return 'large';
  return 'huge';
};

export type TableQueryTraceAttributeInput = {
  readonly spaceId?: string;
  readonly baseId?: string;
  readonly tableId?: string;
  readonly viewId?: string;
  readonly queryKind?: TableQueryKind;
  readonly querySource?: TableQuerySource;
  readonly shapeHash?: string;
  readonly hasFilter?: boolean;
  readonly hasSort?: boolean;
  readonly hasGroup?: boolean;
  readonly includeTotal?: boolean;
  readonly resultCount?: number;
  readonly estimatedRows?: number;
  readonly errorKind?: string;
};

export type SearchTraceAttributeInput = {
  readonly searchValue?: string;
  readonly fieldCount?: number;
  readonly allFields?: boolean;
  readonly searchMode?: TableSearchMode;
  readonly accessPath?: TableSearchAccessPath;
  readonly searchScope?: TableSearchScope;
  readonly languageConfig?: string;
  readonly fallbackReason?: string;
  readonly generatedColumnName?: string;
  readonly indexName?: string;
  readonly indexProvider?: 'pg_trgm' | 'pg_bigm';
};

const metricQueryKinds = new Set<string>([
  'record_list',
  'search',
  'filter',
  'sort',
  'group',
  'aggregation',
  'row_count',
  'search_index',
  'search_vector_validation',
  'search_vector_execution',
]);
const metricQuerySources = new Set<string>([
  'api.record_list',
  'v2.list_records',
  'repository.record_find',
  'repository.record_count',
  'admin.table_query_ops',
  'devtools.table_query_ops',
  'runtime_observation',
]);
const metricSearchModes = new Set<string>(['none', 'ilike', 'substring', 'trigram', 'full_text']);
const metricSearchAccessPaths = new Set<string>([
  'none',
  'default_ilike',
  'trigram',
  'generated_text_trigram',
  'generated_text_bigram',
  'generated_tsvector',
  'fallback',
]);
const metricSearchScopes = new Set<string>(['none', 'all_fields', 'selected_fields']);
const metricLanguageConfigs = new Set<string>(['simple', 'english', 'jiebacfg']);
const metricIndexProviders = new Set<string>(['pg_trgm', 'pg_bigm']);
const metricFallbackReasons = new Set<string>([
  'no_visible_row_search',
  'generated_tsvector_unavailable',
  'generated_text_unavailable',
  'generated_text_probe_too_short',
]);
const metricErrorKinds = new Set<string>([
  'timeout',
  'db_error',
  'unknown',
  'domain_error',
  'unknown_error',
  'ready_for_confirmation',
  'needs_language_config',
  'needs_plan_validation',
  'manual_investigation',
  'candidate_not_recommended',
  'no_index_change',
]);

const normalizeMetricLabel = (
  value: string | undefined,
  allowedValues: ReadonlySet<string>
): string | undefined => {
  if (!isPresent(value)) return undefined;
  return allowedValues.has(value) ? value : 'other';
};
export const createTableQueryTraceAttributes = (
  input: TableQueryTraceAttributeInput
): SpanAttributes => ({
  ...(isPresent(input.spaceId) ? { [TableQueryTraceAttributes.SPACE_ID]: input.spaceId } : {}),
  ...(isPresent(input.baseId) ? { [TableQueryTraceAttributes.BASE_ID]: input.baseId } : {}),
  ...(isPresent(input.tableId) ? { [TableQueryTraceAttributes.TABLE_ID]: input.tableId } : {}),
  ...(isPresent(input.viewId) ? { [TableQueryTraceAttributes.VIEW_ID]: input.viewId } : {}),
  ...(isPresent(input.queryKind)
    ? { [TableQueryTraceAttributes.QUERY_KIND]: input.queryKind }
    : {}),
  ...(isPresent(input.querySource)
    ? { [TableQueryTraceAttributes.QUERY_SOURCE]: input.querySource }
    : {}),
  ...(isPresent(input.shapeHash)
    ? { [TableQueryTraceAttributes.QUERY_SHAPE_HASH]: input.shapeHash }
    : {}),
  ...(input.hasFilter != null
    ? { [TableQueryTraceAttributes.QUERY_HAS_FILTER]: input.hasFilter }
    : {}),
  ...(input.hasSort != null ? { [TableQueryTraceAttributes.QUERY_HAS_SORT]: input.hasSort } : {}),
  ...(input.hasGroup != null
    ? { [TableQueryTraceAttributes.QUERY_HAS_GROUP]: input.hasGroup }
    : {}),
  ...(input.includeTotal != null
    ? { [TableQueryTraceAttributes.QUERY_INCLUDE_TOTAL]: input.includeTotal }
    : {}),
  [TableQueryTraceAttributes.QUERY_RESULT_COUNT_BUCKET]: bucketCount(input.resultCount),
  [TableQueryTraceAttributes.QUERY_ESTIMATED_ROWS_BUCKET]: bucketCount(input.estimatedRows),
  ...(isPresent(input.errorKind)
    ? { [TableQueryTraceAttributes.ERROR_KIND]: input.errorKind }
    : {}),
});

export const createSearchTraceAttributes = (input: SearchTraceAttributeInput): SpanAttributes => ({
  [TableQueryTraceAttributes.SEARCH_VALUE_LENGTH_BUCKET]: bucketSearchValueLength(
    input.searchValue
  ),
  [TableQueryTraceAttributes.SEARCH_FIELD_COUNT_BUCKET]: bucketCount(input.fieldCount),
  ...(input.allFields != null
    ? { [TableQueryTraceAttributes.SEARCH_ALL_FIELDS]: input.allFields }
    : {}),
  ...(isPresent(input.searchMode)
    ? { [TableQueryTraceAttributes.SEARCH_MODE]: input.searchMode }
    : {}),
  ...(isPresent(input.accessPath)
    ? { [TableQueryTraceAttributes.SEARCH_ACCESS_PATH]: input.accessPath }
    : {}),
  ...(isPresent(input.searchScope)
    ? { [TableQueryTraceAttributes.SEARCH_SCOPE]: input.searchScope }
    : {}),
  ...(isPresent(input.languageConfig)
    ? { [TableQueryTraceAttributes.SEARCH_LANGUAGE_CONFIG]: input.languageConfig }
    : {}),
  ...(isPresent(input.fallbackReason)
    ? { [TableQueryTraceAttributes.SEARCH_FALLBACK_REASON]: input.fallbackReason }
    : {}),
  ...(isPresent(input.generatedColumnName)
    ? { [TableQueryTraceAttributes.SEARCH_VECTOR_COLUMN]: input.generatedColumnName }
    : {}),
  ...(isPresent(input.indexName)
    ? { [TableQueryTraceAttributes.SEARCH_INDEX_NAME]: input.indexName }
    : {}),
  ...(isPresent(input.indexProvider)
    ? { [TableQueryTraceAttributes.SEARCH_INDEX_PROVIDER]: input.indexProvider }
    : {}),
});

export type TableQueryMetricAttributeInput = TableQueryTraceAttributeInput &
  SearchTraceAttributeInput & {
    readonly includeTableId?: boolean;
  };

export const createTableQueryMetricAttributes = (
  input: TableQueryMetricAttributeInput
): SpanAttributes => {
  const queryKind = normalizeMetricLabel(input.queryKind, metricQueryKinds);
  const querySource = normalizeMetricLabel(input.querySource, metricQuerySources);
  const searchMode = normalizeMetricLabel(input.searchMode, metricSearchModes);
  const accessPath = normalizeMetricLabel(input.accessPath, metricSearchAccessPaths);
  const searchScope = normalizeMetricLabel(input.searchScope, metricSearchScopes);
  const languageConfig = normalizeMetricLabel(input.languageConfig, metricLanguageConfigs);
  const indexProvider = normalizeMetricLabel(input.indexProvider, metricIndexProviders);
  const fallbackReason = normalizeMetricLabel(input.fallbackReason, metricFallbackReasons);
  const errorKind = normalizeMetricLabel(input.errorKind, metricErrorKinds);

  return {
    ...(input.includeTableId && isPresent(input.tableId)
      ? { [TableQueryTraceAttributes.TABLE_ID]: input.tableId }
      : {}),
    ...(queryKind ? { [TableQueryTraceAttributes.QUERY_KIND]: queryKind } : {}),
    ...(querySource ? { [TableQueryTraceAttributes.QUERY_SOURCE]: querySource } : {}),
    ...(searchMode ? { [TableQueryTraceAttributes.SEARCH_MODE]: searchMode } : {}),
    ...(accessPath ? { [TableQueryTraceAttributes.SEARCH_ACCESS_PATH]: accessPath } : {}),
    ...(searchScope ? { [TableQueryTraceAttributes.SEARCH_SCOPE]: searchScope } : {}),
    ...(languageConfig
      ? { [TableQueryTraceAttributes.SEARCH_LANGUAGE_CONFIG]: languageConfig }
      : {}),
    ...(indexProvider ? { [TableQueryTraceAttributes.SEARCH_INDEX_PROVIDER]: indexProvider } : {}),
    ...(fallbackReason
      ? { [TableQueryTraceAttributes.SEARCH_FALLBACK_REASON]: fallbackReason }
      : {}),
    ...(input.hasFilter != null
      ? { [TableQueryTraceAttributes.QUERY_HAS_FILTER]: input.hasFilter }
      : {}),
    ...(input.hasSort != null ? { [TableQueryTraceAttributes.QUERY_HAS_SORT]: input.hasSort } : {}),
    ...(input.hasGroup != null
      ? { [TableQueryTraceAttributes.QUERY_HAS_GROUP]: input.hasGroup }
      : {}),
    ...(input.includeTotal != null
      ? { [TableQueryTraceAttributes.QUERY_INCLUDE_TOTAL]: input.includeTotal }
      : {}),
    ...(errorKind ? { [TableQueryTraceAttributes.ERROR_KIND]: errorKind } : {}),
  };
};
