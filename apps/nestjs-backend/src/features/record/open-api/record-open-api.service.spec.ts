import { describe, expect, it, vi } from 'vitest';
import { RecordOpenApiService } from './record-open-api.service';

const userId = 'usr1';
const startDate = '2026-01-01T00:00:00.000Z';
const endDate = '2026-01-02T00:00:00.000Z';

const createService = ({
  prismaService = {},
  dataPrismaService = {},
  recordService = {},
  dataDbClientManager,
}: {
  prismaService?: unknown;
  dataPrismaService?: unknown;
  recordService?: unknown;
  dataDbClientManager?: unknown;
} = {}) =>
  new RecordOpenApiService(
    prismaService as never,
    recordService as never,
    {} as never,
    {} as never,
    { bigTransactionTimeout: 5000 } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    (dataDbClientManager ?? {
      dataPrismaForTable: vi.fn().mockResolvedValue(dataPrismaService),
    }) as never,
    {} as never
  );

describe('RecordOpenApiService', () => {
  it('should be defined', () => {
    expect(createService()).toBeDefined();
  });

  it('reads record history from the data database and user metadata from the meta database', async () => {
    const metaRecordHistoryFindMany = vi.fn();
    const dataRecordHistoryFindMany = vi.fn().mockResolvedValue([
      {
        id: 'rh1',
        recordId: 'rec1',
        fieldId: 'fld1',
        before: JSON.stringify({ meta: { type: 'singleLineText' }, data: 'old' }),
        after: JSON.stringify({ meta: { type: 'singleLineText' }, data: 'new' }),
        createdTime: new Date(startDate),
        createdBy: userId,
      },
    ]);
    const userFindMany = vi.fn().mockResolvedValue([
      {
        id: userId,
        name: 'Ada',
        email: 'ada@example.com',
        avatar: null,
      },
    ]);
    const dataPrismaForTable = vi.fn().mockResolvedValue({
      recordHistory: { findMany: dataRecordHistoryFindMany },
    });

    const service = createService({
      prismaService: {
        recordHistory: { findMany: metaRecordHistoryFindMany },
        user: { findMany: userFindMany },
      },
      dataPrismaService: {
        recordHistory: { findMany: dataRecordHistoryFindMany },
      },
      dataDbClientManager: {
        dataPrismaForTable,
      },
    });

    const result = await service.getRecordHistory('tbl1', 'rec1', {
      startDate,
      endDate,
      fieldIds: ['fld1'],
      createdByIds: [userId],
    });

    expect(dataRecordHistoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tableId: 'tbl1',
          recordId: 'rec1',
          fieldId: { in: ['fld1'] },
          createdBy: { in: [userId] },
        }),
        take: 21,
        orderBy: { createdTime: 'desc' },
      })
    );
    expect(dataPrismaForTable).toHaveBeenCalledWith('tbl1');
    expect(metaRecordHistoryFindMany).not.toHaveBeenCalled();
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
      },
    ]);
    expect(result.userMap[userId]).toEqual({
      id: userId,
      name: 'Ada',
      email: 'ada@example.com',
      avatar: null,
    });
  });

  it('keeps field filtering when selected fields are outside projection', async () => {
    const dataRecordHistoryFindMany = vi.fn().mockResolvedValue([]);
    const userFindMany = vi.fn().mockResolvedValue([]);

    const service = createService({
      prismaService: {
        user: { findMany: userFindMany },
      },
      dataPrismaService: {
        recordHistory: { findMany: dataRecordHistoryFindMany },
      },
    });

    await service.getRecordHistory(
      'tbl1',
      'rec1',
      {
        fieldIds: ['fldDenied'],
      },
      ['fldAllowed']
    );

    expect(dataRecordHistoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tableId: 'tbl1',
          recordId: 'rec1',
          fieldId: { in: [] },
        }),
      })
    );
  });
});
