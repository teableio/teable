import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, test } from 'vitest';

import { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { makeExpr } from './SqlExpression';
import { Pg16TypeValidationStrategy } from './strategies';

const DATE_FIELD_ID = `fld${'d'.repeat(16)}`;

const createDateTable = () => {
  const builder = Table.builder()
    .withId(TableId.create(`tbl${'m'.repeat(16)}`)._unsafeUnwrap())
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('DeadlineTable')._unsafeUnwrap());
  builder
    .field()
    .date()
    .withId(FieldId.create(DATE_FIELD_ID)._unsafeUnwrap())
    .withName(FieldName.create('Deadline')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  table
    .getFields()[0]
    .setDbFieldName(DbFieldName.rehydrate('col_deadline')._unsafeUnwrap())
    ._unsafeUnwrap();
  return table;
};

describe('boolean coercion of string-typed timestamptz', () => {
  test('IF does not pass a timestamptz column to BTRIM without a text cast', () => {
    const table = createDateTable();
    const translator = new FormulaSqlPgTranslator({
      table,
      tableAlias: 't',
      resolveFieldSql: (field) =>
        ok(makeExpr('"t"."col_deadline"', 'string', false, undefined, undefined, field)),
      typeValidationStrategy: new Pg16TypeValidationStrategy(),
    });
    const translated = translator.translateExpression(`IF({${DATE_FIELD_ID}}, TRUE, FALSE)`);
    expect(translated.isOk()).toBe(true);
    if (translated.isErr()) throw new Error(translated.error.message);

    expect(translated.value.valueSql).not.toMatch(/BTRIM\(\s*"t"\."col_deadline"\s*\)/);
    expect(translated.value.valueSql).toMatch(/BTRIM\(\("t"\."col_deadline"\)::text\)/);
  });
});
