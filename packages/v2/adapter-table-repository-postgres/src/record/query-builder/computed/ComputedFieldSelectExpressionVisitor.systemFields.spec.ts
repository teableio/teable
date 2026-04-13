import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  LinkFieldConfig,
  LookupField,
  LookupOptions,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it } from 'vitest';

import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { ComputedTableRecordQueryBuilder } from './ComputedTableRecordQueryBuilder';

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const TEXT_FIELD_ID = `fld${'c'.repeat(16)}`;
const AUTO_NUMBER_FIELD_ID = `fld${'d'.repeat(16)}`;
const CREATED_TIME_FIELD_ID = `fld${'e'.repeat(16)}`;
const LAST_MODIFIED_TIME_FIELD_ID = `fld${'f'.repeat(16)}`;

const typeValidationStrategy = new Pg16TypeValidationStrategy();

const createTestDb = () =>
  new Kysely<DynamicDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

const compileQuery = (db: Kysely<DynamicDB>, builder: ComputedTableRecordQueryBuilder) => {
  const result = builder.build();
  if (result.isErr()) throw new Error(result.error.message);
  return result.value.compile().sql;
};

const createTableWithSystemFields = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
  const textFieldId = FieldId.create(TEXT_FIELD_ID)._unsafeUnwrap();
  const autoNumberFieldId = FieldId.create(AUTO_NUMBER_FIELD_ID)._unsafeUnwrap();
  const createdTimeFieldId = FieldId.create(CREATED_TIME_FIELD_ID)._unsafeUnwrap();
  const lastModifiedTimeFieldId = FieldId.create(LAST_MODIFIED_TIME_FIELD_ID)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('SystemFieldsTable')._unsafeUnwrap());

  builder
    .field()
    .singleLineText()
    .withId(textFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .autoNumber()
    .withId(autoNumberFieldId)
    .withName(FieldName.create('Auto Number')._unsafeUnwrap())
    .done();
  builder
    .field()
    .createdTime()
    .withId(createdTimeFieldId)
    .withName(FieldName.create('Created Time')._unsafeUnwrap())
    .done();
  builder
    .field()
    .lastModifiedTime()
    .withId(lastModifiedTimeFieldId)
    .withName(FieldName.create('Last Modified Time')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  const [textField] = table.getFields();
  textField.setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(autoNumberFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_auto_number')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(createdTimeFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_created_time')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(lastModifiedTimeFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_last_modified_time')._unsafeUnwrap())
    ._unsafeUnwrap();

  return table;
};

describe('ComputedTableRecordQueryBuilder with system scalar fields', () => {
  it('reads autoNumber and time fields from system columns', () => {
    const db = createTestDb();
    const table = createTableWithSystemFields();

    const sql = compileQuery(
      db,
      new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy }).from(table)
    );

    expect(sql).toContain('"t"."__auto_number" as "col_auto_number"');
    expect(sql).toContain('"t"."__created_time" as "col_created_time"');
    expect(sql).toContain('"t"."__last_modified_time" as "col_last_modified_time"');
  });

  it('reads lookup autoNumber from the foreign __auto_number column', () => {
    const db = createTestDb();
    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const hostTableId = TableId.create(`tbl${'h'.repeat(16)}`)._unsafeUnwrap();
    const foreignTableId = TableId.create(`tbl${'i'.repeat(16)}`)._unsafeUnwrap();
    const foreignTitleFieldId = FieldId.create(`fld${'g'.repeat(16)}`)._unsafeUnwrap();
    const foreignAutoNumberFieldId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
    const hostTitleFieldId = FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap();
    const hostLinkFieldId = FieldId.create(`fld${'j'.repeat(16)}`)._unsafeUnwrap();
    const hostLookupFieldId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();

    const foreignBuilder = Table.builder()
      .withId(foreignTableId)
      .withBaseId(baseId)
      .withName(TableName.create('LookupSource')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignTitleFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder
      .field()
      .autoNumber()
      .withId(foreignAutoNumberFieldId)
      .withName(FieldName.create('Auto Number')._unsafeUnwrap())
      .done();
    foreignBuilder.view().defaultGrid().done();

    const foreignTable = foreignBuilder.build()._unsafeUnwrap();
    foreignTable
      .getField((field) => field.id().equals(foreignTitleFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_source_name')._unsafeUnwrap())
      ._unsafeUnwrap();
    foreignTable
      .getField((field) => field.id().equals(foreignAutoNumberFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_source_auto_number')._unsafeUnwrap())
      ._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignTitleFieldId.toString(),
      symmetricFieldId: `fld${'l'.repeat(16)}`,
    })._unsafeUnwrap();
    const lookupOptions = LookupOptions.create({
      linkFieldId: hostLinkFieldId.toString(),
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignAutoNumberFieldId.toString(),
    })._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withId(hostTableId)
      .withBaseId(baseId)
      .withName(TableName.create('LookupHost')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(hostTitleFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder
      .field()
      .link()
      .withId(hostLinkFieldId)
      .withName(FieldName.create('Source')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    hostBuilder.view().defaultGrid().done();

    const baseHostTable = hostBuilder.build()._unsafeUnwrap();
    const hostLookupField = LookupField.create({
      id: hostLookupFieldId,
      name: FieldName.create('Lookup Auto Number')._unsafeUnwrap(),
      lookupOptions,
      innerField: foreignTable
        .getField((field) => field.id().equals(foreignAutoNumberFieldId))
        ._unsafeUnwrap(),
      isMultipleCellValue: true,
    })._unsafeUnwrap();
    const hostTable = baseHostTable
      .addField(hostLookupField, {
        foreignTables: [foreignTable],
      })
      ._unsafeUnwrap();
    hostTable
      .getField((field) => field.id().equals(hostTitleFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_host_name')._unsafeUnwrap())
      ._unsafeUnwrap();
    hostTable
      .getField((field) => field.id().equals(hostLinkFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_host_link')._unsafeUnwrap())
      ._unsafeUnwrap();
    hostTable
      .getField((field) => field.id().equals(hostLookupFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_lookup_auto_number')._unsafeUnwrap())
      ._unsafeUnwrap();

    const sql = compileQuery(
      db,
      new ComputedTableRecordQueryBuilder(db, {
        typeValidationStrategy,
        foreignTables: new Map([[foreignTable.id().toString(), foreignTable]]),
      }).from(hostTable)
    );

    expect(sql).toContain('"f"."__auto_number"');
    expect(sql).toContain('as "col_lookup_auto_number"');
    expect(sql).not.toContain('"f"."col_source_auto_number"');
  });
});
