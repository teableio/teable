import { CellValueType, DbFieldType, FieldKeyType, FieldType } from '@teable/core';
import type { IFieldVo } from '@teable/core';
import Knex from 'knex';
import { vi } from 'vitest';
import { RecordService } from './record.service';

const { captureException, sentryScope, withScope } = vi.hoisted(() => {
  const sentryScope = {
    setContext: vi.fn(),
    setLevel: vi.fn(),
    setTag: vi.fn(),
  };
  return {
    captureException: vi.fn(),
    sentryScope,
    withScope: vi.fn((callback: (scope: typeof sentryScope) => void) => callback(sentryScope)),
  };
});

vi.mock('@sentry/nestjs', () => ({
  captureException,
  withScope,
}));

describe('RecordService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('excludes pending fields from snapshot projections while keeping errored fields readable', async () => {
    const createTextField = (id: string, overrides: Partial<IFieldVo> = {}): IFieldVo => ({
      id,
      name: id,
      type: FieldType.SingleLineText,
      dbFieldName: id,
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
      options: JSON.stringify({}) as IFieldVo['options'],
      ...overrides,
    });
    const service = Object.create(RecordService.prototype) as {
      dataLoaderService: { field: { load: ReturnType<typeof vi.fn> } };
      getFieldsByProjection: RecordService['getFieldsByProjection'];
    };

    service.dataLoaderService = {
      field: {
        load: vi.fn().mockResolvedValue([
          createTextField('fldReadable'),
          createTextField('fldBroken', { hasError: true }),
          createTextField('fldPending', { isPending: true }),
        ]),
      },
    };

    const fields = await service.getFieldsByProjection(
      'tblSnapshot',
      {
        fldReadable: true,
        fldBroken: true,
        fldPending: true,
      },
      FieldKeyType.Id,
      { skipUnavailableFields: true }
    );

    expect(fields.map((field) => field.id)).toEqual(['fldReadable', 'fldBroken']);
  });

  it('presigns a single attachment object from lookup snapshots', async () => {
    const service = Object.create(RecordService.prototype) as {
      cacheService: { getMany: ReturnType<typeof vi.fn> };
      prismaService: { attachments: { findMany: ReturnType<typeof vi.fn> } };
      attachmentStorageService: {
        getPreviewUrlByPath: ReturnType<typeof vi.fn>;
        getTableThumbnailUrl: ReturnType<typeof vi.fn>;
      };
      recordsPresignedUrl: (
        records: never,
        fields: never,
        fieldKeyType: FieldKeyType
      ) => Promise<Array<{ data: { fields: Record<string, unknown> } }>>;
    };
    const attachment = {
      id: 'actSingleAttachment',
      name: 'image.png',
      path: 'table/image-token',
      size: 1024,
      token: 'image-token',
      width: 100,
      height: 100,
      mimetype: 'image/png',
    };

    service.cacheService = {
      getMany: vi.fn().mockResolvedValue([]),
    };
    service.prismaService = {
      attachments: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    service.attachmentStorageService = {
      getPreviewUrlByPath: vi.fn().mockResolvedValue('https://example.test/image-token'),
      getTableThumbnailUrl: vi.fn(),
    };

    const records = [
      {
        id: 'rec1',
        v: 1,
        type: 'json0',
        data: {
          fields: {
            fldAttachment: attachment,
          },
        },
      },
    ];
    const fields = [{ id: 'fldAttachment', type: FieldType.Attachment }];

    const result = await service.recordsPresignedUrl(
      records as never,
      fields as never,
      FieldKeyType.Id
    );

    expect(result[0]!.data.fields.fldAttachment).toEqual([
      expect.objectContaining({
        ...attachment,
        presignedUrl: 'https://example.test/image-token',
        smThumbnailUrl: 'https://example.test/image-token',
        lgThumbnailUrl: 'https://example.test/image-token',
      }),
    ]);
  });

  it('captures attachment snapshot presign failures with table and field context', async () => {
    const service = Object.create(RecordService.prototype) as {
      cacheService: { getMany: ReturnType<typeof vi.fn> };
      logger: { error: ReturnType<typeof vi.fn> };
      recordsPresignedUrl: (
        records: never,
        fields: never,
        fieldKeyType: FieldKeyType,
        context: never
      ) => Promise<Array<{ data: { fields: Record<string, unknown> } }>>;
    };

    service.cacheService = {
      getMany: vi.fn().mockResolvedValue([]),
    };
    service.logger = {
      error: vi.fn(),
    };

    await expect(
      service.recordsPresignedUrl(
        [
          {
            id: 'recBrokenAttachment',
            v: 1,
            type: 'json0',
            data: {
              fields: {
                fldAttachment: {
                  token: 'attachment-token',
                },
              },
            },
          },
        ] as never,
        [
          {
            id: 'fldAttachment',
            dbFieldName: 'attachment_db_field',
            name: 'Attachment',
            type: FieldType.Attachment,
          },
        ] as never,
        FieldKeyType.Id,
        {
          tableId: 'tblSnapshot',
          fieldKeyType: FieldKeyType.Id,
          useQueryModel: true,
          recordIds: ['recBrokenAttachment'],
        } as never
      )
    ).rejects.toThrow();

    expect(service.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 'tblSnapshot',
        useQueryModel: true,
        valueShapes: [
          expect.objectContaining({
            fieldId: 'fldAttachment',
            hasMimetype: false,
            hasToken: true,
            recordId: 'recBrokenAttachment',
          }),
        ],
      }),
      expect.any(String)
    );
    expect(withScope).toHaveBeenCalledTimes(1);
    expect(sentryScope.setTag).toHaveBeenCalledWith('feature', 'record-snapshot-presigned-url');
    expect(sentryScope.setTag).toHaveBeenCalledWith('teable.version', 'v2');
    expect(sentryScope.setTag).toHaveBeenCalledWith('table.id', 'tblSnapshot');
    expect(sentryScope.setContext).toHaveBeenCalledWith(
      'record_snapshot_presigned_url',
      expect.objectContaining({
        tableId: 'tblSnapshot',
        attachmentFields: [
          expect.objectContaining({
            id: 'fldAttachment',
            fieldKey: 'fldAttachment',
          }),
        ],
      })
    );
    expect(captureException).toHaveBeenCalledWith(expect.any(TypeError), {
      mechanism: { handled: true, type: 'record.snapshot.presigned_url' },
    });
  });

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
