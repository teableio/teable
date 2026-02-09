import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  LinkFieldConfig,
  LinkFieldMeta,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';
import { describe, expect, it } from 'vitest';

import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { RecordInsertBuilder } from './RecordInsertBuilder';

class RecordingConnection implements DatabaseConnection {
  constructor(private readonly queries: CompiledQuery[]) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(compiledQuery);
    return { rows: [] };
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [] };
  }
}

class RecordingDriver implements Driver {
  readonly queries: CompiledQuery[] = [];

  async init(): Promise<void> {
    return undefined;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new RecordingConnection(this.queries);
  }

  async beginTransaction(): Promise<void> {
    return undefined;
  }

  async commitTransaction(): Promise<void> {
    return undefined;
  }

  async rollbackTransaction(): Promise<void> {
    return undefined;
  }

  async releaseConnection(): Promise<void> {
    return undefined;
  }

  async destroy(): Promise<void> {
    return undefined;
  }

  async savepoint(): Promise<void> {
    return undefined;
  }

  async rollbackToSavepoint(): Promise<void> {
    return undefined;
  }

  async releaseSavepoint(): Promise<void> {
    return undefined;
  }
}

const createRecordingDb = () => {
  const driver = new RecordingDriver();
  const db = new Kysely<DynamicDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, driver };
};

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const FOREIGN_TABLE_ID = `tbl${'c'.repeat(16)}`;
const LOOKUP_FIELD_ID = `fld${'d'.repeat(16)}`;
const LINK_FIELD_ID = `fld${'e'.repeat(16)}`;
const SYMMETRIC_FIELD_ID = `fld${'f'.repeat(16)}`;

const buildTable = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
  const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
  const lookupFieldId = FieldId.create(LOOKUP_FIELD_ID)._unsafeUnwrap();
  const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
  const symmetricFieldId = FieldId.create(SYMMETRIC_FIELD_ID)._unsafeUnwrap();

  const linkConfig = LinkFieldConfig.create({
    relationship: 'manyMany',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: lookupFieldId.toString(),
    symmetricFieldId: symmetricFieldId.toString(),
  })._unsafeUnwrap();
  const linkMeta = LinkFieldMeta.create({ hasOrderColumn: false })._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('LinkInsertTable')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .link()
    .withId(linkFieldId)
    .withName(FieldName.create('Links')._unsafeUnwrap())
    .withConfig(linkConfig)
    .withMeta(linkMeta!)
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  table
    .getFields()[0]
    .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getFields()[1]
    .setDbFieldName(DbFieldName.rehydrate('col_links')._unsafeUnwrap())
    ._unsafeUnwrap();

  return { table, linkFieldId };
};

describe('RecordInsertBuilder', () => {
  it('omits order column when link meta hasOrderColumn is false', () => {
    const { db } = createRecordingDb();
    const { table, linkFieldId } = buildTable();
    const builder = new RecordInsertBuilder(db);

    const fieldValues = new Map<string, unknown>([
      [linkFieldId.toString(), [{ id: 'rec_one' }, { id: 'rec_two' }]],
    ]);

    const result = builder.buildInsertData({
      table,
      fieldValues,
      context: { recordId: 'rec_main', actorId: 'usr_test', now: '2025-01-01T00:00:00.000Z' },
    });

    const statements = result._unsafeUnwrap().additionalStatements.map((stmt) => stmt.compiled.sql);
    expect(statements.some((sql) => sql.includes('__order'))).toBe(false);
  });
});
