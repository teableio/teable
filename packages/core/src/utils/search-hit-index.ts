import type { FieldCore } from '../models/field/field';

export type ISearchHitIndex = {
  recordId: string;
  fieldId: string;
}[];

interface ISearchableRecord {
  id: string;
  fields: Record<string, unknown>;
}

/**
 * Compute search cell hits from loaded records, replacing the server-computed
 * extra.searchHitIndex of record queries. Scope is a comma-separated field id
 * list (search[1]) or all given fields; per-cell matching semantics are
 * delegated to FieldCore.matchSearch.
 */
export const computeSearchHitIndex = (
  records: ISearchableRecord[],
  fields: FieldCore[],
  searchQuery?: [string, string?, boolean?]
): ISearchHitIndex | undefined => {
  const searchValue = searchQuery?.[0];
  if (!searchValue || !records.length) return undefined;

  const scopedFieldIds = searchQuery?.[1] ? new Set(searchQuery[1].split(',')) : null;
  const searchableFields = scopedFieldIds
    ? fields.filter((field) => scopedFieldIds.has(field.id))
    : fields;
  if (!searchableFields.length) return undefined;

  const matchOptions = { isSearchAllFields: !scopedFieldIds };
  const hits: ISearchHitIndex = [];
  for (const record of records) {
    for (const field of searchableFields) {
      if (field.matchSearch(record.fields[field.id], searchValue, matchOptions)) {
        hits.push({ recordId: record.id, fieldId: field.id });
      }
    }
  }
  return hits.length ? hits : undefined;
};
