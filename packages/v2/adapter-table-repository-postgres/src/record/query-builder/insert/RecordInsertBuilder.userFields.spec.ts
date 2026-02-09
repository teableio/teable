/**
 * Integration tests for CreatedBy/LastModifiedBy fields in RecordInsertBuilder.
 *
 * These fields should be populated during INSERT using a subquery to fetch user info.
 * The system columns (__created_by, __last_modified_by) store user IDs.
 * The user-facing columns (col_created_by, col_last_modified_by) store full user objects as JSONB.
 */
import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it } from 'vitest';

import type { DynamicDB } from '../../query-builder/ITableRecordQueryBuilder';
import { RecordInsertBuilder } from './RecordInsertBuilder';

// Fixed IDs for stable snapshots
const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const TEXT_FIELD_ID = `fld${'c'.repeat(16)}`;
const CREATED_BY_FIELD_ID = `fld${'d'.repeat(16)}`;
const LAST_MODIFIED_BY_FIELD_ID = `fld${'e'.repeat(16)}`;
const RECORD_ID = `rec${'f'.repeat(16)}`;
const ACTOR_ID = 'usr_test_user';

const createTestDb = () =>
  new Kysely<DynamicDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

const createTableWithUserFields = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
  const textFieldId = FieldId.create(TEXT_FIELD_ID)._unsafeUnwrap();
  const createdByFieldId = FieldId.create(CREATED_BY_FIELD_ID)._unsafeUnwrap();
  const lastModifiedByFieldId = FieldId.create(LAST_MODIFIED_BY_FIELD_ID)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('UserFieldsTable')._unsafeUnwrap());

  // Add text field
  builder
    .field()
    .singleLineText()
    .withId(textFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();

  // Add CreatedBy field
  builder
    .field()
    .createdBy()
    .withId(createdByFieldId)
    .withName(FieldName.create('CreatedBy')._unsafeUnwrap())
    .done();

  // Add LastModifiedBy field
  builder
    .field()
    .lastModifiedBy()
    .withId(lastModifiedByFieldId)
    .withName(FieldName.create('LastModifiedBy')._unsafeUnwrap())
    .done();

  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();

  // Set db field names
  const fields = table.getFields();
  fields[0].setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())._unsafeUnwrap();
  fields[1].setDbFieldName(DbFieldName.rehydrate('col_created_by')._unsafeUnwrap())._unsafeUnwrap();
  fields[2]
    .setDbFieldName(DbFieldName.rehydrate('col_last_modified_by')._unsafeUnwrap())
    ._unsafeUnwrap();

  return table;
};

describe('RecordInsertBuilder with CreatedBy/LastModifiedBy fields', () => {
  it('should include CreatedBy/LastModifiedBy field values in INSERT with subquery expressions', () => {
    const db = createTestDb();
    const table = createTableWithUserFields();
    const builder = new RecordInsertBuilder(db);

    const result = builder.buildInsertData({
      table,
      fieldValues: new Map([[TEXT_FIELD_ID, 'Test Value']]),
      context: {
        recordId: RECORD_ID,
        actorId: ACTOR_ID,
        now: '2025-01-01T00:00:00.000Z',
      },
    });

    expect(result.isOk()).toBe(true);
    const { values, userFieldColumns } = result._unsafeUnwrap();

    // System columns should be set
    expect(values['__id']).toBe(RECORD_ID);
    expect(values['__created_by']).toBe(ACTOR_ID);
    expect(values['__last_modified_by']).toBe(ACTOR_ID);
    expect(values['__version']).toBe(1);

    // User-facing CreatedBy/LastModifiedBy fields should be in INSERT values
    // They contain SQL subquery expressions to fetch user info
    expect(values['col_created_by']).toBeDefined();
    expect(values['col_last_modified_by']).toBeDefined();

    // userFieldColumns should track which columns are user fields
    expect(userFieldColumns).toHaveLength(2);
    expect(userFieldColumns[0]).toEqual({
      dbFieldName: 'col_created_by',
      systemColumn: '__created_by',
    });
    expect(userFieldColumns[1]).toEqual({
      dbFieldName: 'col_last_modified_by',
      systemColumn: '__last_modified_by',
    });

    // Text field should be set
    expect(values['col_name']).toBe('Test Value');
  });

  it('should generate INSERT SQL with CreatedBy/LastModifiedBy field columns using subquery', () => {
    const db = createTestDb();
    const table = createTableWithUserFields();
    const tableName = `${BASE_ID}.${TABLE_ID}`;
    const builder = new RecordInsertBuilder(db);

    const result = builder.build({
      table,
      tableName,
      fieldValues: new Map([[TEXT_FIELD_ID, 'Test Value']]),
      context: {
        recordId: RECORD_ID,
        actorId: ACTOR_ID,
        now: '2025-01-01T00:00:00.000Z',
      },
    });

    expect(result.isOk()).toBe(true);
    const { mainInsert } = result._unsafeUnwrap();
    const sql = mainInsert.compiled.sql;

    // SQL should include col_created_by and col_last_modified_by with subquery
    expect(sql).toContain('col_created_by');
    expect(sql).toContain('col_last_modified_by');

    // SQL should contain the jsonb_build_object subquery for user info
    expect(sql).toContain('jsonb_build_object');
    expect(sql).toContain('public.users');

    // SQL should include system columns
    expect(sql).toContain('__created_by');
    expect(sql).toContain('__last_modified_by');

    // SQL should include the text field
    expect(sql).toContain('col_name');
  });
});
