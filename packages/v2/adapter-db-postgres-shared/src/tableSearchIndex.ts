import { isTableSearchIndex, type ITableSearchIndex } from '@teable/v2-core';

/** Persisted v1 is decoded here, never exposed as a second domain model. */
export const decodeTableSearchIndex = (raw: unknown): ITableSearchIndex | undefined => {
  if (isTableSearchIndex(raw)) return raw;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (value.version === 2) {
    const envelope = {
      version: value.version,
      dbTableName: value.dbTableName,
      definitionKey: value.definitionKey,
      searchScope: value.searchScope,
      fieldIds: value.fieldIds,
    };
    if (!isTableSearchIndex(envelope)) return undefined;
    const document = { ...envelope, document: value.document };
    const residual = { ...envelope, residual: value.residual };
    return {
      ...envelope,
      ...(isTableSearchIndex(document) && document.document ? { document: document.document } : {}),
      ...(isTableSearchIndex(residual) && residual.residual ? { residual: residual.residual } : {}),
    };
  }
  if (value.version !== 1 || !Array.isArray(value.fields) || typeof value.indexUsable !== 'boolean')
    return undefined;
  const candidate = {
    version: 2,
    dbTableName: value.dbTableName,
    definitionKey: value.definitionKey,
    searchScope: value.searchScope,
    fieldIds: value.fields.map((field) => (field as { fieldId?: unknown } | null)?.fieldId),
    document: {
      generatedColumnName: value.generatedColumnName,
      indexName: value.indexName,
      provider: value.provider,
      ready: value.indexUsable,
      fields: value.fields,
    },
  };
  return isTableSearchIndex(candidate) ? candidate : undefined;
};
