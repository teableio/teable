import {
  BaseId,
  createLinkField,
  DbFieldName,
  DbFieldType,
  FieldId,
  FieldName,
  LinkFieldConfig,
  LookupField,
  LookupOptions,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { makeExpr } from './SqlExpression';
import { Pg16TypeValidationStrategy } from './strategies';
import { createFormulaTestContainer } from './testkit/FormulaSqlPgTestkit';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';

const unwrap = <T>(result: { isErr(): boolean; value?: T; error?: unknown }): T => {
  if (result.isErr()) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value as T;
};

describe('formula lookup-of-link leftover TEXT titles', () => {
  let container: IV2NodeTestContainer;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('does not hard-cast leftover TEXT lookup-of-link titles with ::jsonb', async () => {
    const lookupFieldId = unwrap(FieldId.create(`fld${'k'.repeat(16)}`));
    const innerLinkId = unwrap(FieldId.create(`fld${'i'.repeat(16)}`));
    const linkFieldId = unwrap(FieldId.create(`fld${'l'.repeat(16)}`));
    const foreignTableId = unwrap(TableId.create(`tbl${'f'.repeat(16)}`));
    const hostTableId = unwrap(TableId.create(`tbl${'h'.repeat(16)}`));

    const innerLink = unwrap(
      createLinkField({
        id: innerLinkId,
        name: unwrap(FieldName.create('Peer Link')),
        config: unwrap(
          LinkFieldConfig.create({
            relationship: 'manyOne',
            foreignTableId: foreignTableId.toString(),
            lookupFieldId: `fld${'p'.repeat(16)}`,
            fkHostTableName: 'link_relations',
            selfKeyName: '__self_id',
            foreignKeyName: '__foreign_id',
          })
        ),
      })
    );

    const lookupField = unwrap(
      LookupField.create({
        id: lookupFieldId,
        name: unwrap(FieldName.create('Foreign Peer')),
        innerField: innerLink,
        lookupOptions: unwrap(
          LookupOptions.create({
            linkFieldId: linkFieldId.toString(),
            lookupFieldId: innerLinkId.toString(),
            foreignTableId: foreignTableId.toString(),
          })
        ),
        isMultipleCellValue: false,
      })
    );
    unwrap(lookupField.setDbFieldName(unwrap(DbFieldName.rehydrate('Framework_Key'))));
    unwrap(lookupField.setDbFieldType(unwrap(DbFieldType.rehydrate('TEXT'))));

    const table = unwrap(
      Table.builder()
        .withId(hostTableId)
        .withBaseId(unwrap(BaseId.create(`bse${'a'.repeat(16)}`)))
        .withName(unwrap(TableName.create('Host')))
        .field()
        .singleLineText()
        .withName(unwrap(FieldName.create('Name')))
        .done()
        .view()
        .defaultGrid()
        .done()
        .build()
    );
    const tableWithLookup = unwrap(table.addField(lookupField));

    const translator = new FormulaSqlPgTranslator({
      table: tableWithLookup,
      tableAlias: 't',
      typeValidationStrategy: new Pg16TypeValidationStrategy(),
      resolveFieldSql: (field) =>
        ok(makeExpr('"t"."Framework_Key"', 'string', false, undefined, undefined, field, 'json')),
    });

    const translated = translator.translateExpression(`{${lookupFieldId.toString()}}`);
    expect(translated.isOk()).toBe(true);
    if (translated.isErr()) return;

    const rendered = translator.renderSql(translated.value);
    expect(rendered).toContain('to_jsonb("t"."Framework_Key")');
    expect(rendered).not.toMatch(/"Framework_Key"\)::jsonb/);
    expect((rendered.match(/to_jsonb\("t"\."Framework_Key"\)/g) ?? []).length).toBe(1);

    const executed = await sql
      .raw(`select (${rendered}) as title from (select 'Peer A'::text as "Framework_Key") as t`)
      .execute(container.db);
    const row = executed.rows[0] as { title?: unknown };
    expect(row.title).toBe('Peer A');
  });
});
