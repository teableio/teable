import {
  FieldId,
  isTableSearchIndex,
  isSearchFieldTextProjection,
  resolveSearchFieldTextShape,
  SearchDocumentFieldContributionVisitor,
  searchFieldTextProjectionKey,
  type ITableSearchField,
  type IRecordSearchAccessPath,
  type ITableReadModel,
} from '@teable/v2-core';

/** Resolve saved membership only. No catalog access or enrollment on reads. */
export const resolveTableSearchAccessPath = (
  table: ITableReadModel
): IRecordSearchAccessPath | undefined => {
  const snapshot = table.searchIndex();
  if (!isTableSearchIndex(snapshot)) return undefined;
  const physical = table.dbTableName().andThen((name) => name.value());
  if (physical.isErr() || physical.value !== snapshot.dbTableName) return undefined;
  const fields = new Map(table.getFields().map((field) => [field.id().toString(), field]));
  const visitor = new SearchDocumentFieldContributionVisitor();
  const compatible = (saved: ITableSearchField, document: boolean): boolean => {
    const field = fields.get(saved.fieldId);
    if (!field) return false;
    const name = field.dbFieldName().andThen((value) => value.value());
    if (name.isErr() || name.value !== saved.fieldDbName) return false;
    const shape = resolveSearchFieldTextShape(field);
    if (
      shape.isErr() ||
      !isSearchFieldTextProjection(shape.value) ||
      searchFieldTextProjectionKey(shape.value) !==
        searchFieldTextProjectionKey(saved.textProjection)
    )
      return false;
    return (
      !document ||
      field
        .accept(visitor)
        .map((value) => value.included)
        .unwrapOr(false)
    );
  };
  const ids = (values: readonly string[]) =>
    values.flatMap((value) => {
      const id = FieldId.create(value);
      return id.isOk() ? [id.value] : [];
    });
  const document = snapshot.document;
  const documentFields = document?.fields.filter((field) => compatible(field, true)) ?? [];
  const residual = snapshot.residual;
  const residualReady = Boolean(
    residual?.ready &&
    residual.fields.length &&
    residual.fields.every((field) => compatible(field, false))
  );
  return {
    kind: 'generated_text',
    searchScope: snapshot.searchScope,
    fieldIds: ids(snapshot.fieldIds),
    ...(document
      ? {
          document: {
            generatedColumnName: document.generatedColumnName,
            provider: document.provider,
            coveredFieldIds: ids(documentFields.map((field) => field.fieldId)),
            ready: document.ready && documentFields.length > 0,
          },
        }
      : {}),
    ...(residual
      ? {
          residual: {
            provider: residual.provider,
            fields: residual.fields,
            expression: residual.expression,
            coveredFieldIds: residualReady
              ? ids(residual.fields.map((field) => field.fieldId))
              : [],
            ready: residualReady,
          },
        }
      : {}),
  };
};
