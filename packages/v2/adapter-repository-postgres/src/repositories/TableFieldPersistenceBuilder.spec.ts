import { describe, expect, it } from 'vitest';

import {
  ActorId,
  BaseId,
  DefaultTableMapper,
  FieldHasError,
  FieldName,
  FormulaExpression,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import { TableFieldPersistenceBuilder } from './TableFieldPersistenceBuilder';

describe('TableFieldPersistenceBuilder', () => {
  it('preserves hasError when building persistence rows', () => {
    const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Duplicate Builder')._unsafeUnwrap());

    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();
    builder
      .field()
      .formula()
      .withName(FieldName.create('Broken Formula')._unsafeUnwrap())
      .withExpression(FormulaExpression.create('1')._unsafeUnwrap())
      .done();

    const table = builder.build()._unsafeUnwrap();
    const formulaField = table
      .getFields()
      .find((field) => field.name().toString() === 'Broken Formula');
    expect(formulaField).toBeDefined();
    formulaField?.setHasError(FieldHasError.error());

    const persistenceBuilder = new TableFieldPersistenceBuilder({
      table,
      tableMapper: new DefaultTableMapper(),
      now: new Date('2026-03-23T00:00:00.000Z'),
      actorId: ActorId.create('system')._unsafeUnwrap().toString(),
    });

    const dbMeta = persistenceBuilder.buildDbFieldMeta()._unsafeUnwrap();
    const rows = persistenceBuilder.buildRowsFromDbMeta(dbMeta)._unsafeUnwrap();
    const formulaRow = rows.find((row) => row.name === 'Broken Formula');

    expect(formulaRow?.has_error).toBe(true);
  });
});
