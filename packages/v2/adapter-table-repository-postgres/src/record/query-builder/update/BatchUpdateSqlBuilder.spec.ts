import { BaseId, DbFieldName, FieldName, Table, TableId, TableName } from '@teable/v2-core';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
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
  const testCases: Array<{
    description: string;
    tableConfig: TableConfig;
    updates: Array<{
      recordId: string;
      columns: Map<string, unknown>;
    }>;
  }> = [
    {
      description: 'single text field',
      tableConfig: {
        name: 'TestTable',
        fields: [{ type: 'singleLineText', name: 'Name', dbFieldName: 'col_name' }],
      },
      updates: [
        {
          recordId: 'rec_001',
          columns: new Map([['col_name', 'Alice']]),
        },
        {
          recordId: 'rec_002',
          columns: new Map([['col_name', 'Bob']]),
        },
      ],
    },
    {
      description: 'multiple text fields',
      tableConfig: {
        name: 'UsersTable',
        fields: [
          { type: 'singleLineText', name: 'FirstName', dbFieldName: 'col_first_name' },
          { type: 'singleLineText', name: 'LastName', dbFieldName: 'col_last_name' },
        ],
      },
      updates: [
        {
          recordId: 'rec_101',
          columns: new Map([
            ['col_first_name', 'John'],
            ['col_last_name', 'Doe'],
          ]),
        },
        {
          recordId: 'rec_102',
          columns: new Map([
            ['col_first_name', 'Jane'],
            ['col_last_name', 'Smith'],
          ]),
        },
      ],
    },
    {
      description: 'sparse updates (different fields per record)',
      tableConfig: {
        name: 'MixedTable',
        fields: [
          { type: 'singleLineText', name: 'Name', dbFieldName: 'col_name' },
          { type: 'number', name: 'Age', dbFieldName: 'col_age' },
        ],
      },
      updates: [
        {
          recordId: 'rec_201',
          columns: new Map([['col_name', 'Alice']]),
        },
        {
          recordId: 'rec_202',
          columns: new Map([['col_age', 30]]),
        },
      ],
    },
    {
      description: 'number and checkbox fields',
      tableConfig: {
        name: 'DataTable',
        fields: [
          { type: 'number', name: 'Score', dbFieldName: 'col_score' },
          { type: 'checkbox', name: 'Active', dbFieldName: 'col_active' },
        ],
      },
      updates: [
        {
          recordId: 'rec_301',
          columns: new Map([
            ['col_score', 95.5],
            ['col_active', true],
          ]),
        },
        {
          recordId: 'rec_302',
          columns: new Map([
            ['col_score', 82.3],
            ['col_active', false],
          ]),
        },
      ],
    },
    {
      description: 'JSONB fields (attachment)',
      tableConfig: {
        name: 'FilesTable',
        fields: [
          { type: 'singleLineText', name: 'Name', dbFieldName: 'col_name' },
          { type: 'attachment', name: 'Files', dbFieldName: 'col_files' },
        ],
      },
      updates: [
        {
          recordId: 'rec_401',
          columns: new Map([
            ['col_name', 'Document 1'],
            ['col_files', '[{"id":"att_001","name":"file1.pdf"}]'],
          ]),
        },
        {
          recordId: 'rec_402',
          columns: new Map([
            ['col_name', 'Document 2'],
            ['col_files', '[{"id":"att_002","name":"file2.pdf"}]'],
          ]),
        },
      ],
    },
    {
      description: 'NULL values',
      tableConfig: {
        name: 'NullableTable',
        fields: [
          { type: 'singleLineText', name: 'Name', dbFieldName: 'col_name' },
          { type: 'number', name: 'Count', dbFieldName: 'col_count' },
        ],
      },
      updates: [
        {
          recordId: 'rec_501',
          columns: new Map([
            ['col_name', 'Alice'],
            ['col_count', null],
          ]),
        },
        {
          recordId: 'rec_502',
          columns: new Map([
            ['col_name', null],
            ['col_count', 42],
          ]),
        },
      ],
    },
    {
      description: 'date field',
      tableConfig: {
        name: 'EventsTable',
        fields: [
          { type: 'singleLineText', name: 'Event', dbFieldName: 'col_event' },
          { type: 'date', name: 'Date', dbFieldName: 'col_date' },
        ],
      },
      updates: [
        {
          recordId: 'rec_601',
          columns: new Map([
            ['col_event', 'Meeting'],
            ['col_date', '2025-01-15T10:00:00.000Z'],
          ]),
        },
        {
          recordId: 'rec_602',
          columns: new Map([
            ['col_event', 'Conference'],
            ['col_date', '2025-02-20T14:30:00.000Z'],
          ]),
        },
      ],
    },
    {
      description: 'multipleSelect field (JSONB)',
      tableConfig: {
        name: 'TagsTable',
        fields: [
          { type: 'singleLineText', name: 'Item', dbFieldName: 'col_item' },
          { type: 'multipleSelect', name: 'Tags', dbFieldName: 'col_tags' },
        ],
      },
      updates: [
        {
          recordId: 'rec_701',
          columns: new Map([
            ['col_item', 'Product A'],
            ['col_tags', '["tag1","tag2","tag3"]'],
          ]),
        },
        {
          recordId: 'rec_702',
          columns: new Map([
            ['col_item', 'Product B'],
            ['col_tags', '["tag2","tag4"]'],
          ]),
        },
      ],
    },
    {
      description: 'single record update',
      tableConfig: {
        name: 'SingleRecordTable',
        fields: [{ type: 'singleLineText', name: 'Name', dbFieldName: 'col_name' }],
      },
      updates: [
        {
          recordId: 'rec_801',
          columns: new Map([['col_name', 'Only One']]),
        },
      ],
    },
    {
      description: 'large batch (5 records)',
      tableConfig: {
        name: 'LargeBatchTable',
        fields: [
          { type: 'singleLineText', name: 'Name', dbFieldName: 'col_name' },
          { type: 'number', name: 'Value', dbFieldName: 'col_value' },
        ],
      },
      updates: Array.from({ length: 5 }, (_, i) => ({
        recordId: `rec_90${i}`,
        columns: new Map([
          ['col_name', `Record ${i + 1}`],
          ['col_value', (i + 1) * 10],
        ]),
      })),
    },
  ];

  it.each(testCases)('generates correct SQL for: $description', ({ tableConfig, updates }) => {
    const db = createTestDb();
    const table = createTable(tableConfig);

    // Build columnUpdateData
    const columnUpdateData = new Map<string, Array<{ recordId: string; value: unknown }>>();
    for (const update of updates) {
      for (const [columnName, value] of update.columns) {
        if (!columnUpdateData.has(columnName)) {
          columnUpdateData.set(columnName, []);
        }
        columnUpdateData.get(columnName)!.push({
          recordId: update.recordId,
          value,
        });
      }
    }

    const result = buildBatchUpdateSql({
      tableName: 'bseaaaaaaaaaaaaaaaa.tblbbbbbbbbbbbbbbbb',
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
    if (result.isErr()) {
      throw new Error(`Failed to build SQL: ${result.error.message}`);
    }

    expect(result.value.sql).toMatchSnapshot();
  });

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
});
