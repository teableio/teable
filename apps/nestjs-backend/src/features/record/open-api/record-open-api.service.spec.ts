import { describe, expect, it, vi } from 'vitest';
import { RecordOpenApiService } from './record-open-api.service';

const createService = ({
  prismaService = {},
  dataPrismaService = {},
  recordService = {},
}: {
  prismaService?: unknown;
  dataPrismaService?: unknown;
  recordService?: unknown;
} = {}) =>
  new RecordOpenApiService(
    prismaService as never,
    dataPrismaService as never,
    recordService as never,
    {} as never,
    {} as never,
    { bigTransactionTimeout: 5000 } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
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
        createdTime: new Date('2026-01-01T00:00:00.000Z'),
        createdBy: 'usr1',
      },
    ]);
    const userFindMany = vi.fn().mockResolvedValue([
      {
        id: 'usr1',
        name: 'Ada',
        email: 'ada@example.com',
        avatar: null,
      },
    ]);

    const service = createService({
      prismaService: {
        recordHistory: { findMany: metaRecordHistoryFindMany },
        user: { findMany: userFindMany },
      },
      dataPrismaService: {
        recordHistory: { findMany: dataRecordHistoryFindMany },
      },
    });

    const result = await service.getRecordHistory(
      'tbl1',
      'rec1',
      {
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-02T00:00:00.000Z',
      },
      ['fld1']
    );

    expect(dataRecordHistoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tableId: 'tbl1',
          recordId: 'rec1',
          fieldId: { in: ['fld1'] },
        }),
        take: 21,
        orderBy: { createdTime: 'desc' },
      })
    );
    expect(metaRecordHistoryFindMany).not.toHaveBeenCalled();
    expect(userFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['usr1'] } },
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
        createdTime: '2026-01-01T00:00:00.000Z',
        createdBy: 'usr1',
      },
    ]);
    expect(result.userMap.usr1).toEqual({
      id: 'usr1',
      name: 'Ada',
      email: 'ada@example.com',
      avatar: null,
    });
  });
});
