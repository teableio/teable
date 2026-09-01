/**
 * Naming contract for the managed search-document objects the query-ops
 * adapters create on user tables. This is the single source for these
 * prefixes: the executor refuses to ADD/DROP anything outside them, the
 * record-repository schema visitor drops matching columns before column DDL,
 * and devtools recognizes them during validation. Keep every consumer on
 * these exports instead of re-declaring the literals.
 *
 * Lives in the side-effect-free shared postgres package on purpose: importing
 * @teable/v2-table-query-ops registers its schema-maintenance projection into
 * the global event registry, which breaks containers that never call
 * registerV2TableOps.
 */
export const MANAGED_SEARCH_DOCUMENT_COLUMN_PREFIX = '__tqops_search_';
export const MANAGED_SEARCH_INDEX_PREFIX = 'idx_tqops_search_';
export const MANAGED_SCOPED_SEARCH_INDEX_PREFIX = 'idx_tqops_search_scope_';
export const LEGACY_MANAGED_SEARCH_DOCUMENT_COLUMN_PREFIX = '__tqops_tsv_';
export const LEGACY_MANAGED_SEARCH_INDEX_PREFIX = 'idx_tqops_tsv_';

export const managedSearchDocumentColumnPrefixes = [
  MANAGED_SEARCH_DOCUMENT_COLUMN_PREFIX,
  LEGACY_MANAGED_SEARCH_DOCUMENT_COLUMN_PREFIX,
] as const;

export const isManagedSearchDocumentColumnName = (columnName: string): boolean =>
  managedSearchDocumentColumnPrefixes.some((prefix) => columnName.startsWith(prefix));

export const isManagedSearchIndexName = (indexName: string): boolean =>
  indexName.startsWith(MANAGED_SEARCH_INDEX_PREFIX) ||
  indexName.startsWith(LEGACY_MANAGED_SEARCH_INDEX_PREFIX);

/** SQL LIKE pattern (backslash escape) matching a managed prefix. */
export const managedSearchPrefixLikePattern = (prefix: string): string =>
  `${prefix.replace(/_/g, '\\_')}%`;
