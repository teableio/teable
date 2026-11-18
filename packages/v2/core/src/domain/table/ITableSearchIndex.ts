import type { SearchFieldTextProjection } from './fields/visitors/SearchFieldTextShape';

export interface ITableSearchField {
  readonly fieldId: string;
  readonly fieldDbName: string;
  readonly textProjection: SearchFieldTextProjection;
}

export interface ITableSearchBranch {
  readonly provider: 'pg_bigm' | 'pg_trgm';
  readonly indexName: string;
  readonly ready: boolean;
  readonly fields: readonly ITableSearchField[];
}

/** Validated serving generation. Either physical branch can serve independently. */
export interface ITableSearchIndex {
  readonly version: 2;
  readonly dbTableName: string;
  readonly searchScope: 'all_fields' | 'selected_fields';
  readonly definitionKey: string;
  readonly fieldIds: readonly string[];
  readonly document?: ITableSearchBranch & { readonly generatedColumnName: string };
  readonly residual?: ITableSearchBranch & {
    /** Canonical unqualified immutable SQL, including helper version and member order. */
    readonly expression: string;
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isProjection = (value: unknown): value is SearchFieldTextProjection => {
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
        value.precision >= 0 &&
        value.precision <= 20
      );
    default:
      return false;
  }
};
const isFields = (value: unknown): value is readonly ITableSearchField[] =>
  Array.isArray(value) &&
  value.every(
    (field) =>
      isObject(field) &&
      isString(field.fieldId) &&
      isString(field.fieldDbName) &&
      isProjection(field.textProjection)
  );
const isBranch = (value: unknown): value is ITableSearchBranch =>
  isObject(value) &&
  (value.provider === 'pg_bigm' || value.provider === 'pg_trgm') &&
  isString(value.indexName) &&
  typeof value.ready === 'boolean' &&
  isFields(value.fields) &&
  (!value.ready || value.fields.length > 0);

export const isTableSearchIndex = (value: unknown): value is ITableSearchIndex =>
  isObject(value) &&
  value.version === 2 &&
  isString(value.dbTableName) &&
  (value.searchScope === 'all_fields' || value.searchScope === 'selected_fields') &&
  isString(value.definitionKey) &&
  Array.isArray(value.fieldIds) &&
  value.fieldIds.every(isString) &&
  (value.document === undefined ||
    (isBranch(value.document) &&
      isObject(value.document) &&
      isString(value.document.generatedColumnName))) &&
  (value.residual === undefined ||
    (isBranch(value.residual) && isObject(value.residual) && isString(value.residual.expression)));
