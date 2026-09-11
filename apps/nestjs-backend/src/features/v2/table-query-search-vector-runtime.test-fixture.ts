import {
  BaseId,
  DbFieldName,
  DbTableName,
  FieldId,
  FieldName,
  Table,
  TableId,
  TableName,
  type ITableSearchIndex,
} from '@teable/v2-core';

export const createSearchIndexTable = (tableId: string, fieldId: string): Table => {
  const builder = Table.builder()
    .withId(TableId.create(tableId)._unsafeUnwrap())
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Orders')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(FieldId.create(fieldId)._unsafeUnwrap())
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return withSearchIndex(builder.build()._unsafeUnwrap(), [fieldId]);
};

export const withSearchIndex = (
  table: Table,
  fieldIds: readonly string[],
  overrides: Partial<ITableSearchIndex> = {}
): Table => {
  const fields = table.getFields();
  for (const field of fields) {
    if (field.dbFieldName().isErr()) {
      field
        .setDbFieldName(DbFieldName.rehydrate(field.id().toString())._unsafeUnwrap())
        ._unsafeUnwrap();
    }
  }
  const dbTableName = `${table.baseId().toString()}.${table.id().toString()}`;
  return Table.rehydrate({
    id: table.id(),
    baseId: table.baseId(),
    name: table.name(),
    fields,
    views: table.views(),
    primaryFieldId: table.primaryFieldId(),
    dbTableName: DbTableName.rehydrate(dbTableName)._unsafeUnwrap(),
    searchIndex: {
      version: 1,
      dbTableName,
      generatedColumnName: '__search_document',
      indexName: '__search_document_idx',
      provider: 'pg_trgm',
      searchScope: 'all_fields',
      definitionKey: 'validated-test-definition',
      indexUsable: true,
      fields: fieldIds.map((fieldId) => ({
        fieldId,
        fieldDbName: fieldId,
        textProjection: { kind: 'plain' },
      })),
      ...overrides,
    },
  })._unsafeUnwrap();
};
