import {
  BaseId,
  DbFieldName,
  DbTableName,
  FieldId,
  FieldName,
  FormulaExpression,
  Table,
  TableName,
} from '@teable/v2-core';

export const makeBackfillFusionTable = (
  expressions = ['1 + 1', '2 * 3'],
  dbTableName = 'public.fusion'
) => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap({ withStackTrace: true }))
    .withName(TableName.create('Fusion')._unsafeUnwrap({ withStackTrace: true }))
    .withDbTableName(DbTableName.rehydrate(dbTableName)._unsafeUnwrap());
  builder
    .field()
    .number()
    .withId(FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(FieldName.create('Name')._unsafeUnwrap({ withStackTrace: true }))
    .done();
  for (const [index, expression] of expressions.entries()) {
    builder
      .field()
      .formula()
      .withName(FieldName.create(`F${index}`)._unsafeUnwrap({ withStackTrace: true }))
      .withExpression(FormulaExpression.create(expression)._unsafeUnwrap({ withStackTrace: true }))
      .done();
  }
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap({ withStackTrace: true });
  table
    .getFields()
    .forEach((field, index) =>
      field
        .setDbFieldName(
          DbFieldName.rehydrate(`col_${index}`)._unsafeUnwrap({ withStackTrace: true })
        )
        ._unsafeUnwrap({ withStackTrace: true })
    );
  return table;
};
