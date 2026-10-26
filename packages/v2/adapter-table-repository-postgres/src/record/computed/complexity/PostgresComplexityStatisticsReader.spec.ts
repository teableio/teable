import {
  BaseId,
  DbFieldName,
  DbTableName,
  FieldId,
  FieldName,
  NumberField,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { describe, expect, it } from 'vitest';

import { PostgresComplexityStatisticsReader } from './PostgresComplexityStatisticsReader';

type QueryRows = ReadonlyArray<unknown>;
type RowsByTable = Record<string, { table: QueryRows; fields: QueryRows }>;

/**
 * The reader loads tables with bounded concurrency, so a FIFO queue is not a
 * deterministic fake. Route each compiled query by table name instead.
 */
const createDb = (rowsByTable: RowsByTable) => {
  const connection = {
    executeQuery: async (query: { sql: string; parameters: ReadonlyArray<unknown> }) => {
      const physicalTable = String(query.parameters[1] ?? '');
      const rows = rowsByTable[physicalTable] ?? { table: [], fields: [] };
      return {
        rows: query.sql.includes('FROM pg_stats') ? rows.fields : rows.table,
        numAffectedRows: 0n,
      };
    },
    streamQuery: () => {
      throw new Error('streaming not supported');
    },
  };
  const driver = {
    init: async () => undefined,
    acquireConnection: async () => connection,
    beginTransaction: async () => undefined,
    commitTransaction: async () => undefined,
    rollbackTransaction: async () => undefined,
    releaseConnection: async () => undefined,
    destroy: async () => undefined,
  };
  const dialect = {
    createDriver: () => driver,
    createQueryCompiler: () => new PostgresQueryCompiler(),
    createAdapter: () => new PostgresAdapter(),
    createIntrospector: (db: Kysely<never>) => new PostgresIntrospector(db),
  };
  return new Kysely({ dialect: dialect as never });
};

const tableStats = (
  rowCount: string | null,
  relpages: string | null = '10'
): QueryRows => [{ row_count: rowCount, relpages, last_analyze: null }];
const fieldStats = (
  attname: string,
  nDistinct: string,
  nullFrac = '0'
): QueryRows => [{ attname, n_distinct: nDistinct, null_frac: nullFrac, avg_width: '8' }];

const tableId = TableId.create(`tbl${'d'.repeat(16)}`)._unsafeUnwrap();
const baseId = BaseId.create(`bse${'d'.repeat(16)}`)._unsafeUnwrap();
const fieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();

const createTable = () => {
  const field = NumberField.create({
    id: fieldId,
    name: FieldName.create('Name')._unsafeUnwrap(),
  })._unsafeUnwrap();
  field.setDbFieldName(DbFieldName.rehydrate('name')._unsafeUnwrap())._unsafeUnwrap();
  return Table.rehydrate({
    id: tableId,
    baseId,
    name: TableName.create('Users')._unsafeUnwrap(),
    dbTableName: DbTableName.rehydrate('test_base.users')._unsafeUnwrap(),
    primaryFieldId: fieldId,
    fields: [field],
    views: [],
  })._unsafeUnwrap();
};

describe('PostgresComplexityStatisticsReader', () => {
  it('maps catalog and pg_stats aggregates without MCV/raw values', async () => {
    const db = createDb({
      users: {
        table: [
          { row_count: '100', relpages: '10', last_analyze: '2026-10-24T00:00:00.000Z' },
        ],
        fields: [{ attname: 'name', n_distinct: '-0.5', null_frac: '0.1', avg_width: '20' }],
      },
    });
    const reader = new PostgresComplexityStatisticsReader(db as never);

    const result = await reader.collect({} as never, createTable(), {
      includeLinkFanout: false,
    });

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    const snapshot = result._unsafeUnwrap();
    expect(snapshot).toMatchObject({
      tableId: tableId.toString(),
      rowCount: 100,
      avgRowBytes: 819.2,
      lastAnalyzeAt: '2026-10-24T00:00:00.000Z',
      source: 'pg_catalog',
      completeness: 'complete',
      confidence: 'high',
      links: [],
    });
    expect(snapshot.fields).toEqual([
      {
        fieldId: fieldId.toString(),
        nDistinct: 50,
        nullFraction: 0.1,
        avgWidth: 20,
        avgInputRows: null,
      },
    ]);
    await db.destroy();
  });

  it('keeps unknown row counts null rather than inventing zero', async () => {
    const db = createDb({ users: { table: tableStats(null, null), fields: [] } });
    const reader = new PostgresComplexityStatisticsReader(db as never);

    const snapshot = (
      await reader.collect({} as never, createTable(), { includeLinkFanout: false })
    )._unsafeUnwrap();

    expect(snapshot.rowCount).toBeNull();
    expect(snapshot.avgRowBytes).toBeNull();
    expect(snapshot.completeness).toBe('partial');
    expect(snapshot.confidence).toBe('low');
    expect(snapshot.warnings).toContain('row-count-unknown');
  });

  it('emits reverse-direction link fanout for a many-one host link', async () => {
    const hostId = TableId.create(`tbl${'e'.repeat(16)}`)._unsafeUnwrap();
    const linkId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
    const foreign = createTable();
    const host = {
      id: () => ({ toString: () => hostId.toString() }),
      dbTableName: () => ({
        isErr: () => false,
        value: { value: () => ({ isErr: () => false, value: 'test_base.a' }) },
      }),
      getFields: () => [
        {
          id: () => ({ toString: () => linkId.toString() }),
          type: () => ({ toString: () => 'link' }),
          dbFieldName: () => ({
            isErr: () => false,
            value: { value: () => ({ isErr: () => false, value: 'b_link' }) },
          }),
          relationship: () => ({ toString: () => 'manyOne' }),
          foreignTableId: () => ({ toString: () => tableId.toString() }),
          fkHostTableNameString: () => ({ isOk: () => true, value: 'test_base.a_b_link' }),
        },
      ],
    } as never;
    const db = createDb({
      a: { table: tableStats('100'), fields: fieldStats('b_link', '-0.25') },
      users: { table: tableStats('25', '5'), fields: [] },
    });
    const reader = new PostgresComplexityStatisticsReader(db as never);

    const snapshot = (await reader.collectMany({} as never, [host, foreign]))._unsafeUnwrap();
    const related = snapshot.relatedTables?.find((table) => table.tableId === tableId.toString());

    expect(related?.links).toEqual([
      expect.objectContaining({
        fromTableId: tableId.toString(),
        toTableId: hostId.toString(),
        linkFieldId: linkId.toString(),
        mean: 4,
        method: 'catalog',
      }),
    ]);
    await db.destroy();
  });

  it('keeps oneOne mean null when the target denominator is missing', async () => {
    const hostId = TableId.create(`tbl${'f'.repeat(16)}`)._unsafeUnwrap();
    const linkId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
    const host = {
      id: () => ({ toString: () => hostId.toString() }),
      dbTableName: () => ({
        isErr: () => false,
        value: { value: () => ({ isErr: () => false, value: 'test_base.a' }) },
      }),
      getFields: () => [
        {
          id: () => ({ toString: () => linkId.toString() }),
          type: () => ({ toString: () => 'link' }),
          dbFieldName: () => ({
            isErr: () => false,
            value: { value: () => ({ isErr: () => false, value: 'b_link' }) },
          }),
          relationship: () => ({ toString: () => 'oneOne' }),
          foreignTableId: () => ({ toString: () => tableId.toString() }),
          fkHostTableNameString: () => ({ isOk: () => false }),
        },
      ],
    } as never;
    const db = createDb({
      a: { table: tableStats('100'), fields: fieldStats('b_link', '-0.25') },
    });
    const reader = new PostgresComplexityStatisticsReader(db as never);

    const snapshot = (await reader.collectMany({} as never, [host]))._unsafeUnwrap();
    expect(snapshot.links[0]).toMatchObject({
      fromTableId: tableId.toString(),
      toTableId: hostId.toString(),
      mean: null,
    });
    expect(snapshot.links[0]?.warnings).toContain('link-one-one-missing-denominator');
    await db.destroy();
  });
});
