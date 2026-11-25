import { CellValueType, DbFieldType, FieldKeyType, FieldType } from '@teable/core';
import type { IFieldVo } from '@teable/core';
import Knex from 'knex';
import { vi } from 'vitest';
import { AttachmentCellValueService } from '../attachments/attachment-cell-value.service';
import { RecordActorResolverService } from '../record-attribution/record-actor-resolver.service';
import { RecordMutationPolicyService } from '../record-mutation-policy/record-mutation-policy.service';
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

  it('hydrates selected user cells without losing positions, duplicates or stored metadata', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'usrOne', name: 'Current One', email: 'one@example.test' },
      { id: 'usrTwo', name: 'Current Two', email: 'two@example.test' },
    ]);
    const service = Object.create(RecordService.prototype) as RecordService;
    Object.assign(service, { prismaService: { txClient: () => ({ user: { findMany } }) } });
    const records = [
      {
        fields: {
          fldUser: [
            null,
            { id: 'usrOne' },
            { id: 'usrOne', title: 'usrOne' },
            { id: 'usrTwo', title: 'Historical Two', email: 'old@example.test' },
            null,
          ],
          fldHidden: [{ id: 'usrHidden' }],
        },
      },
    ];
    await service.hydrateSelectedUserCells('tblSelected', records, [
      { id: 'fldUser', type: FieldType.User },
      { id: 'fldHidden', type: FieldType.User, isLookup: true },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['usrOne'] } },
      select: { id: true, name: true, email: true },
    });
    expect(records[0]!.fields).toEqual({
      fldUser: [
        null,
        { id: 'usrOne', title: 'Current One', email: 'one@example.test' },
        { id: 'usrOne', title: 'Current One', email: 'one@example.test' },
        { id: 'usrTwo', title: 'Historical Two', email: 'old@example.test' },
        null,
      ],
      fldHidden: [{ id: 'usrHidden' }],
    });
  });

  it.each([
    ['tblBusiness', true, 'Authorized profile'],
    ['tblBusiness', false, 'apu_private'],
    ['tblOtherBase', true, 'apu_private'],
  ] as const)(
    'scopes App cell presentation for table=%s profileRead=%s',
    async (tableId, canReadProfile, title) => {
      const principalId = 'apu_private';
      const actorKey = `appUser:${principalId}`;
      const identityEmail = 'private-identity@example.test';
      const appUserFindMany = vi
        .fn()
        .mockResolvedValue([{ id: principalId, email: identityEmail }]);
      const profiles = {
        resolve: vi.fn(async (baseId: string) => {
          const actors: Record<string, { name: string; avatar: null }> = {};
          if (baseId === 'bseAllowed' && canReadProfile) {
            actors[actorKey] = { name: 'Authorized profile', avatar: null };
          }
          return actors;
        }),
      };
      const resolver = new RecordActorResolverService(
        {
          tableMeta: {
            findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({
              baseId: where.id === 'tblBusiness' ? 'bseAllowed' : 'bseOther',
            })),
          },
        } as never,
        profiles
      );
      const service = Object.create(RecordService.prototype) as RecordService;
      Object.assign(service, {
        prismaService: { txClient: () => ({ appUser: { findMany: appUserFindMany } }) },
        recordActorResolver: resolver,
      });
      const records = [
        {
          fields: {
            fldSelected: [
              null,
              {
                id: principalId,
                title: identityEmail,
                email: identityEmail,
                avatarUrl: 'private-avatar',
              },
              { id: principalId, title: principalId },
            ],
            fldUntouched: 'unchanged',
          },
        },
      ];
      await service.hydrateSelectedUserCells(tableId, records, [
        { id: 'fldSelected', type: FieldType.User },
      ]);
      expect(records[0].fields).toEqual({
        fldSelected: [null, { id: principalId, title }, { id: principalId, title }],
        fldUntouched: 'unchanged',
      });
      expect(profiles.resolve).toHaveBeenCalledWith(
        tableId === 'tblBusiness' ? 'bseAllowed' : 'bseOther',
        [{ type: 'appUser', id: principalId }]
      );
      expect(appUserFindMany).not.toHaveBeenCalled();
      expect(JSON.stringify(records[0].fields.fldSelected)).not.toContain(identityEmail);
    }
  );

  it.each([true, false])(
    'returns the existing hydrated single-record projection with permission=%s',
    async (withPermission) => {
      const service = Object.create(RecordService.prototype) as RecordService;
      const record = {
        id: 'recSelected',
        fields: { fldTracked: { id: 'apuEarlier', title: 'Earlier initiator' } },
        lastModifiedByActorType: 'appUser',
        lastModifiedByActorId: 'apuLatest',
      };
      const getSnapshotBulk = vi.fn().mockResolvedValue([{ data: record }]);
      const getSnapshotBulkWithPermission = vi.fn().mockResolvedValue([{ data: record }]);
      Object.assign(service, { getSnapshotBulk, getSnapshotBulkWithPermission });
      const actual = await service.getRecord(
        'tblSelected',
        record.id,
        { projection: ['fldTracked'], fieldKeyType: FieldKeyType.Id },
        withPermission
      );
      expect(actual).toBe(record);
      expect(actual.fields).toEqual({
        fldTracked: { id: 'apuEarlier', title: 'Earlier initiator' },
      });
      const selectedReader = withPermission ? getSnapshotBulkWithPermission : getSnapshotBulk;
      expect(selectedReader).toHaveBeenCalledWith(
        'tblSelected',
        ['recSelected'],
        { fldTracked: true },
        FieldKeyType.Id,
        undefined,
        false
      );
      expect(
        withPermission ? getSnapshotBulk : getSnapshotBulkWithPermission
      ).not.toHaveBeenCalled();
    }
  );

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
        load: vi
          .fn()
          .mockResolvedValue([
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
      attachmentCellValueService: AttachmentCellValueService;
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
    service.attachmentCellValueService = new AttachmentCellValueService({
      getPreviewUrlByPath: vi.fn().mockResolvedValue('https://example.test/image-token'),
      getTableThumbnailUrl: vi.fn(),
    } as never);

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
      attachmentCellValueService: AttachmentCellValueService;
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
    const presignError = new TypeError('Attachment storage unavailable');
    service.attachmentCellValueService = new AttachmentCellValueService({
      getPreviewUrlByPath: vi.fn().mockRejectedValue(presignError),
      getTableThumbnailUrl: vi.fn(),
    } as never);

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
                  path: '/table/attachment-token.txt',
                  mimetype: 'text/plain',
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
    ).rejects.toBe(presignError);

    expect(service.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 'tblSnapshot',
        useQueryModel: true,
        valueShapes: [
          expect.objectContaining({
            fieldId: 'fldAttachment',
            hasMimetype: true,
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
    expect(captureException).toHaveBeenCalledWith(presignError, {
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

  it('rejects deletion and does not publish document operations when transactional audit persistence fails', async () => {
    const knex = Knex({ client: 'pg' });
    const auditError = new Error('audit outbox unavailable');
    const rawOps = { ['record_tblDelete']: {} };
    const publishRawOps = vi.fn();
    const executeDataPrismaForTable = vi.fn(() => {
      throw new Error('Root executor must not delete');
    });
    const transactionExecute = vi.fn().mockResolvedValue(1);
    let transactionRolledBack = false;
    const persistRecordOperationAudit = vi.fn().mockRejectedValue(auditError);
    const service = Object.create(RecordService.prototype) as RecordService;
    Object.assign(service, {
      recordMutationPolicy: new RecordMutationPolicyService(),
      knex,
      recordActorStorageService: {
        withTableWrite: async (_id: string, action: (meta: unknown) => Promise<unknown>) =>
          action({ id: 'tblDelete', dbTableName: 'base.records', actorStorageVersion: 1 }),
      },
      databaseRouter: {
        queryDataPrismaForTable: vi.fn(() => {
          throw new Error('Root executor must not read transaction versions');
        }),
        executeDataPrismaForTable,
        dataPrismaTransactionForTable: async (
          _id: string,
          action: (tx: unknown) => Promise<unknown>
        ) => {
          try {
            return await action({
              $queryRawUnsafe: async () => [{ id: 'recDelete', version: 3 }],
              $executeRawUnsafe: transactionExecute,
            });
          } catch (error) {
            transactionRolledBack = true;
            throw error;
          }
        },
      },
      rawOpStagingService: { saveRawOps: vi.fn().mockReturnValue(rawOps), publishRawOps },
      eventEmitterService: { persistRecordOperationAudit },
    });
    await expect(service.batchDeleteRecords('tblDelete', ['recDelete'])).rejects.toBe(auditError);
    expect(transactionRolledBack).toBe(true);
    expect(transactionExecute).toHaveBeenCalledWith(expect.stringContaining('delete from'));
    expect(executeDataPrismaForTable).not.toHaveBeenCalled();
    expect(persistRecordOperationAudit).toHaveBeenCalledWith([rawOps], expect.any(Function));
    expect(publishRawOps).not.toHaveBeenCalled();
    await knex.destroy();
  });
});
