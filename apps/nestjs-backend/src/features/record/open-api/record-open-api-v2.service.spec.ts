import { CellValueType, FieldKeyType, FieldType, SortFunc, TimeFormatting } from '@teable/core';
import {
  ListTableRecordsQuery,
  ListTableRecordsResult,
  UpdateRecordsResult,
  v2CoreTokens,
} from '@teable/v2-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecordOpenApiV2Service } from './record-open-api-v2.service';

describe('RecordOpenApiV2Service', () => {
  const createdTimeIso = '2026-03-19T01:02:03.000Z';
  const getDocIdsByQuery = vi.fn();
  const getSnapshotBulkWithPermission = vi.fn();
  const createContext = vi.fn();
  const getReadQuerySource = vi.fn();
  const getFieldsByQuery = vi.fn();
  const execute = vi.fn();
  const commandExecute = vi.fn();
  const resolve = vi.fn();
  const getContainer = vi.fn();
  const clsGet = vi.fn();
  const cacheDel = vi.fn();
  const cacheSetDetail = vi.fn();

  let service: RecordOpenApiV2Service;

  beforeEach(() => {
    vi.clearAllMocks();

    resolve.mockImplementation((token) => {
      if (token === v2CoreTokens.queryBus) {
        return { execute };
      }
      if (token === v2CoreTokens.commandBus) {
        return { execute: commandExecute };
      }
      return undefined;
    });
    getContainer.mockResolvedValue({ resolve });
    createContext.mockResolvedValue({});
    clsGet.mockImplementation((key: string) => {
      if (key === 'user.id') {
        return `usr${'h'.repeat(16)}`;
      }
      if (key === 'windowId') {
        return `win${'i'.repeat(16)}`;
      }
      return undefined;
    });
    getReadQuerySource.mockResolvedValue(undefined);
    getFieldsByQuery.mockResolvedValue([]);
    commandExecute.mockResolvedValue({
      isErr: () => false,
      value: UpdateRecordsResult.create(2, []),
    });
    execute.mockResolvedValue({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          { id: 'rec1111111111111111', fields: {}, version: 1 },
          { id: 'rec2222222222222222', fields: {}, version: 1 },
        ],
        2,
        0,
        2
      ),
    });
    getSnapshotBulkWithPermission.mockResolvedValue([
      { data: { id: 'rec1111111111111111', fields: {} } },
      { data: { id: 'rec2222222222222222', fields: {} } },
    ]);
    service = new RecordOpenApiV2Service(
      { getContainer } as never,
      { createContext } as never,
      { getDocIdsByQuery, getSnapshotBulkWithPermission } as never,
      {} as never,
      { get: clsGet } as never,
      { del: cacheDel, setDetail: cacheSetDetail } as never,
      { getFieldsByQuery } as never,
      { getReadQuerySource } as never,
      {} as never,
      {} as never
    );
  });

  it('should ignore unreadable fields in orderBy and groupBy', () => {
    const query = {
      orderBy: [
        { fieldId: 'fldReadable', order: SortFunc.Asc },
        { fieldId: 'fldHidden', order: SortFunc.Desc },
      ],
      groupBy: [
        { fieldId: 'fldHidden', order: SortFunc.Asc },
        { fieldId: 'fldReadable', order: SortFunc.Desc },
      ],
    };

    expect(
      (
        service as unknown as {
          sanitizeReadableSortAndGroup: (
            input: typeof query,
            enabledFieldIds?: string[]
          ) => typeof query;
        }
      ).sanitizeReadableSortAndGroup(query, ['fldReadable'])
    ).toEqual({
      orderBy: [{ fieldId: 'fldReadable', order: SortFunc.Asc }],
      groupBy: [{ fieldId: 'fldReadable', order: SortFunc.Desc }],
    });
  });

  it('should keep orderBy and groupBy unchanged when all fields are readable', () => {
    const query = {
      orderBy: [{ fieldId: 'fldReadable', order: SortFunc.Asc }],
      groupBy: [{ fieldId: 'fldReadable', order: SortFunc.Desc }],
    };

    expect(
      (
        service as unknown as {
          sanitizeReadableSortAndGroup: (
            input: typeof query,
            enabledFieldIds?: string[]
          ) => typeof query;
        }
      ).sanitizeReadableSortAndGroup(query, ['fldReadable'])
    ).toEqual(query);
  });

  it('forwards advanced link filters into the v2 query handler instead of using docIds fallback', async () => {
    const filterLinkCellCandidate: [string, string] = [
      `fld${'d'.repeat(16)}`,
      `rec${'e'.repeat(16)}`,
    ];
    const selectedRecordIds = [`rec${'f'.repeat(16)}`];
    const viewId = `viw${'g'.repeat(16)}`;

    const result = await service.getRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Id,
      filterLinkCellCandidate,
      selectedRecordIds,
      skip: 0,
      take: 2,
      viewId,
      ignoreViewQuery: true,
    });

    expect(getDocIdsByQuery).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);

    const query = execute.mock.calls[0]?.[1];
    expect(query).toBeInstanceOf(ListTableRecordsQuery);
    expect((query as ListTableRecordsQuery).filterLinkCellCandidate).toEqual(
      filterLinkCellCandidate
    );
    expect((query as ListTableRecordsQuery).selectedRecordIds).toEqual(selectedRecordIds);
    expect((query as ListTableRecordsQuery).viewId).toBe(viewId);
    expect((query as ListTableRecordsQuery).ignoreViewQuery).toBe(true);
    expect(getReadQuerySource).toHaveBeenCalledWith(`tbl${'c'.repeat(16)}`, {
      viewId,
      keepPrimaryKey: false,
    });

    expect(result.records).toEqual([
      { id: 'rec1111111111111111', fields: {} },
      { id: 'rec2222222222222222', fields: {} },
    ]);
  });

  it('formats sorted top-level system datetime fields in the final OpenAPI response', async () => {
    execute.mockResolvedValue({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [{ id: 'rec1111111111111111', fields: {}, version: 1 }],
        1,
        0,
        1
      ),
    });
    getSnapshotBulkWithPermission.mockResolvedValue([
      {
        data: {
          id: 'rec1111111111111111',
          createdTime: createdTimeIso,
          fields: {
            createdTime: createdTimeIso,
          },
        },
      },
    ]);
    getFieldsByQuery.mockResolvedValue([
      {
        id: 'fldCreatedTime0001',
        name: 'createdTime',
        type: FieldType.CreatedTime,
        cellValueType: CellValueType.DateTime,
        isMultipleCellValue: false,
        dbFieldType: 'timestamp',
        options: {
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'None',
            timeZone: 'UTC',
          },
        },
      },
    ]);

    const result = await service.getRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Name,
      skip: 0,
      take: 1,
      orderBy: [{ fieldId: 'fldCreatedTime0001', order: SortFunc.Asc }],
    });

    expect(result.records).toEqual([
      {
        id: 'rec1111111111111111',
        createdTime: '2026-03-19',
        fields: {
          createdTime: '2026-03-19T01:02:03.000Z',
        },
      },
    ]);
  });

  it('does not normalize system datetime fields when they are not part of the active sort', async () => {
    execute.mockResolvedValue({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [{ id: 'rec1111111111111111', fields: {}, version: 1 }],
        1,
        0,
        1
      ),
    });
    getSnapshotBulkWithPermission.mockResolvedValue([
      {
        data: {
          id: 'rec1111111111111111',
          createdTime: createdTimeIso,
          fields: {
            createdTime: createdTimeIso,
          },
        },
      },
    ]);
    getFieldsByQuery.mockResolvedValue([
      {
        id: 'fldCreatedTime0001',
        name: 'createdTime',
        type: FieldType.CreatedTime,
        cellValueType: CellValueType.DateTime,
        isMultipleCellValue: false,
        dbFieldType: 'timestamp',
        options: {
          formatting: {
            date: 'YYYY-MM-DD',
            time: TimeFormatting.None,
            timeZone: 'UTC',
          },
        },
      },
    ]);

    const result = await service.getRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Name,
      skip: 0,
      take: 1,
    });

    expect(result.records).toEqual([
      {
        id: 'rec1111111111111111',
        createdTime: createdTimeIso,
        fields: {
          createdTime: createdTimeIso,
        },
      },
    ]);
  });

  it('routes explicit batch field updates through native v2 updateRecords', async () => {
    getSnapshotBulkWithPermission.mockResolvedValue([
      { data: { id: 'rec1111111111111111', fields: { fldStatus: 'Done' } } },
      { data: { id: 'rec2222222222222222', fields: { fldStatus: 'Open' } } },
    ]);

    const result = await service.updateRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        { id: 'rec1111111111111111', fields: { fldStatus: 'Done' } },
        { id: 'rec2222222222222222', fields: { fldStatus: 'Open' } },
      ],
    });

    expect(commandExecute).toHaveBeenCalledTimes(1);
    expect(commandExecute.mock.calls[0]?.[1].records).toHaveLength(2);
    expect(commandExecute.mock.calls[0]?.[1].records?.[0]?.recordId.toString()).toBe(
      'rec1111111111111111'
    );
    expect(commandExecute.mock.calls[0]?.[1].records?.[1]?.fieldValues.get('fldStatus')).toBe(
      'Open'
    );
    expect(commandExecute.mock.calls[0]?.[1].order).toBeUndefined();
    expect(result).toEqual([
      { id: 'rec1111111111111111', fields: { fldStatus: 'Done' } },
      { id: 'rec2222222222222222', fields: { fldStatus: 'Open' } },
    ]);
    expect(cacheDel).toHaveBeenCalledWith(
      `operations:engine:usr${'h'.repeat(16)}:tbl${'c'.repeat(16)}:win${'i'.repeat(16)}`
    );
  });

  it('passes batch order through native v2 updateRecords', async () => {
    await service.updateRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        { id: 'rec1111111111111111', fields: { fldStatus: 'Done' } },
        { id: 'rec2222222222222222', fields: { fldStatus: 'Open' } },
      ],
      order: {
        viewId: `viw${'c'.repeat(16)}`,
        anchorId: 'rec1111111111111111',
        position: 'after',
      },
    });

    expect(commandExecute).toHaveBeenCalledTimes(1);
    expect(commandExecute.mock.calls[0]?.[1].order?.viewId.toString()).toBe(`viw${'c'.repeat(16)}`);
    expect(commandExecute.mock.calls[0]?.[1].order?.position).toBe('after');
  });

  it('merges duplicate record updates before calling native v2 updateRecords', async () => {
    getSnapshotBulkWithPermission.mockResolvedValue([
      { data: { id: 'rec1111111111111111', fields: { fldStatus: 'Done', fldNote: 'latest' } } },
    ]);

    const result = await service.updateRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        { id: 'rec1111111111111111', fields: { fldStatus: 'Open', fldNote: 'first' } },
        { id: 'rec1111111111111111', fields: { fldStatus: 'Done' } },
        { id: 'rec1111111111111111', fields: { fldNote: 'latest' } },
      ],
    });

    expect(commandExecute).toHaveBeenCalledTimes(1);
    expect(commandExecute.mock.calls[0]?.[1].records).toHaveLength(1);
    expect(commandExecute.mock.calls[0]?.[1].records?.[0]?.recordId.toString()).toBe(
      'rec1111111111111111'
    );
    expect(commandExecute.mock.calls[0]?.[1].records?.[0]?.fieldValues.get('fldStatus')).toBe(
      'Done'
    );
    expect(commandExecute.mock.calls[0]?.[1].records?.[0]?.fieldValues.get('fldNote')).toBe(
      'latest'
    );
    expect(getSnapshotBulkWithPermission).toHaveBeenCalledWith(
      `tbl${'c'.repeat(16)}`,
      ['rec1111111111111111'],
      undefined,
      FieldKeyType.Id,
      undefined,
      true
    );
    expect(result).toEqual([
      { id: 'rec1111111111111111', fields: { fldStatus: 'Done', fldNote: 'latest' } },
    ]);
  });
});
