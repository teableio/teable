import {
  isTableSearchIndex,
  SearchDocumentFieldContributionVisitor,
  searchFieldTextProjectionKey,
  type FieldId,
  type ITableSearchIndex,
  type IRecordSearchAccessPath,
  type ITableReadModel,
} from '@teable/v2-core';

/** Resolve only previously validated coverage; never enroll fields added after publication. */
export const resolveTableSearchAccessPath = (
  table: ITableReadModel
): IRecordSearchAccessPath | undefined => {
  const snapshot = table.searchIndex();
  if (!isTableSearchIndex(snapshot)) return undefined;
  const physicalName = table.dbTableName().andThen((name) => name.value());
  if (physicalName.isErr() || physicalName.value !== snapshot.dbTableName) return undefined;

  const savedFields = new Map<string, ITableSearchIndex['fields'][number]>();
  for (const field of snapshot.fields) savedFields.set(field.fieldId, field);
  const visitor = new SearchDocumentFieldContributionVisitor();
  const coveredFieldIds: FieldId[] = [];
  for (const field of table.getFields()) {
    const saved = savedFields.get(field.id().toString());
    if (!saved) continue;
    const dbName = field.dbFieldName().andThen((name) => name.value());
    if (dbName.isErr() || dbName.value !== saved.fieldDbName) continue;
    const contribution = field.accept(visitor);
    if (
      contribution.isErr() ||
      !contribution.value.included ||
      !contribution.value.textProjection ||
      searchFieldTextProjectionKey(contribution.value.textProjection) !==
        searchFieldTextProjectionKey(saved.textProjection)
    )
      continue;
    coveredFieldIds.push(field.id());
  }
  return {
    kind: 'generated_text',
    generatedColumnName: snapshot.generatedColumnName,
    provider: snapshot.provider,
    searchScope: snapshot.searchScope,
    coveredFieldIds,
    indexUsable: snapshot.indexUsable && coveredFieldIds.length > 0,
  };
};
