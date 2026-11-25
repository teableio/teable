import { describe, expect, it, vi } from 'vitest';
import { RecordHistoryReadService } from './record-history-read.service';

const userId = 'usr1';
const startDate = '2026-01-01T00:00:00.000Z';
const endDate = '2026-01-02T00:00:00.000Z';

const createService = ({
  prismaService = {},
  attachmentCellValueService = {},
  recordStoragePresenceService = {},
  coldReadService = { collectHistoryRows: vi.fn().mockResolvedValue({ rows: [] }) },
  actorResolver = { resolve: vi.fn().mockResolvedValue({}) },
}: {
  prismaService?: unknown;
  attachmentCellValueService?: unknown;
  recordStoragePresenceService?: unknown;
  coldReadService?: unknown;
  actorResolver?: unknown;
} = {}) =>
  new RecordHistoryReadService(
    prismaService as never,
    attachmentCellValueService as never,
    coldReadService as never,
    recordStoragePresenceService as never,
    actorResolver as never
  );

describe('RecordHistoryReadService', () => {
  it('serves record history through the merged read and user metadata from the meta database', async () => {
    const collectHistoryRows = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'rh1',
          recordId: 'rec1',
          fieldId: 'fld1',
          before: JSON.stringify({ meta: { type: 'singleLineText' }, data: 'old' }),
          after: JSON.stringify({ meta: { type: 'singleLineText' }, data: 'new' }),
          createdTime: new Date(startDate),
          createdBy: userId,
        },
      ],
      nextCursor: undefined,
    });
    const userFindMany = vi.fn().mockResolvedValue([
      {
        id: userId,
        name: 'Ada',
        email: 'ada@example.com',
        avatar: null,
      },
    ]);

    const service = createService({
      prismaService: {
        user: { findMany: userFindMany },
      },
      coldReadService: { collectHistoryRows },
    });

    const result = await service.getRecordHistory('tbl1', 'rec1', {
      startDate,
      endDate,
      fieldIds: ['fld1'],
      createdByIds: [userId],
    });

    expect(collectHistoryRows).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 'tbl1',
        recordId: 'rec1',
        startDate,
        endDate,
        allowedFieldIds: ['fld1'],
        shouldFilterByField: true,
        createdByIds: [userId],
        limit: 20,
      })
    );
    expect(userFindMany).toHaveBeenCalledWith({
      where: { id: { in: [userId] } },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
      },
    });
    expect(result.historyList).toEqual([
      {
        id: 'rh1',
        tableId: 'tbl1',
        recordId: 'rec1',
        fieldId: 'fld1',
        before: { meta: { type: 'singleLineText' }, data: 'old' },
        after: { meta: { type: 'singleLineText' }, data: 'new' },
        createdTime: startDate,
        createdBy: userId,
        actorType: null,
        actorId: null,
      },
    ]);
    expect(result.userMap[userId]).toEqual({
      id: userId,
      name: 'Ada',
      email: 'ada@example.com',
      avatar: null,
    });
  });

  it('expands platform actor avatar storage keys without rewriting resolved App avatars', async () => {
    vi.stubEnv('BACKEND_STORAGE_PUBLIC_URL', 'https://avatars.example.test');
    const appAvatar = 'https://profiles.example.test/avatar.png?signature=synthetic';
    const actorMap = {
      ['user:usrMember']: { name: 'Platform Member', avatar: 'avatar/member.png' },
      ['appUser:apuMember']: { name: 'App Member', avatar: appAvatar },
      ['automation:wfFixture']: { name: 'Workflow', avatar: null },
      ['appUser:apuDeleted']: null,
    };
    const rows = [
      { actorType: 'user', actorId: 'usrMember' },
      { actorType: 'appUser', actorId: 'apuMember' },
      { actorType: 'automation', actorId: 'wfFixture' },
      { actorType: 'appUser', actorId: 'apuDeleted' },
    ].map((actor, index) => ({
      ...actor,
      id: `rhAvatar${index}`,
      recordId: 'rec1',
      fieldId: 'fld1',
      before: JSON.stringify({ meta: { type: 'singleLineText' }, data: 'before' }),
      after: JSON.stringify({ meta: { type: 'singleLineText' }, data: 'after' }),
      createdTime: new Date(startDate),
      createdBy: userId,
    }));
    const service = createService({
      prismaService: {
        user: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: userId,
              name: 'Executor',
              email: 'executor@example.test',
              avatar: 'avatar/executor.png',
            },
          ]),
        },
      },
      coldReadService: { collectHistoryRows: vi.fn().mockResolvedValue({ rows }) },
      actorResolver: { resolve: vi.fn().mockResolvedValue(actorMap) },
    });
    try {
      const result = await service.getRecordHistory('tbl1', 'rec1', {});

      expect(result.actorMap?.['user:usrMember']?.avatar).toBe(
        'https://avatars.example.test/avatar/member.png'
      );
      expect(result.actorMap?.['appUser:apuMember']?.avatar).toBe(appAvatar);
      expect(result.actorMap?.['automation:wfFixture']?.avatar).toBeNull();
      expect(result.actorMap?.['appUser:apuDeleted']).toBeNull();
      expect(result.userMap[userId].avatar).toBe(
        'https://avatars.example.test/avatar/executor.png'
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('keeps field filtering when selected fields are outside projection', async () => {
    const collectHistoryRows = vi.fn().mockResolvedValue({ rows: [], nextCursor: undefined });
    const userFindMany = vi.fn().mockResolvedValue([]);

    const service = createService({
      prismaService: {
        user: { findMany: userFindMany },
      },
      coldReadService: { collectHistoryRows },
    });

    await service.getRecordHistory(
      'tbl1',
      'rec1',
      {
        fieldIds: ['fldDenied'],
      },
      ['fldAllowed']
    );

    expect(collectHistoryRows).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 'tbl1',
        recordId: 'rec1',
        allowedFieldIds: [],
        shouldFilterByField: true,
      })
    );
  });

  it('keeps cold markers intact while signing complete attachments and returning the merged cursor', async () => {
    const attachment = { token: 'token1', path: 'path1', mimetype: 'image/png', name: 'photo' };
    const signedAttachment = { ...attachment, presignedUrl: 'https://storage.example/photo' };
    const getAttachmentPresignedCellValue = vi.fn().mockResolvedValue([signedAttachment]);
    const collectHistoryRows = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'rhCold',
          recordId: 'rec1',
          fieldId: 'fldAttachment',
          before: JSON.stringify({
            meta: { type: 'attachment' },
            data: 'too large',
            coldTruncated: true,
          }),
          after: JSON.stringify({ meta: { type: 'attachment' }, data: [attachment] }),
          createdTime: new Date(startDate),
          createdBy: userId,
        },
      ],
      nextCursor: 'merged-next',
    });
    const service = createService({
      prismaService: { user: { findMany: vi.fn().mockResolvedValue([]) } },
      attachmentCellValueService: { getAttachmentPresignedCellValue },
      coldReadService: { collectHistoryRows },
    });

    const result = await service.getRecordHistory('tbl1', undefined, { cursor: 'merged-before' });

    expect(collectHistoryRows).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'merged-before' })
    );
    expect(getAttachmentPresignedCellValue).toHaveBeenCalledExactlyOnceWith([attachment]);
    expect(result.historyList[0].before).toEqual({
      meta: { type: 'attachment' },
      data: 'too large',
      coldTruncated: true,
    });
    expect(result.historyList[0].after.data).toEqual([signedAttachment]);
    expect(result.nextCursor).toBe('merged-next');
  });

  it.each([
    {
      field: {
        name: 'Imported',
        type: 'number',
        cellValueType: 'number',
        options: '{}',
        isLookup: null,
      },
      meta: { name: 'Imported', type: 'number', cellValueType: 'number', options: {} },
    },
    {
      field: null,
      meta: {
        name: 'fldImport',
        type: 'singleLineText',
        cellValueType: 'string',
        options: undefined,
      },
    },
  ])(
    'synthesizes missing import metadata once per field, including removed fields: $field',
    async ({ field, meta }) => {
      const findFirst = vi.fn().mockResolvedValue(field);
      const service = createService({
        prismaService: { field: { findFirst }, user: { findMany: vi.fn().mockResolvedValue([]) } },
        coldReadService: {
          collectHistoryRows: vi.fn().mockResolvedValue({
            rows: [1, 2].map((id) => ({
              id: `rh${id}`,
              recordId: 'rec1',
              fieldId: 'fldImport',
              before: JSON.stringify({ data: null }),
              after: JSON.stringify({ data: 42 }),
              createdTime: new Date(startDate),
              createdBy: userId,
            })),
          }),
        },
      });

      const result = await service.getRecordHistory('tbl1', 'rec1', {});

      expect(findFirst).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'fldImport' },
        select: { name: true, type: true, cellValueType: true, isLookup: true, options: true },
      });
      for (const item of result.historyList) {
        expect(item.before.meta).toEqual(meta);
        expect(item.after.meta).toEqual(meta);
      }
    }
  );

  it.each(['live', 'missing', 'probe-failed', 'deleted-table'])(
    'annotates deleted links from storage presence without confusing unreadable live records: %s',
    async (scenario) => {
      const getExistingRecordIds =
        scenario === 'probe-failed'
          ? vi.fn().mockRejectedValue(new Error('storage unavailable'))
          : vi.fn().mockResolvedValue(new Set(scenario === 'live' ? ['recForeign'] : []));
      const findMany = vi
        .fn()
        .mockResolvedValue([
          { id: 'fldLink', options: JSON.stringify({ foreignTableId: 'tblForeign' }) },
        ]);
      const service = createService({
        prismaService: {
          field: { findMany },
          tableMeta: {
            findMany: vi
              .fn()
              .mockResolvedValue(scenario === 'deleted-table' ? [] : [{ id: 'tblForeign' }]),
          },
          user: { findMany: vi.fn().mockResolvedValue([]) },
        },
        recordStoragePresenceService: { getExistingRecordIds },
        coldReadService: {
          collectHistoryRows: vi.fn().mockResolvedValue({
            rows: [
              {
                id: 'rhLink',
                recordId: 'rec1',
                fieldId: 'fldLink',
                before: JSON.stringify({
                  meta: { type: 'link', options: null },
                  data: { id: 'recForeign', title: 'Historical title' },
                }),
                after: JSON.stringify({
                  meta: { type: 'link', options: { foreignTableId: 'tblForeign' } },
                  data: [{ id: 'recForeign', title: 'Historical title' }],
                }),
                createdTime: new Date(startDate),
                createdBy: userId,
              },
            ],
          }),
        },
      });

      const result = await service.getRecordHistory('tbl1', 'rec1', {});

      expect(findMany).toHaveBeenCalledWith({
        where: { id: { in: ['fldLink'] } },
        select: { id: true, options: true },
      });
      if (scenario === 'deleted-table') expect(getExistingRecordIds).not.toHaveBeenCalled();
      else
        expect(getExistingRecordIds).toHaveBeenCalledExactlyOnceWith('tblForeign', ['recForeign']);
      const expectedDeleted =
        scenario === 'missing' || scenario === 'deleted-table' ? ['recForeign'] : undefined;
      expect(result.historyList[0].before.deletedRecordIds).toEqual(expectedDeleted);
      expect(result.historyList[0].after.deletedRecordIds).toEqual(expectedDeleted);
      expect(result.historyList[0].before.data).toEqual({
        id: 'recForeign',
        title: 'Historical title',
      });
    }
  );
});
