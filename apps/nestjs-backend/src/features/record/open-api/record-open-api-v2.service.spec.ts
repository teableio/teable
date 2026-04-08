import { CellValueType, FieldKeyType, FieldType, SortFunc } from '@teable/core';
import {
  CreateRecordResult,
  CreateRecordsResult,
  DuplicateRecordResult,
  ListTableRecordsQuery,
  ListTableRecordsResult,
  UpdateRecordResult,
  UpdateRecordsResult,
  TableRecord,
  TableId,
  v2CoreTokens,
} from '@teable/v2-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecordOpenApiV2Service } from './record-open-api-v2.service';

describe('RecordOpenApiV2Service', () => {
  const createdTimeIso = '2026-03-19T01:02:03.000Z';
  const statusFieldId = `fld${'s'.repeat(16)}`;
  const noteFieldId = `fld${'n'.repeat(16)}`;
  const countFieldId = `fld${'c'.repeat(16)}`;
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

  const createUpdateRecordResult = (params: {
    recordId: string;
    tableId: string;
    fields: Record<string, unknown>;
    fieldKeyMapping?: Map<string, string>;
  }) => {
    const record = TableRecord.fromRawFieldValues({
      id: params.recordId,
      tableId: TableId.create(params.tableId)._unsafeUnwrap(),
      fields: params.fields,
    })._unsafeUnwrap();

    return UpdateRecordResult.create(record, [], params.fieldKeyMapping ?? new Map());
  };

  const createUpdateRecordsResult = (params: {
    tableId: string;
    records: Array<{
      id: string;
      fields: Record<string, unknown>;
    }>;
    fieldKeyMapping?: Map<string, string>;
  }) => {
    const records = params.records.map(({ id, fields }) =>
      TableRecord.fromRawFieldValues({
        id,
        tableId: TableId.create(params.tableId)._unsafeUnwrap(),
        fields,
      })._unsafeUnwrap()
    );

    return UpdateRecordsResult.create(
      records.length,
      [],
      records,
      params.fieldKeyMapping ?? new Map()
    );
  };

  const createCreateRecordResult = (params: {
    recordId: string;
    tableId: string;
    fields: Record<string, unknown>;
    fieldKeyMapping?: Map<string, string>;
  }) => {
    const record = TableRecord.fromRawFieldValues({
      id: params.recordId,
      tableId: TableId.create(params.tableId)._unsafeUnwrap(),
      fields: params.fields,
    })._unsafeUnwrap();

    return CreateRecordResult.create(record, [], params.fieldKeyMapping ?? new Map());
  };

  const createCreateRecordsResult = (params: {
    tableId: string;
    records: Array<{
      id: string;
      fields: Record<string, unknown>;
    }>;
    fieldKeyMapping?: Map<string, string>;
  }) => {
    const records = params.records.map(({ id, fields }) =>
      TableRecord.fromRawFieldValues({
        id,
        tableId: TableId.create(params.tableId)._unsafeUnwrap(),
        fields,
      })._unsafeUnwrap()
    );

    return CreateRecordsResult.create(records, [], params.fieldKeyMapping ?? new Map());
  };

  const createDuplicateRecordResult = (params: {
    recordId: string;
    tableId: string;
    fields: Record<string, unknown>;
    fieldKeyMapping?: Map<string, string>;
  }) => {
    const record = TableRecord.fromRawFieldValues({
      id: params.recordId,
      tableId: TableId.create(params.tableId)._unsafeUnwrap(),
      fields: params.fields,
    })._unsafeUnwrap();

    return DuplicateRecordResult.create(record, [], params.fieldKeyMapping ?? new Map());
  };

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
    expect(getSnapshotBulkWithPermission).toHaveBeenCalledTimes(1);
    expect(getFieldsByQuery).toHaveBeenCalledWith(`tbl${'c'.repeat(16)}`, {
      projection: ['fldCreatedTime0001'],
    });
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
    expect(getSnapshotBulkWithPermission).toHaveBeenCalledTimes(1);
    expect(getFieldsByQuery).not.toHaveBeenCalled();
  });

  it('reuses enabled field ids from the read source for snapshot projection', async () => {
    getReadQuerySource.mockResolvedValue({
      tableName: 'test_table',
      cteName: 'view_cte',
      cteSql: 'select 1',
      enabledFieldIds: ['fldVisible0000000001'],
    });
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
          fields: {
            Visible: 'alpha',
          },
        },
      },
    ]);
    getFieldsByQuery.mockResolvedValue([
      {
        id: 'fldVisible0000000001',
        name: 'Visible',
        type: FieldType.SingleLineText,
        cellValueType: CellValueType.String,
        isMultipleCellValue: false,
        dbFieldType: 'text',
      },
    ]);

    const result = await service.getRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Name,
      skip: 0,
      take: 1,
      viewId: `viw${'v'.repeat(16)}`,
    });

    expect(result.records).toEqual([
      {
        id: 'rec1111111111111111',
        fields: {
          Visible: 'alpha',
        },
      },
    ]);
    expect(getFieldsByQuery).toHaveBeenCalledWith(`tbl${'c'.repeat(16)}`, {
      projection: ['fldVisible0000000001'],
    });
    expect(getSnapshotBulkWithPermission).toHaveBeenCalledWith(
      `tbl${'c'.repeat(16)}`,
      ['rec1111111111111111'],
      { Visible: true },
      FieldKeyType.Name,
      undefined,
      true
    );
  });

  it('keeps snapshot fallback when an explicit projection is requested', async () => {
    execute.mockResolvedValue({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [{ id: 'rec1111111111111111', fields: { Title: 'Alpha' }, version: 1 }],
        1,
        0,
        1
      ),
    });
    getSnapshotBulkWithPermission.mockResolvedValue([
      {
        data: {
          id: 'rec1111111111111111',
          name: 'Alpha',
          fields: {
            Title: 'Alpha',
          },
        },
      },
    ]);

    const result = await service.getRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Name,
      projection: ['Title'],
      skip: 0,
      take: 1,
    });

    expect(result.records).toEqual([
      {
        id: 'rec1111111111111111',
        name: 'Alpha',
        fields: {
          Title: 'Alpha',
        },
      },
    ]);
    expect(getSnapshotBulkWithPermission).toHaveBeenCalledTimes(1);
  });

  it('routes explicit batch field updates through native v2 updateRecords', async () => {
    commandExecute.mockResolvedValueOnce({
      isErr: () => false,
      value: createUpdateRecordsResult({
        tableId: `tbl${'c'.repeat(16)}`,
        records: [
          { id: 'rec1111111111111111', fields: { [statusFieldId]: 'Done' } },
          { id: 'rec2222222222222222', fields: { [statusFieldId]: 'Open' } },
        ],
        fieldKeyMapping: new Map([[statusFieldId, statusFieldId]]),
      }),
    });

    const result = await service.updateRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        { id: 'rec1111111111111111', fields: { [statusFieldId]: 'Done' } },
        { id: 'rec2222222222222222', fields: { [statusFieldId]: 'Open' } },
      ],
    });

    expect(commandExecute).toHaveBeenCalledTimes(1);
    expect(commandExecute.mock.calls[0]?.[1].records).toHaveLength(2);
    expect(commandExecute.mock.calls[0]?.[1].records?.[0]?.recordId.toString()).toBe(
      'rec1111111111111111'
    );
    expect(commandExecute.mock.calls[0]?.[1].records?.[1]?.fieldValues.get(statusFieldId)).toBe(
      'Open'
    );
    expect(commandExecute.mock.calls[0]?.[1].order).toBeUndefined();
    expect(result).toEqual([
      { id: 'rec1111111111111111', fields: { [statusFieldId]: 'Done' } },
      { id: 'rec2222222222222222', fields: { [statusFieldId]: 'Open' } },
    ]);
    expect(getSnapshotBulkWithPermission).not.toHaveBeenCalled();
    expect(cacheDel).toHaveBeenCalledWith(
      `operations:engine:usr${'h'.repeat(16)}:tbl${'c'.repeat(16)}:win${'i'.repeat(16)}`
    );
  });

  it('returns the v2 updateRecord payload directly without reloading legacy snapshots', async () => {
    commandExecute.mockResolvedValueOnce({
      isErr: () => false,
      value: createUpdateRecordResult({
        recordId: 'rec1111111111111111',
        tableId: `tbl${'c'.repeat(16)}`,
        fields: {
          [`fld${'s'.repeat(16)}`]: 'Done',
          [countFieldId]: '1',
        },
        fieldKeyMapping: new Map([
          [`fld${'s'.repeat(16)}`, 'status'],
          [countFieldId, countFieldId],
        ]),
      }),
    });

    const result = await service.updateRecord(`tbl${'c'.repeat(16)}`, 'rec1111111111111111', {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          status: 'Done',
        },
      },
    });

    expect(result).toEqual({
      id: 'rec1111111111111111',
      fields: {
        status: 'Done',
        [countFieldId]: '1',
      },
    });
    expect(getSnapshotBulkWithPermission).not.toHaveBeenCalled();
    expect(cacheDel).toHaveBeenCalledWith(
      `operations:engine:usr${'h'.repeat(16)}:tbl${'c'.repeat(16)}:win${'i'.repeat(16)}`
    );
  });

  it('passes batch order through native v2 updateRecords', async () => {
    commandExecute.mockResolvedValueOnce({
      isErr: () => false,
      value: createUpdateRecordsResult({
        tableId: `tbl${'c'.repeat(16)}`,
        records: [
          { id: 'rec1111111111111111', fields: { fldStatus: 'Done' } },
          { id: 'rec2222222222222222', fields: { fldStatus: 'Open' } },
        ],
      }),
    });

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

  it('returns reorder-only batch updates from the native v2 payload without reloading snapshots', async () => {
    commandExecute.mockResolvedValueOnce({
      isErr: () => false,
      value: createUpdateRecordsResult({
        tableId: `tbl${'c'.repeat(16)}`,
        records: [
          { id: 'rec1111111111111111', fields: { [statusFieldId]: 'Done' } },
          { id: 'rec2222222222222222', fields: { [statusFieldId]: 'Open' } },
        ],
        fieldKeyMapping: new Map([[statusFieldId, 'status']]),
      }),
    });

    const result = await service.updateRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Name,
      records: [
        { id: 'rec1111111111111111', fields: {} },
        { id: 'rec2222222222222222', fields: {} },
      ],
      order: {
        viewId: `viw${'c'.repeat(16)}`,
        anchorId: 'rec1111111111111111',
        position: 'after',
      },
    });

    expect(result).toEqual([
      { id: 'rec1111111111111111', fields: { status: 'Done' } },
      { id: 'rec2222222222222222', fields: { status: 'Open' } },
    ]);
    expect(getSnapshotBulkWithPermission).not.toHaveBeenCalled();
  });

  it('merges duplicate record updates before calling native v2 updateRecords', async () => {
    commandExecute.mockResolvedValueOnce({
      isErr: () => false,
      value: createUpdateRecordsResult({
        tableId: `tbl${'c'.repeat(16)}`,
        records: [
          {
            id: 'rec1111111111111111',
            fields: { [statusFieldId]: 'Done', [noteFieldId]: 'latest' },
          },
        ],
        fieldKeyMapping: new Map([
          [statusFieldId, statusFieldId],
          [noteFieldId, noteFieldId],
        ]),
      }),
    });

    const result = await service.updateRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        { id: 'rec1111111111111111', fields: { [statusFieldId]: 'Open', [noteFieldId]: 'first' } },
        { id: 'rec1111111111111111', fields: { [statusFieldId]: 'Done' } },
        { id: 'rec1111111111111111', fields: { [noteFieldId]: 'latest' } },
      ],
    });

    expect(commandExecute).toHaveBeenCalledTimes(1);
    expect(commandExecute.mock.calls[0]?.[1].records).toHaveLength(1);
    expect(commandExecute.mock.calls[0]?.[1].records?.[0]?.recordId.toString()).toBe(
      'rec1111111111111111'
    );
    expect(commandExecute.mock.calls[0]?.[1].records?.[0]?.fieldValues.get(statusFieldId)).toBe(
      'Done'
    );
    expect(commandExecute.mock.calls[0]?.[1].records?.[0]?.fieldValues.get(noteFieldId)).toBe(
      'latest'
    );
    expect(getSnapshotBulkWithPermission).not.toHaveBeenCalled();
    expect(result).toEqual([
      { id: 'rec1111111111111111', fields: { [statusFieldId]: 'Done', [noteFieldId]: 'latest' } },
    ]);
  });

  it('returns the v2 createRecords payload directly without reloading legacy snapshots', async () => {
    commandExecute.mockResolvedValueOnce({
      isErr: () => false,
      value: createCreateRecordsResult({
        tableId: `tbl${'c'.repeat(16)}`,
        records: [
          { id: 'rec1111111111111111', fields: { [statusFieldId]: 'Done' } },
          { id: 'rec2222222222222222', fields: { [statusFieldId]: 'Open' } },
        ],
        fieldKeyMapping: new Map([[statusFieldId, 'status']]),
      }),
    });

    const result = await service.createRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Name,
      records: [{ fields: { status: 'Done' } }, { fields: { status: 'Open' } }],
    });

    expect(result).toEqual({
      records: [
        { id: 'rec1111111111111111', fields: { status: 'Done' } },
        { id: 'rec2222222222222222', fields: { status: 'Open' } },
      ],
    });
    expect(getSnapshotBulkWithPermission).not.toHaveBeenCalled();
    expect(cacheDel).toHaveBeenCalledWith(
      `operations:engine:usr${'h'.repeat(16)}:tbl${'c'.repeat(16)}:win${'i'.repeat(16)}`
    );
  });

  it('returns the v2 formSubmit payload directly without reloading legacy snapshots', async () => {
    commandExecute.mockResolvedValueOnce({
      isErr: () => false,
      value: createCreateRecordResult({
        recordId: 'rec1111111111111111',
        tableId: `tbl${'c'.repeat(16)}`,
        fields: { [statusFieldId]: 'Done' },
        fieldKeyMapping: new Map([[statusFieldId, 'status']]),
      }),
    });

    const result = await service.formSubmit(`tbl${'c'.repeat(16)}`, {
      viewId: `viw${'c'.repeat(16)}`,
      fields: { status: 'Done' },
    });

    expect(result).toEqual({
      id: 'rec1111111111111111',
      fields: { status: 'Done' },
    });
    expect(getSnapshotBulkWithPermission).not.toHaveBeenCalled();
    expect(cacheDel).toHaveBeenCalledWith(
      `operations:engine:usr${'h'.repeat(16)}:tbl${'c'.repeat(16)}:win${'i'.repeat(16)}`
    );
  });

  it('returns the v2 duplicateRecord payload directly without reloading legacy snapshots', async () => {
    commandExecute.mockResolvedValueOnce({
      isErr: () => false,
      value: createDuplicateRecordResult({
        recordId: 'rec2222222222222222',
        tableId: `tbl${'c'.repeat(16)}`,
        fields: { [statusFieldId]: 'Copied' },
        fieldKeyMapping: new Map([[statusFieldId, 'status']]),
      }),
    });

    const result = await service.duplicateRecord(`tbl${'c'.repeat(16)}`, 'rec1111111111111111', {
      viewId: `viw${'c'.repeat(16)}`,
      anchorId: 'rec1111111111111111',
      position: 'after',
    });

    expect(result).toEqual({
      id: 'rec2222222222222222',
      fields: { status: 'Copied' },
    });
    expect(getSnapshotBulkWithPermission).not.toHaveBeenCalled();
    expect(cacheDel).toHaveBeenCalledWith(
      `operations:engine:usr${'h'.repeat(16)}:tbl${'c'.repeat(16)}:win${'i'.repeat(16)}`
    );
  });

  it('routes reorder-only single-record updates through native v2 updateRecord without reloading snapshots', async () => {
    commandExecute.mockResolvedValueOnce({
      isErr: () => false,
      value: createUpdateRecordResult({
        recordId: 'rec1111111111111111',
        tableId: `tbl${'c'.repeat(16)}`,
        fields: { [statusFieldId]: 'Done' },
        fieldKeyMapping: new Map([[statusFieldId, 'status']]),
      }),
    });

    const result = await service.updateRecord(`tbl${'c'.repeat(16)}`, 'rec1111111111111111', {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {},
      },
      order: {
        viewId: `viw${'c'.repeat(16)}`,
        anchorId: 'rec1111111111111111',
        position: 'after',
      },
    });

    expect(result).toEqual({
      id: 'rec1111111111111111',
      fields: { status: 'Done' },
    });
    expect(commandExecute).toHaveBeenCalledTimes(1);
    expect(commandExecute.mock.calls[0]?.[1].fieldValues.size).toBe(0);
    expect(commandExecute.mock.calls[0]?.[1].order?.viewId.toString()).toBe(`viw${'c'.repeat(16)}`);
    expect(getSnapshotBulkWithPermission).not.toHaveBeenCalled();
  });
});
