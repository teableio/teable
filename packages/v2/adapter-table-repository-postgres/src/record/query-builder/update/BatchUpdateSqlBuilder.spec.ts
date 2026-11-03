import { BaseId, DbFieldName, FieldName, Table, TableId, TableName } from '@teable/v2-core';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from 'kysely';
import { describe, expect, it } from 'vitest';

import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { buildBatchUpdateSql } from './BatchUpdateSqlBuilder';

const createTestDb = () =>
  new Kysely<DynamicDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;

interface TableConfig {
  name: string;
  fields: Array<{
    type: 'singleLineText' | 'number' | 'checkbox' | 'date' | 'attachment' | 'multipleSelect';
    name: string;
    dbFieldName: string;
  }>;
}

const createTable = (config: TableConfig) => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create(config.name)._unsafeUnwrap());

  // Add fields based on config
  for (const fieldConfig of config.fields) {
    const fieldName = FieldName.create(fieldConfig.name)._unsafeUnwrap();
    switch (fieldConfig.type) {
      case 'singleLineText':
        builder.field().singleLineText().withName(fieldName).done();
        break;
      case 'number':
        builder.field().number().withName(fieldName).done();
        break;
      case 'checkbox':
        builder.field().checkbox().withName(fieldName).done();
        break;
      case 'date':
        builder.field().date().withName(fieldName).done();
        break;
      case 'attachment':
        builder.field().attachment().withName(fieldName).done();
        break;
      case 'multipleSelect':
        builder.field().multipleSelect().withName(fieldName).done();
        break;
    }
  }

  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();

  // Set DB field names
  config.fields.forEach((fieldConfig, index) => {
    table
      .getFields()
      [index].setDbFieldName(DbFieldName.rehydrate(fieldConfig.dbFieldName)._unsafeUnwrap())
      ._unsafeUnwrap();
  });

  return table;
};

describe('buildBatchUpdateSql', () => {
  it('returns error for empty columns', () => {
    const db = createTestDb();
    const table = createTable({
      name: 'EmptyTable',
      fields: [{ type: 'singleLineText', name: 'Name', dbFieldName: 'col_name' }],
    });

    const result = buildBatchUpdateSql({
      tableName: 'test_table',
      columnUpdateData: new Map(),
      systemColumns: {
        lastModifiedTime: '2025-01-17T00:00:00.000Z',
        lastModifiedBy: 'usr_test',
        versionIncrement: true,
      },
      table,
      db,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.message).toBe('No columns to update in batch');
  });

  it('escapes single quotes in values', () => {
    const db = createTestDb();
    const table = createTable({
      name: 'QuoteTable',
      fields: [{ type: 'singleLineText', name: 'Text', dbFieldName: 'col_text' }],
    });

    const columnUpdateData = new Map([
      [
        'col_text',
        [
          { recordId: 'rec_001', value: "O'Brien" },
          { recordId: 'rec_002', value: "It's a test" },
        ],
      ],
    ]);

    const result = buildBatchUpdateSql({
      tableName: 'test_table',
      columnUpdateData,
      systemColumns: {
        lastModifiedTime: '2025-01-17T00:00:00.000Z',
        lastModifiedBy: 'usr_test',
        versionIncrement: true,
      },
      table,
      db,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    // Single quotes should be escaped as ''
    expect(result.value.sql).toContain("'O''Brien'");
    expect(result.value.sql).toContain("'It''s a test'");
  });

  it('preserves omitted sparse values by emitting presence-aware assignments', () => {
    const db = createTestDb();
    const table = createTable({
      name: 'SparsePresenceTable',
      fields: [
        { type: 'singleLineText', name: 'Status', dbFieldName: 'col_status' },
        { type: 'singleLineText', name: 'Notes', dbFieldName: 'col_notes' },
      ],
    });

    const columnUpdateData = new Map<string, Array<{ recordId: string; value: unknown }>>([
      ['col_status', [{ recordId: 'rec_001', value: 'Closed' }]],
      ['col_notes', [{ recordId: 'rec_002', value: 'Touched' }]],
    ]);

    const result = buildBatchUpdateSql({
      tableName: 'test_table',
      columnUpdateData,
      systemColumns: {
        lastModifiedTime: '2025-01-17T00:00:00.000Z',
        lastModifiedBy: 'usr_test',
        versionIncrement: true,
      },
      table,
      db,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.sql).toContain(
      '"col_status" = CASE WHEN v."__has_0" THEN v."col_status" ELSE t."col_status" END'
    );
    expect(result.value.sql).toContain(
      '"col_notes" = CASE WHEN v."__has_1" THEN v."col_notes" ELSE t."col_notes" END'
    );
    expect(result.value.sql).toContain("('rec_001', TRUE, 'Closed', FALSE, NULL");
    expect(result.value.sql).toContain("('rec_002', FALSE, NULL, TRUE, 'Touched'");
  });

  it('rebases parameters for raw SQL expressions embedded in VALUES rows', () => {
    const db = createTestDb();
    const table = createTable({
      name: 'LinkTable',
      fields: [{ type: 'attachment', name: 'Links', dbFieldName: 'col_links' }],
    });

    const result = buildBatchUpdateSql({
      tableName: 'test_table',
      columnUpdateData: new Map([
        [
          'col_links',
          [
            {
              recordId: 'rec_expr_1',
              value: sql`(
                SELECT jsonb_build_array(
                  jsonb_build_object('id', ${'rec_foreign_1'}, 'title', ${'Target A'})
                )
              )`,
            },
            {
              recordId: 'rec_expr_2',
              value: sql`(
                SELECT jsonb_build_array(
                  jsonb_build_object('id', ${'rec_foreign_2'}, 'title', ${'Target B'})
                )
              )`,
            },
          ],
        ],
      ]),
      systemColumns: {
        lastModifiedTime: '2025-01-17T00:00:00.000Z',
        lastModifiedBy: 'usr_test',
        versionIncrement: true,
      },
      table,
      db,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.sql).toContain('SELECT jsonb_build_array');
    expect(result.value.sql).toContain('$1');
    expect(result.value.sql).toContain('$4');
    expect(result.value.parameters).toEqual([
      'rec_foreign_1',
      'Target A',
      'rec_foreign_2',
      'Target B',
    ]);
  });
});
