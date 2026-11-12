import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  BaseId,
  ConditionalLookupField,
  ConditionalLookupOptions,
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
import type { Field } from '@teable/v2-core';
import { sql } from 'kysely';
import { ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { makeExpr } from './SqlExpression';
import { Pg16TypeValidationStrategy } from './strategies';
import { createFormulaTestContainer } from './testkit/FormulaSqlPgTestkit';

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

  it.each(['table', 'reference'] as const)(
    'does not hard-cast leftover TEXT lookup-of-link titles with ::jsonb (%s)',
    async (mode) => {
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

      const resolveFieldSql = (field: Field) =>
        ok(makeExpr('"t"."Framework_Key"', 'string', false, undefined, undefined, field, 'json'));
      const translator = new FormulaSqlPgTranslator({
        ...(mode === 'table'
          ? { table: tableWithLookup, resolveFieldSql }
          : {
              references: new Map([
                [lookupFieldId.toString(), { field: lookupField, resolveFieldSql }],
              ]),
            }),
        tableAlias: 't',
        typeValidationStrategy: new Pg16TypeValidationStrategy(),
      });

      const translated = translator.translateExpression(`{${lookupFieldId.toString()}}`);
      expect(translated.isOk()).toBe(true);
      if (translated.isErr()) return;

      const rendered = translator.renderSql(translated.value)._unsafeUnwrap();
      expect(rendered).toContain('to_jsonb("t"."Framework_Key")');
      expect(rendered).not.toMatch(/"Framework_Key"\)::jsonb/);
      expect((rendered.match(/to_jsonb\("t"\."Framework_Key"\)/g) ?? []).length).toBe(1);

      const executed = await sql
        .raw(`select (${rendered}) as title from (select 'Peer A'::text as "Framework_Key") as t`)
        .execute(container.db);
      const row = executed.rows[0] as { title?: unknown };
      expect(row.title).toBe('Peer A');
    }
  );

  it('reads historical scalar conditional-lookup link TEXT titles through LOWER', async () => {
    const foreignTableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
    const innerLinkId = FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap();
    const innerLink = createLinkField({
      id: innerLinkId,
      name: FieldName.create('Peer Link')._unsafeUnwrap(),
      config: LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: `fld${'p'.repeat(16)}`,
        fkHostTableName: 'link_relations',
        selfKeyName: '__self_id',
        foreignKeyName: '__foreign_id',
      })._unsafeUnwrap(),
    })._unsafeUnwrap();
    const lookup = ConditionalLookupField.create({
      id: FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap(),
      name: FieldName.create('Conditional Peer')._unsafeUnwrap(),
      innerField: innerLink,
      conditionalLookupOptions: ConditionalLookupOptions.create({
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: innerLinkId.toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: `fld${'s'.repeat(16)}`, operator: 'isNotEmpty' }],
          },
        },
      })._unsafeUnwrap(),
    })._unsafeUnwrap();
    lookup
      .setDbFieldName(DbFieldName.rehydrate('conditional_title')._unsafeUnwrap())
      ._unsafeUnwrap();
    lookup.setDbFieldType(DbFieldType.rehydrate('TEXT')._unsafeUnwrap())._unsafeUnwrap();
    expect(lookup.isMultipleCellValue()._unsafeUnwrap().isMultiple()).toBe(false);
    const translator = new FormulaSqlPgTranslator({
      references: new Map([
        [
          'peer',
          {
            field: lookup,
            resolveFieldSql: () => ok(makeExpr('"t"."conditional_title"', 'unknown')),
          },
        ],
      ]),
      tableAlias: 't',
      typeValidationStrategy: new Pg16TypeValidationStrategy(),
    });
    const expression = translator.translateExpression('LOWER({peer})')._unsafeUnwrap();
    const rendered = translator.renderSql(expression)._unsafeUnwrap();
    const result = await sql<{ title: unknown }>`
      select ${sql.raw(rendered)} as title from (select 'Peer A'::text as conditional_title) as t
    `.execute(container.db);
    expect(result.rows).toEqual([{ title: 'peer a' }]);
  });
});
