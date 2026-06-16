import { FieldKeyType, FieldType } from '@teable/core';
import Knex from 'knex';
import { vi } from 'vitest';
import { RecordService } from './record.service';

describe('RecordService', () => {
  it('queries only record IDs when resolving doc IDs for count-like callers', async () => {
    const dataKnex = Knex({ client: 'pg' });
    const queriedSql: string[] = [];
    const alias = 't_tblDocIds';
    const queryBuilder = dataKnex
      .from({ [alias]: 'bse_data.tbl_doc_ids' })
      .select(`${alias}.__id`)
      .select(
        dataKnex.raw(
          `(SELECT jsonb_build_object('id', u.id, 'title', u.name) FROM users u WHERE u.id = "${alias}"."__created_by") as "CreatedBy"`
        )
      );
    const service = Object.create(RecordService.prototype) as {
      knex: ReturnType<typeof Knex>;
      getGroupRelatedData: ReturnType<typeof vi.fn>;
      buildFilterSortQuery: ReturnType<typeof vi.fn>;
      getSearchHitIndex: ReturnType<typeof vi.fn>;
      logger: { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
      recordPermissionService: { wrapView: ReturnType<typeof vi.fn> };
      databaseRouter: { queryDataPrismaForTable: ReturnType<typeof vi.fn> };
      getDocIdsByQuery: RecordService['getDocIdsByQuery'];
    };

    service.knex = dataKnex;
    service.getGroupRelatedData = vi.fn().mockResolvedValue({
      groupPoints: [],
      allGroupHeaderRefs: [],
      filter: undefined,
    });
    service.buildFilterSortQuery = vi.fn().mockResolvedValue({
      queryBuilder,
      dbTableName: 'bse_data.tbl_doc_ids',
      alias,
    });
    service.getSearchHitIndex = vi.fn().mockResolvedValue(undefined);
    service.logger = {
      debug: vi.fn(),
      error: vi.fn(),
    };
    service.recordPermissionService = {
      wrapView: vi.fn().mockResolvedValue({
        builder: dataKnex.queryBuilder(),
        viewCte: undefined,
      }),
    };
    service.databaseRouter = {
      queryDataPrismaForTable: vi.fn(async (_tableId: string, sql: string) => {
        queriedSql.push(sql);
        return [{ __id: 'recDocId' }];
      }),
    };

    await expect(
      service.getDocIdsByQuery('tblDocIds', { skip: 0, take: 10 }, true)
    ).resolves.toMatchObject({ ids: ['recDocId'] });

    expect(queriedSql[0]).toContain(`"${alias}"."__id"`);
    expect(queriedSql[0]).not.toContain('users');

    await dataKnex.destroy();
  });

  it('writes SQL-only created record history into the routed data DB internal schema', async () => {
    const dataKnex = Knex({ client: 'pg' });
    const executedSql: string[] = [];
    const service = Object.create(RecordService.prototype) as {
      creditCheck: ReturnType<typeof vi.fn>;
      getFieldsByProjection: ReturnType<typeof vi.fn>;
      getWritableCreatedTimeFieldNames: ReturnType<typeof vi.fn>;
      cls: { get: ReturnType<typeof vi.fn> };
      dbProvider: { batchInsertSql: ReturnType<typeof vi.fn> };
      databaseRouter: {
        executeDataPrismaForTable: ReturnType<typeof vi.fn>;
        dataKnexForTable: ReturnType<typeof vi.fn>;
        getDataDatabaseUrlForTable: ReturnType<typeof vi.fn>;
      };
      createRecordsOnlySql: RecordService['createRecordsOnlySql'];
    };

    service.cls = {
      get: vi.fn((key: string) =>
        key === 'user' ? { id: 'usrImport', name: 'User', email: 'user@example.com' } : undefined
      ),
    };
    service.creditCheck = vi.fn().mockResolvedValue(undefined);
    service.getFieldsByProjection = vi.fn().mockResolvedValue([
      {
        id: 'fldText',
        name: 'Text',
        type: FieldType.SingleLineText,
        dbFieldName: 'fld_text',
        convertCellValue2DBValue: vi.fn((value) => value),
      },
    ]);
    service.getWritableCreatedTimeFieldNames = vi.fn().mockResolvedValue(new Set());
    service.dbProvider = {
      batchInsertSql: vi.fn().mockReturnValue('insert into "bse_data"."tbl_imported" values (...)'),
    };
    service.databaseRouter = {
      executeDataPrismaForTable: vi.fn(async (_tableId: string, sql: string) => {
        executedSql.push(sql);
        return 1;
      }),
      dataKnexForTable: vi.fn().mockResolvedValue(dataKnex),
      getDataDatabaseUrlForTable: vi
        .fn()
        .mockResolvedValue('postgresql://user:pass@example.test:5432/data?schema=teable_internal'),
    };

    await service.createRecordsOnlySql(
      { id: 'tblImport', dbTableName: 'bse_data.tbl_imported' } as never,
      [{ fields: { fldText: 'Imported value' } }],
      FieldKeyType.Id
    );

    expect(executedSql[0]).toContain('"bse_data"."tbl_imported"');
    expect(executedSql.some((sql) => sql.includes('"teable_internal"."record_history"'))).toBe(
      true
    );
    expect(executedSql.some((sql) => sql.includes('insert into "record_history"'))).toBe(false);

    await dataKnex.destroy();
  });
});
