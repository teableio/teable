import {
  BaseId,
  DbFieldName,
  DbTableName,
  FieldId,
  FieldName,
  FormulaExpression,
  Table,
  TableName,
  TimeZone,
} from '@teable/v2-core';

import { resolveColumnType } from '../../../schema/visitors/PostgresTableSchemaFieldColumn';

export const scalarBackfillInputIds = {
  text: `fld${'a'.repeat(16)}`,
  number: `fld${'b'.repeat(16)}`,
  date: `fld${'c'.repeat(16)}`,
  flag: `fld${'d'.repeat(16)}`,
};
const input = scalarBackfillInputIds;
export const scalarBackfillExpressions = [
  `{${input.number}} + 1`,
  `{${input.number}} * 2`,
  `UPPER(TRIM({${input.text}}))`,
  `IF({${input.flag}}, {${input.text}}, "off")`,
  `DATE_ADD({${input.date}}, 1, "day")`,
  `YEAR({${input.date}})`,
  `IF({${input.number}} = 0, ERROR("zero"), {${input.text}} & " ok")`,
  `IS_ERROR(1 / {${input.number}})`,
];

export const makeScalarBackfillTable = (
  dbTableName = 'public.scalar_fusion',
  expressions = scalarBackfillExpressions
) => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withDbTableName(DbTableName.rehydrate(dbTableName)._unsafeUnwrap())
    .withName(TableName.create('Scalar backfill')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(FieldId.create(input.text)._unsafeUnwrap())
    .withName(FieldName.create('Text')._unsafeUnwrap())
    .done();
  builder
    .field()
    .number()
    .withId(FieldId.create(input.number)._unsafeUnwrap())
    .withName(FieldName.create('Number')._unsafeUnwrap())
    .done();
  builder
    .field()
    .date()
    .withId(FieldId.create(input.date)._unsafeUnwrap())
    .withName(FieldName.create('Date')._unsafeUnwrap())
    .done();
  builder
    .field()
    .checkbox()
    .withId(FieldId.create(input.flag)._unsafeUnwrap())
    .withName(FieldName.create('Flag')._unsafeUnwrap())
    .done();
  for (const [index, expression] of expressions.entries()) {
    builder
      .field()
      .formula()
      .withName(FieldName.create(`F${index}`)._unsafeUnwrap())
      .withExpression(FormulaExpression.create(expression)._unsafeUnwrap())
      .withTimeZone(TimeZone.create('America/New_York')._unsafeUnwrap())
      .done();
  }
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap({ withStackTrace: true });
  table
    .getFields()
    .forEach((field, i) =>
      field.setDbFieldName(DbFieldName.rehydrate(`col_${i}`)._unsafeUnwrap())._unsafeUnwrap()
    );
  const columnDefinitions = table
    .getFields()
    .map((field, i) => `col_${i} ${resolveColumnType(field)._unsafeUnwrap()}`)
    .join(', ');
  return { table, fields: table.getFields().slice(4), columnDefinitions };
};
