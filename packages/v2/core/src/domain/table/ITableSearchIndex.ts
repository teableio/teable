import type { SearchFieldTextProjection } from './fields/visitors/SearchFieldTextShape';

/** Validated physical search state, loaded with the table rather than discovered during queries. */
export interface ITableSearchIndex {
  readonly version: 1;
  readonly dbTableName: string;
  readonly generatedColumnName: string;
  readonly indexName: string;
  readonly provider: 'pg_bigm' | 'pg_trgm';
  readonly searchScope: 'all_fields' | 'selected_fields';
  readonly definitionKey: string;
  readonly indexUsable: boolean;
  readonly fields: readonly {
    readonly fieldId: string;
    readonly fieldDbName: string;
    readonly textProjection: SearchFieldTextProjection;
  }[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonemptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isTextProjection = (value: unknown): value is SearchFieldTextProjection => {
  if (!isObject(value)) return false;
  switch (value.kind) {
    case 'plain':
    case 'multiline':
    case 'plain_list':
    case 'structured_title':
    case 'structured_title_list':
      return true;
    case 'rounded_number':
    case 'rounded_number_list':
      return (
        typeof value.precision === 'number' &&
        Number.isInteger(value.precision) &&
        value.precision >= 0
      );
    default:
      return false;
  }
};

/** Legacy, unknown-version, and malformed snapshots are absent, never table-read errors. */
export const isTableSearchIndex = (value: unknown): value is ITableSearchIndex =>
  isObject(value) &&
  value.version === 1 &&
  isNonemptyString(value.dbTableName) &&
  isNonemptyString(value.generatedColumnName) &&
  isNonemptyString(value.indexName) &&
  (value.provider === 'pg_bigm' || value.provider === 'pg_trgm') &&
  (value.searchScope === 'all_fields' || value.searchScope === 'selected_fields') &&
  isNonemptyString(value.definitionKey) &&
  typeof value.indexUsable === 'boolean' &&
  Array.isArray(value.fields) &&
  (value.fields.length > 0 || value.indexUsable === false) &&
  value.fields.every(
    (field: unknown) =>
      isObject(field) &&
      isNonemptyString(field.fieldId) &&
      isNonemptyString(field.fieldDbName) &&
      isTextProjection(field.textProjection)
  );
