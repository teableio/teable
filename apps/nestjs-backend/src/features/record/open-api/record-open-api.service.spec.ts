import { describe, expect, it, vi } from 'vitest';
import { RecordOpenApiService } from './record-open-api.service';

const userId = 'usr1';
const startDate = '2026-01-01T00:00:00.000Z';
const endDate = '2026-01-02T00:00:00.000Z';

const createService = ({
  prismaService = {},
  recordService = {},
  coldReadService = { collectHistoryRows: vi.fn().mockResolvedValue({ rows: [] }) },
}: {
  prismaService?: unknown;
  recordService?: unknown;
  coldReadService?: unknown;
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
    {} as never,
    {} as never,
    coldReadService as never
  );

describe('RecordOpenApiService', () => {
  it('should be defined', () => {
    expect(createService()).toBeDefined();
  });

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
});
