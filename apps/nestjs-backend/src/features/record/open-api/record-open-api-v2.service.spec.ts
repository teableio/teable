import {
  CellFormat,
  CellValueType,
  DbFieldType,
  FieldKeyType,
  FieldType,
  SortFunc,
} from '@teable/core';
import { GroupPointType, RangeType } from '@teable/openapi';
import {
  BaseId,
  CellValueMultiplicity,
  CellValueType as V2CellValueType,
  ConditionalLookupOptions,
  CountTableRecordsQuery,
  CountTableRecordsResult,
  CreateRecordResult,
  CreateRecordsResult,
  createConditionalLookupField,
  createDateField,
  createNumberField,
  createUserField,
  DateTimeFormatting,
  DuplicateRecordResult,
  FieldId,
  FieldName,
  FormulaExpression,
  GetRecordStatusQuery,
  GetRecordStatusResult,
  LinkFieldConfig,
  LookupField,
  LookupOptions,
  ListTableRecordsQuery,
  ListTableRecordsResult,
  NumberFormatting,
  RecordId,
  Table,
  TableId,
  TableName,
  TableRecord,
  TimeFormatting as V2TimeFormatting,
  UpdateRecordResult,
  UpdateRecordsResult,
  UserMultiplicity,
  v2CoreTokens,
  type Table as V2Table,
  type TableBuilder,
} from '@teable/v2-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { convertValueToStringify, string2Hash } from '../../../utils';
import { createFieldInstanceByVo } from '../../field/model/factory';
import { RecordOpenApiV2Service } from './record-open-api-v2.service';

const tableIdText = `tbl${'c'.repeat(16)}`;
const primaryFieldId = `fld${'p'.repeat(16)}`;
const statusFieldId = `fld${'s'.repeat(16)}`;
const noteFieldId = `fld${'n'.repeat(16)}`;
const countFieldId = `fld${'c'.repeat(16)}`;
const createdTimeFieldId = `fld${'t'.repeat(16)}`;
const dateFieldIdText = `fld${'d'.repeat(16)}`;
const checkboxFieldId = `fld${'b'.repeat(16)}`;
const createdByFieldId = `fld${'u'.repeat(16)}`;
const formulaDateFieldId = `fld${'f'.repeat(16)}`;
const formulaBooleanFieldId = `fld${'o'.repeat(16)}`;
const formattedNumberFieldId = `fld${'m'.repeat(16)}`;
const conditionalNumberFieldId = `fld${'q'.repeat(16)}`;
const conditionalDateFieldId = `fld${'z'.repeat(16)}`;
const lookupUserFieldId = `fld${'l'.repeat(16)}`;
const conditionalUserFieldId = `fld${'v'.repeat(16)}`;

/**
 * Pure domain Table aggregate via builder — not a structural mock.
 * Pass `extend` to add fields/views on the same builder before build.
 */
const createTestTable = (extend?: (builder: TableBuilder) => void): V2Table => {
  const builder = Table.builder()
    .withId(TableId.create(tableIdText)._unsafeUnwrap())
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('OpenAPI V2 Test')._unsafeUnwrap());

  builder
    .field()
    .singleLineText()
    .withId(FieldId.create(primaryFieldId)._unsafeUnwrap())
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .singleLineText()
    .withId(FieldId.create(statusFieldId)._unsafeUnwrap())
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .done();
  builder
    .field()
    .singleLineText()
    .withId(FieldId.create(noteFieldId)._unsafeUnwrap())
    .withName(FieldName.create('Note')._unsafeUnwrap())
    .done();
  builder
    .field()
    .createdTime()
    .withId(FieldId.create(createdTimeFieldId)._unsafeUnwrap())
    .withName(FieldName.create('Created')._unsafeUnwrap())
    .withFormatting(
      DateTimeFormatting.create({
        date: 'YYYY-MM-DD',
        time: V2TimeFormatting.None,
        timeZone: 'UTC',
      })._unsafeUnwrap()
    )
    .done();

  extend?.(builder);

  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const createConditionalLookupOptions = (seed: string) =>
  ConditionalLookupOptions.create({
    foreignTableId: `tbl${seed.repeat(16)}`,
    lookupFieldId: `fld${seed.repeat(16)}`,
    condition: {
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: statusFieldId, operator: 'is', value: 'Open' }],
      },
    },
  })._unsafeUnwrap();

const createLookupOptions = (seed: string) =>
  LookupOptions.create({
    linkFieldId: `fld${seed.repeat(16)}`,
    lookupFieldId: `fld${seed.toUpperCase().repeat(16)}`,
    foreignTableId: `tbl${seed.repeat(16)}`,
  })._unsafeUnwrap();

describe('RecordOpenApiV2Service', () => {
  const createdTimeIso = '2026-03-19T01:02:03.000Z';
  const getDocIdsByQuery = vi.fn();
  const getSnapshotBulkWithPermission = vi.fn();
  const getGroupRelatedData = vi.fn();
  const getDefaultViewId = vi.fn();
  const createContext = vi.fn();
  const legacyGetRecordsById = vi.fn();
  const getReadQuerySource = vi.fn();
  const getFieldsByQuery = vi.fn();
  const getField = vi.fn();
  const getFieldInstances = vi.fn();
  const performRowCount = vi.fn();
  const execute = vi.fn();
  const commandExecute = vi.fn();
  const resolve = vi.fn();
  const isRegistered = vi.fn();
  const getContainer = vi.fn();
  const clsGet = vi.fn();
  const clsSet = vi.fn();
  const clsRunWith = vi.fn();
  const cacheDel = vi.fn();
  const cacheSetDetail = vi.fn();
  const getDataDatabaseForTable = vi.fn();
  const dataPrismaForTable = vi.fn();
  const resolveForRecordSearch = vi.fn();
  const assertTableRecordWritable = vi.fn();
  const tableFindOne = vi.fn();
  const uploadFromUrl = vi.fn();
  const pluginPrepare = vi.fn();

  let testTable: V2Table;
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
    assertTableRecordWritable.mockResolvedValue(undefined);
    testTable = createTestTable();

    isRegistered.mockImplementation((token) => {
      return (
        token === v2CoreTokens.queryBus ||
        token === v2CoreTokens.commandBus ||
        token === v2CoreTokens.tableRepository ||
        token === v2CoreTokens.recordQueryPluginRunner
      );
    });
    pluginPrepare.mockResolvedValue({
      isErr: () => false,
      value: {
        guard: async () => ({ isErr: () => false, value: undefined }),
        getScope: () => ({ isErr: () => false, value: undefined }),
      },
    });
    tableFindOne.mockResolvedValue({
      isErr: () => false,
      value: testTable,
    });
    resolve.mockImplementation((token) => {
      if (token === v2CoreTokens.queryBus) {
        return { execute };
      }
      if (token === v2CoreTokens.commandBus) {
        return { execute: commandExecute };
      }
      if (token === v2CoreTokens.tableRepository) {
        return { findOne: tableFindOne };
      }
      if (token === v2CoreTokens.recordQueryPluginRunner) {
        return { prepare: pluginPrepare };
      }
      return undefined;
    });
    getContainer.mockResolvedValue({ resolve, isRegistered });
    createContext.mockResolvedValue({});
    clsGet.mockImplementation((key: string) => {
      if (key == null) {
        return {};
      }
      if (key === 'user.id') {
        return `usr${'h'.repeat(16)}`;
      }
      if (key === 'windowId') {
        return `win${'i'.repeat(16)}`;
      }
      return undefined;
    });
    clsRunWith.mockImplementation((_store, fn: () => unknown) => fn());
    getReadQuerySource.mockResolvedValue(undefined);
    getDefaultViewId.mockResolvedValue({ id: `viw${'v'.repeat(16)}` });
    getGroupRelatedData.mockResolvedValue({
      filter: undefined,
      groupPoints: undefined,
      allGroupHeaderRefs: undefined,
    });
    getFieldsByQuery.mockResolvedValue([
      { id: primaryFieldId, name: 'Title' },
      { id: statusFieldId, name: 'Status' },
      { id: noteFieldId, name: 'Note' },
    ]);
    getFieldInstances.mockResolvedValue([]);
    performRowCount.mockResolvedValue({ rowCount: 1 });
    getDataDatabaseForTable.mockResolvedValue({
      cacheKey: 'meta-fallback',
      url: 'postgresql://meta',
      isMetaFallback: true,
    });
    resolveForRecordSearch.mockResolvedValue(undefined);
    commandExecute.mockResolvedValue({
      isErr: () => false,
      value: UpdateRecordsResult.create(2, []),
    });
    execute.mockImplementation(
      async (_context: unknown, query: { constructor?: { name?: string } }) => {
        if (query instanceof CountTableRecordsQuery) {
          return {
            isErr: () => false,
            value: CountTableRecordsResult.create(2),
          };
        }
        return {
          isErr: () => false,
          value: ListTableRecordsResult.create(
            [
              {
                id: 'rec1111111111111111',
                fields: { [primaryFieldId]: 'A' },
                version: 1,
                autoNumber: 1,
                createdTime: createdTimeIso,
              },
              {
                id: 'rec2222222222222222',
                fields: { [primaryFieldId]: 'B' },
                version: 1,
                autoNumber: 2,
                createdTime: createdTimeIso,
              },
            ],
            2,
            0,
            2
          ),
        };
      }
    );
    getSnapshotBulkWithPermission.mockResolvedValue([
      { data: { id: 'rec1111111111111111', fields: {} } },
      { data: { id: 'rec2222222222222222', fields: {} } },
    ]);
    service = new RecordOpenApiV2Service(
      { getContainerForTable: getContainer } as never,
      { createContext } as never,
      { get: clsGet, set: clsSet, runWith: clsRunWith } as never,
      { del: cacheDel, setDetail: cacheSetDetail } as never,
      { getDataDatabaseForTable, dataPrismaForTable } as never,
      {
        current: vi.fn().mockReturnValue(undefined),
        emitAtomic: vi.fn().mockResolvedValue(undefined),
        withOperation: vi.fn().mockImplementation((_operation, fn: () => Promise<unknown>) => fn()),
      } as never,
      { assertTableRecordWritable } as never,
      { maxCopyCells: 50_000, maxGroupPoints: 5_000 } as never,
      { uploadFromUrl } as never,
      { resolveForRecordSearch } as never
    );
  });

  it('resolves range record ids through the v2 query path', async () => {
    const recordIds = await service.getRecordIdsFromRanges(`tbl${'c'.repeat(16)}`, {
      viewId: `viw${'v'.repeat(16)}`,
      type: RangeType.Rows,
      ranges: [[0, 1]],
    });

    expect(recordIds).toEqual(['rec1111111111111111', 'rec2222222222222222']);
    expect(getDocIdsByQuery).not.toHaveBeenCalled();
    const query = execute.mock.calls[0]?.[1] as ListTableRecordsQuery;
    expect(query.projection).toEqual([]);
  });

  it('converts copied link cell values to titles when preparing v2 paste into text fields', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    const viewId = `viw${'v'.repeat(16)}`;
    const targetFieldId = `fld${'t'.repeat(16)}`;
    const sourceFieldId = `fld${'l'.repeat(16)}`;
    const foreignTableId = `tbl${'f'.repeat(16)}`;
    const lookupFieldId = `fld${'p'.repeat(16)}`;

    performRowCount.mockResolvedValueOnce({ rowCount: 2 });
    getFieldInstances.mockResolvedValueOnce([
      createFieldInstanceByVo({
        id: targetFieldId,
        dbFieldName: 'label',
        name: 'Label',
        type: FieldType.SingleLineText,
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        options: {},
      }),
    ]);

    const prepared = await (
      service as unknown as {
        preparePasteCommandInput: (
          tableId: string,
          pasteRo: {
            viewId: string;
            ranges: [[number, number], [number, number]];
            content: unknown[][];
            header: unknown[];
          }
        ) => Promise<{ commandInput: { content: unknown[][] } }>;
      }
    ).preparePasteCommandInput(tableId, {
      viewId,
      ranges: [
        [0, 0],
        [0, 1],
      ],
      content: [
        [{ id: `rec${'1'.repeat(16)}`, title: 'Alpha' }],
        [{ id: `rec${'2'.repeat(16)}`, title: 'Beta' }],
      ],
      header: [
        {
          id: sourceFieldId,
          name: 'Related',
          type: FieldType.Link,
          cellValueType: CellValueType.String,
          dbFieldType: 'json',
          isMultipleCellValue: true,
          options: {
            relationship: 'manyMany',
            foreignTableId,
            lookupFieldId,
          },
        },
      ],
    });

    expect(prepared.commandInput.content).toEqual([['Alpha'], ['Beta']]);
  });

  it('preserves structured link titles when preparing v2 paste into link fields (T6106)', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    const viewId = `viw${'v'.repeat(16)}`;
    const targetFieldId = `fld${'t'.repeat(16)}`;
    const sourceFieldId = `fld${'l'.repeat(16)}`;
    const foreignTableId = `tbl${'f'.repeat(16)}`;
    const lookupFieldId = `fld${'p'.repeat(16)}`;
    const linkFieldVo = {
      id: targetFieldId,
      dbFieldName: 'related',
      name: 'Related',
      type: FieldType.Link,
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Json,
      isMultipleCellValue: false,
      options: {
        relationship: 'manyOne',
        foreignTableId,
        lookupFieldId,
        isOneWay: true,
      },
    };
    testTable = createTestTable((builder) => {
      builder
        .field()
        .link()
        .withId(FieldId.create(targetFieldId)._unsafeUnwrap())
        .withName(FieldName.create('Related')._unsafeUnwrap())
        .withConfig(
          LinkFieldConfig.create({
            relationship: 'manyOne',
            foreignTableId,
            lookupFieldId,
            isOneWay: true,
          })._unsafeUnwrap()
        )
        .done();
    });
    tableFindOne.mockResolvedValue({
      isErr: () => false,
      value: testTable,
    });

    const prepared = await (
      service as unknown as {
        preparePasteCommandInput: (
          tableId: string,
          pasteRo: {
            viewId: string;
            ranges: [[number, number], [number, number]];
            content: unknown[][];
            header: unknown[];
            projection?: string[];
          }
        ) => Promise<{ commandInput: { content: unknown[][] } }>;
      }
    ).preparePasteCommandInput(tableId, {
      viewId,
      projection: [targetFieldId],
      ranges: [
        [0, 0],
        [0, 1],
      ],
      content: [
        [{ id: `rec${'1'.repeat(16)}`, title: 'Alpha' }],
        [{ id: `rec${'2'.repeat(16)}`, title: 'Beta' }],
      ],
      header: [
        {
          ...linkFieldVo,
          id: sourceFieldId,
        },
      ],
    });

    expect(prepared.commandInput.content).toEqual([
      [{ id: `rec${'1'.repeat(16)}`, title: 'Alpha' }],
      [{ id: `rec${'2'.repeat(16)}`, title: 'Beta' }],
    ]);
  });

  it('forwards explicit sort and group keys for V2 permission validation', async () => {
    pluginPrepare.mockResolvedValueOnce({
      isErr: () => false,
      value: {
        guard: async () => ({ isErr: () => false, value: undefined }),
        getScope: () => ({
          isErr: () => false,
          value: { readableFieldIds: new Set([primaryFieldId]) },
        }),
      },
    });

    await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      orderBy: [{ fieldId: statusFieldId, order: SortFunc.Asc }],
      groupBy: [{ fieldId: noteFieldId, order: SortFunc.Desc }],
      includeQueryExtra: false,
    });

    const query = execute.mock.calls[0]?.[1] as ListTableRecordsQuery;
    expect(query.sort).toEqual([
      { fieldId: noteFieldId, order: SortFunc.Desc },
      { fieldId: statusFieldId, order: SortFunc.Asc },
    ]);
    expect(query.groupBy).toEqual([noteFieldId]);
  });

  it('forwards the full record-status query and prepared row scope to v2 core', async () => {
    const targetRecordId = `rec${'r'.repeat(16)}`;
    const selectedRecordIds = [targetRecordId, `rec${'s'.repeat(16)}`];
    const queryScope = { readableFieldIds: new Set([primaryFieldId]) };
    pluginPrepare.mockResolvedValueOnce({
      isErr: () => false,
      value: {
        guard: async () => ({ isErr: () => false, value: undefined }),
        getScope: () => ({ isErr: () => false, value: queryScope }),
      },
    });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: GetRecordStatusResult.create(false, false),
    });

    await service.getRecordStatus(tableIdText, targetRecordId, {
      fieldKeyType: FieldKeyType.Name,
      orderBy: [{ fieldId: 'Status', order: SortFunc.Asc }],
      groupBy: [{ fieldId: 'Note', order: SortFunc.Desc }],
      selectedRecordIds,
      viewId: `viw${'v'.repeat(16)}`,
      ignoreViewQuery: true,
      skip: 4,
      take: 2,
    });

    expect(pluginPrepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'list',
        payload: expect.objectContaining({
          limit: 2,
          offset: 4,
          viewId: `viw${'v'.repeat(16)}`,
          ignoreViewQuery: true,
        }),
      })
    );
    const statusQuery = execute.mock.calls[0]?.[1] as GetRecordStatusQuery;
    expect(statusQuery).toBeInstanceOf(GetRecordStatusQuery);
    expect(statusQuery.sort).toEqual([
      { fieldId: noteFieldId, order: SortFunc.Desc },
      { fieldId: statusFieldId, order: SortFunc.Asc },
    ]);
    expect(statusQuery.groupBy).toEqual([noteFieldId]);
    expect(statusQuery.selectedRecordIds).toEqual(selectedRecordIds);
    expect(statusQuery.limit).toBe(2);
    expect(statusQuery.offset).toBe(4);
    expect(statusQuery.fieldKeyType).toBe(FieldKeyType.Id);
    expect(statusQuery.queryScope).toBe(queryScope);
    expect(statusQuery.table).toBe(testTable);
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
    expect((query as ListTableRecordsQuery).projection).toEqual([
      primaryFieldId,
      statusFieldId,
      noteFieldId,
      createdTimeFieldId,
    ]);
    expect((query as ListTableRecordsQuery).includeTotal).toBe(false);
    expect((query as ListTableRecordsQuery).viewId).toBe(viewId);
    expect((query as ListTableRecordsQuery).ignoreViewQuery).toBe(true);
    expect(getReadQuerySource).not.toHaveBeenCalled();
    expect(getSnapshotBulkWithPermission).not.toHaveBeenCalled();

    expect(result.records).toEqual([
      {
        id: 'rec1111111111111111',
        fields: { [primaryFieldId]: 'A' },
        name: 'A',
        autoNumber: 1,
        createdTime: createdTimeIso,
        lastModifiedTime: undefined,
        createdBy: undefined,
        lastModifiedBy: undefined,
      },
      {
        id: 'rec2222222222222222',
        fields: { [primaryFieldId]: 'B' },
        name: 'B',
        autoNumber: 2,
        createdTime: createdTimeIso,
        lastModifiedTime: undefined,
        createdBy: undefined,
        lastModifiedBy: undefined,
      },
    ]);
  });

  it('passes a meta-backed generated search vector access path into v2 list queries', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    const search = ['order 123'] as [string];
    const accessPath = {
      kind: 'generated_tsvector' as const,
      generatedColumnName: '__tqops_search_vector',
      languageConfig: 'simple',
      searchScope: 'all_fields' as const,
      coveredFieldIds: [FieldId.create(noteFieldId)._unsafeUnwrap()],
    };
    resolveForRecordSearch.mockResolvedValueOnce(accessPath);

    await service.getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      search,
      skip: 0,
      take: 2,
    });

    expect(resolveForRecordSearch).toHaveBeenCalledWith({
      container: { resolve, isRegistered },
      tableId,
      search,
    });
    expect(getDocIdsByQuery).not.toHaveBeenCalled();
    const query = execute.mock.calls[0]?.[1];
    expect(query).toBeInstanceOf(ListTableRecordsQuery);
    expect((query as ListTableRecordsQuery).recordSearchAccessPath).toBe(accessPath);
  });

  it('normalizes legacy ISO date filters for v2 date comparisons using table aggregate fields', async () => {
    const exactDate = '2026-06-02T00:00:00.000Z';
    // Domain table with a date field (builder extend), not a structural field mock.
    tableFindOne.mockResolvedValue({
      isErr: () => false,
      value: createTestTable((builder) => {
        builder
          .field()
          .date()
          .withId(FieldId.create(dateFieldIdText)._unsafeUnwrap())
          .withName(FieldName.create('Created Date')._unsafeUnwrap())
          .withFormatting(
            DateTimeFormatting.create({
              date: 'YYYY-MM-DD',
              time: V2TimeFormatting.None,
              timeZone: 'Asia/Shanghai',
            })._unsafeUnwrap()
          )
          .done();
      }),
    });

    await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 2,
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: dateFieldIdText,
            operator: 'isOnOrAfter',
            value: exactDate,
          },
        ],
      } as never,
    });

    const query = execute.mock.calls[0]?.[1];
    expect(query).toBeInstanceOf(ListTableRecordsQuery);
    expect(getFieldInstances).not.toHaveBeenCalled();
    expect((query as ListTableRecordsQuery).filter).toEqual({
      conjunction: 'and',
      items: [
        {
          fieldId: dateFieldIdText,
          operator: 'isOnOrAfter',
          value: {
            mode: 'exactDate',
            exactDate,
            timeZone: 'Asia/Shanghai',
          },
        },
      ],
    });
  });

  it('normalizes computed date and boolean filters from their effective result types', async () => {
    const exactDate = '2026-06-02T00:00:00.000Z';
    const innerDate = createDateField({
      id: FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap(),
      name: FieldName.create('Inner date')._unsafeUnwrap(),
      formatting: DateTimeFormatting.create({
        date: 'YYYY-MM-DD',
        time: V2TimeFormatting.None,
        timeZone: 'Asia/Tokyo',
      })._unsafeUnwrap(),
    })._unsafeUnwrap();
    testTable = createTestTable((builder) => {
      builder
        .field()
        .formula()
        .withId(FieldId.create(formulaDateFieldId)._unsafeUnwrap())
        .withName(FieldName.create('Calculated Date')._unsafeUnwrap())
        .withExpression(FormulaExpression.create('TODAY()')._unsafeUnwrap())
        .withResultType({
          cellValueType: V2CellValueType.dateTime(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        })
        .withFormatting(
          DateTimeFormatting.create({
            date: 'YYYY-MM-DD',
            time: V2TimeFormatting.None,
            timeZone: 'Asia/Shanghai',
          })._unsafeUnwrap()
        )
        .done();
      builder
        .field()
        .formula()
        .withId(FieldId.create(formulaBooleanFieldId)._unsafeUnwrap())
        .withName(FieldName.create('Calculated Done')._unsafeUnwrap())
        .withExpression(FormulaExpression.create('TRUE')._unsafeUnwrap())
        .withResultType({
          cellValueType: V2CellValueType.boolean(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        })
        .done();
      builder.addFieldFromResult(
        createConditionalLookupField({
          id: FieldId.create(conditionalDateFieldId)._unsafeUnwrap(),
          name: FieldName.create('Conditional date')._unsafeUnwrap(),
          innerField: innerDate,
          conditionalLookupOptions: createConditionalLookupOptions('d'),
          isMultipleCellValue: false,
        })
      );
    });
    tableFindOne.mockResolvedValue({ isErr: () => false, value: testTable });

    await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: formulaDateFieldId,
            operator: 'isOnOrAfter',
            value: exactDate,
          },
          {
            fieldId: formulaBooleanFieldId,
            operator: 'is',
            value: null,
          },
          {
            fieldId: conditionalDateFieldId,
            operator: 'isOnOrAfter',
            value: exactDate,
          },
        ],
      } as never,
    });

    const query = execute.mock.calls[0]?.[1] as ListTableRecordsQuery;
    expect(query.filter).toEqual({
      conjunction: 'and',
      items: [
        {
          fieldId: formulaDateFieldId,
          operator: 'isOnOrAfter',
          value: {
            mode: 'exactDate',
            exactDate,
            timeZone: 'Asia/Shanghai',
          },
        },
        {
          fieldId: formulaBooleanFieldId,
          operator: 'is',
          value: false,
        },
        {
          fieldId: conditionalDateFieldId,
          operator: 'isOnOrAfter',
          value: {
            mode: 'exactDate',
            exactDate,
            timeZone: 'Asia/Tokyo',
          },
        },
      ],
    });
  });

  it('loads grouped query extra by default for grouped record reads', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    const groupBy = [{ fieldId: statusFieldId, order: SortFunc.Asc }];
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          {
            id: 'rec1111111111111111',
            fields: { [primaryFieldId]: 'A' },
            version: 1,
          },
          {
            id: 'rec2222222222222222',
            fields: { [primaryFieldId]: 'B' },
            version: 1,
          },
        ],
        2,
        0,
        2,
        [{ fields: { [statusFieldId]: 'Open' }, count: 2 }]
      ),
    });

    const result = await service.getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 2,
      groupBy,
    });

    expect(getDocIdsByQuery).not.toHaveBeenCalled();
    expect(result.extra).toEqual({
      searchHitIndex: null,
      groupPoints: [
        expect.objectContaining({ type: 0, depth: 0, value: 'Open' }),
        { type: 1, count: 2 },
      ],
      allGroupHeaderRefs: [expect.objectContaining({ depth: 0 })],
    });
    const query = execute.mock.calls[0]?.[1] as ListTableRecordsQuery;
    expect(query.includeGroupMetadata).toBe(true);
  });

  it('omits the legacy searchHitIndex on grouped searches instead of paging without groupBy', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [{ id: 'rec1111111111111111', fields: { [primaryFieldId]: 'A' }, version: 1 }],
        1,
        0,
        2,
        [{ fields: { [statusFieldId]: 'Open' }, count: 1 }]
      ),
    });

    const result = await service.getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 2,
      groupBy: [{ fieldId: statusFieldId, order: SortFunc.Asc }],
      search: ['A'],
    });

    // Matches are loaded speculatively in case permissions strip every group,
    // but they stay hidden while a real grouped page remains.
    expect(getDocIdsByQuery).not.toHaveBeenCalled();
    expect(result.extra?.searchHitIndex).toBeNull();
    expect(result.extra?.groupPoints).toBeDefined();
    const query = execute.mock.calls[0]?.[1] as ListTableRecordsQuery;
    expect(query.includeSearchFieldMatches).toBe(true);
  });

  it('maps native V2 search matches to searchHitIndex without any V1 call', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          { id: 'rec1111111111111111', fields: { [primaryFieldId]: 'A' }, version: 1 },
          { id: 'rec2222222222222222', fields: { [primaryFieldId]: 'B' }, version: 1 },
        ],
        2,
        0,
        2,
        undefined,
        [
          {
            index: 1,
            fieldId: FieldId.create(primaryFieldId)._unsafeUnwrap(),
            recordId: RecordId.create('rec1111111111111111')._unsafeUnwrap(),
          },
        ]
      ),
    });

    const result = await service.getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 2,
      search: ['A'],
    });

    expect(getDocIdsByQuery).not.toHaveBeenCalled();
    const query = execute.mock.calls[0]?.[1] as ListTableRecordsQuery;
    expect(query.includeSearchFieldMatches).toBe(true);
    // Row search keeps the full visible-field scope; only the extra narrows.
    expect(query.searchFieldScope).toBe('visible');
    expect(query.searchIndexMode).toBeUndefined();
    expect(query.requireReadableSearchFields).toBeUndefined();
    expect(result.extra).toEqual({
      searchHitIndex: [{ fieldId: primaryFieldId, recordId: 'rec1111111111111111' }],
    });
  });

  it('drops search hits outside the projection from the extra, like V1', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [{ id: 'rec1111111111111111', fields: { [primaryFieldId]: 'A' }, version: 1 }],
        1,
        0,
        2,
        undefined,
        [
          {
            index: 1,
            fieldId: FieldId.create(statusFieldId)._unsafeUnwrap(),
            recordId: RecordId.create('rec1111111111111111')._unsafeUnwrap(),
          },
        ]
      ),
    });

    const result = await service.getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 2,
      search: ['A'],
      projection: [primaryFieldId],
    });

    // The status-field hit filtered rows but is not projected — omit it.
    expect(result.extra).toEqual({ searchHitIndex: null });
  });

  it('returns a null search hit index when a searched page has no matches', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 0, 0, 2),
    });

    const result = await service.getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 2,
      search: ['no-hit'],
    });

    expect(getDocIdsByQuery).not.toHaveBeenCalled();
    expect(result.records).toEqual([]);
    expect(result.extra).toEqual({ searchHitIndex: null });
  });

  it('does not request search matches without a search query', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;

    const result = await service.getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 2,
    });

    const query = execute.mock.calls[0]?.[1] as ListTableRecordsQuery;
    expect(query.includeSearchFieldMatches).toBeFalsy();
    expect(result.extra).toBeUndefined();
  });

  it('keeps projected group metadata on generated-index searches', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    const groupBy = [{ fieldId: statusFieldId, order: SortFunc.Asc }];
    resolveForRecordSearch.mockResolvedValueOnce({
      kind: 'generated_tsvector',
      generatedColumnName: '__tqops_search_vector',
      languageConfig: 'simple',
      searchScope: 'all_fields',
      coveredFieldIds: [FieldId.create(statusFieldId)._unsafeUnwrap()],
    });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 1, 0, 1, [
        { fields: { [statusFieldId]: 'Open' }, count: 1 },
      ]),
    });

    const result = await service.getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      groupBy,
      projection: [statusFieldId],
      search: ['Open'],
    });

    const query = execute.mock.calls[0]?.[1] as ListTableRecordsQuery;
    expect(query.includeGroupMetadata).toBe(true);
    expect(getDocIdsByQuery).not.toHaveBeenCalled();
    expect(result.extra?.groupPoints).toEqual([
      expect.objectContaining({ type: 0, depth: 0, value: 'Open' }),
      { type: 1, count: 1 },
    ]);
  });

  it('keeps authority-matrix row scope and client filter on the V2 grouped query', async () => {
    const recordSpec = { isSatisfiedBy: () => true } as never;
    pluginPrepare.mockResolvedValueOnce({
      isErr: () => false,
      value: {
        guard: async () => ({ isErr: () => false, value: undefined }),
        getScope: () => ({
          isErr: () => false,
          value: {
            recordSpec,
            readableFieldIds: new Set([primaryFieldId, statusFieldId]),
            legacyPermissionQueryCompatible: true,
          },
        }),
      },
    });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 1, 0, 1, [
        { fields: { [statusFieldId]: 'Open' }, count: 1 },
      ]),
    });

    const result = await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 2,
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: primaryFieldId,
            operator: 'contains',
            value: 'ticket',
          },
        ],
      },
      groupBy: [{ fieldId: statusFieldId, order: SortFunc.Asc }],
    });

    const query = execute.mock.calls[0]?.[1] as ListTableRecordsQuery;
    expect(query.queryScope?.recordSpec).toBe(recordSpec);
    expect(query.queryScope?.readableFieldIds).toEqual(new Set([primaryFieldId, statusFieldId]));
    expect(query.filter).toEqual({
      conjunction: 'and',
      items: [{ fieldId: primaryFieldId, operator: 'contains', value: 'ticket' }],
    });
    expect(query.includeGroupMetadata).toBe(true);
    expect(getDocIdsByQuery).not.toHaveBeenCalled();
    expect(result.extra?.groupPoints).toEqual([
      expect.objectContaining({ type: 0, depth: 0, value: 'Open' }),
      { type: 1, count: 1 },
    ]);
  });

  it('preserves the V1 null checkbox group-header value', async () => {
    testTable = createTestTable((builder) => {
      builder
        .field()
        .checkbox()
        .withId(FieldId.create(checkboxFieldId)._unsafeUnwrap())
        .withName(FieldName.create('Done')._unsafeUnwrap())
        .done();
    });
    tableFindOne.mockResolvedValue({ isErr: () => false, value: testTable });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 1, 0, 1, [
        { fields: { [checkboxFieldId]: null }, count: 1 },
      ]),
    });

    const result = await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 2,
      groupBy: [{ fieldId: checkboxFieldId, order: SortFunc.Asc }],
    });

    expect(result.extra?.groupPoints).toEqual([
      expect.objectContaining({ type: 0, depth: 0, value: null }),
      { type: 1, count: 1 },
    ]);
  });

  it('normalizes generated user group header avatars to the public avatar URL', async () => {
    const userId = `usr${'g'.repeat(16)}`;
    testTable = createTestTable((builder) => {
      builder
        .field()
        .createdBy()
        .withId(FieldId.create(createdByFieldId)._unsafeUnwrap())
        .withName(FieldName.create('Created By')._unsafeUnwrap())
        .done();
    });
    tableFindOne.mockResolvedValue({ isErr: () => false, value: testTable });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 1, 0, 1, [
        {
          fields: {
            [createdByFieldId]: {
              id: userId,
              title: 'Grace',
              avatarUrl: '/api/attachments/avatar/grace.png',
            },
          },
          count: 1,
        },
      ]),
    });

    const result = await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      groupBy: [{ fieldId: createdByFieldId, order: SortFunc.Asc }],
    });

    expect(result.extra?.groupPoints).toEqual([
      expect.objectContaining({
        type: 0,
        depth: 0,
        value: {
          id: userId,
          title: 'Grace',
          avatarUrl: expect.stringContaining(`/avatar/${userId}`),
        },
      }),
      { type: 1, count: 1 },
    ]);
  });

  it('folds header-less repository group buckets into the previous row block', async () => {
    const userFieldId = `fld${'w'.repeat(16)}`;
    const firstUserId = `usr${'a'.repeat(16)}`;
    const secondUserId = `usr${'h'.repeat(16)}`;
    testTable = createTestTable((builder) => {
      builder
        .field()
        .user()
        .withId(FieldId.create(userFieldId)._unsafeUnwrap())
        .withName(FieldName.create('Assignee')._unsafeUnwrap())
        .done();
    });
    tableFindOne.mockResolvedValue({ isErr: () => false, value: testTable });
    // Buckets keyed finer than the {id, title} identity (snapshot drift) must
    // merge into one row block instead of a second, header-less row segment.
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 6, 0, 1, [
        {
          fields: {
            [userFieldId]: { id: firstUserId, title: 'Grace', email: 'grace@old.example' },
          },
          count: 2,
        },
        {
          fields: {
            [userFieldId]: { id: firstUserId, title: 'Grace', email: 'grace@new.example' },
          },
          count: 3,
        },
        { fields: { [userFieldId]: { id: secondUserId, title: 'Heidi' } }, count: 1 },
      ]),
    });

    const result = await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      groupBy: [{ fieldId: userFieldId, order: SortFunc.Asc }],
    });

    expect(result.extra?.groupPoints).toEqual([
      expect.objectContaining({
        type: 0,
        depth: 0,
        value: expect.objectContaining({ id: firstUserId, title: 'Grace' }),
      }),
      { type: 1, count: 5 },
      expect.objectContaining({
        type: 0,
        depth: 0,
        value: expect.objectContaining({ id: secondUserId, title: 'Heidi' }),
      }),
      { type: 1, count: 1 },
    ]);
  });

  it('hydrates legacy generated user ids in group headers', async () => {
    const userId = `usr${'g'.repeat(16)}`;
    const listUsersByIds = vi.fn().mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: [{ id: userId, name: 'Grace', email: 'grace@example.com' }],
    });
    testTable = createTestTable((builder) => {
      builder
        .field()
        .createdBy()
        .withId(FieldId.create(createdByFieldId)._unsafeUnwrap())
        .withName(FieldName.create('Created By')._unsafeUnwrap())
        .done();
    });
    tableFindOne.mockResolvedValue({ isErr: () => false, value: testTable });
    isRegistered.mockImplementation(
      (token) =>
        token === v2CoreTokens.queryBus ||
        token === v2CoreTokens.commandBus ||
        token === v2CoreTokens.tableRepository ||
        token === v2CoreTokens.recordQueryPluginRunner ||
        token === v2CoreTokens.userLookupService
    );
    resolve.mockImplementation((token) => {
      if (token === v2CoreTokens.queryBus) return { execute };
      if (token === v2CoreTokens.commandBus) return { execute: commandExecute };
      if (token === v2CoreTokens.tableRepository) return { findOne: tableFindOne };
      if (token === v2CoreTokens.recordQueryPluginRunner) return { prepare: pluginPrepare };
      if (token === v2CoreTokens.userLookupService) return { listUsersByIds };
      return undefined;
    });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 1, 0, 1, [
        { fields: { [createdByFieldId]: userId }, count: 1 },
      ]),
    });

    const result = await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      groupBy: [{ fieldId: createdByFieldId, order: SortFunc.Asc }],
    });

    // Group-header hydration deliberately resolves deleted users too (display
    // enrichment keeps historical owner names), so the lookup opts into them.
    expect(listUsersByIds).toHaveBeenCalledWith([userId], { includeDeleted: true });
    expect(result.extra?.groupPoints).toEqual([
      expect.objectContaining({
        type: 0,
        depth: 0,
        value: {
          id: userId,
          title: 'Grace',
          avatarUrl: expect.stringContaining(`/avatar/${userId}`),
        },
      }),
      { type: 1, count: 1 },
    ]);
  });

  it('skips grouped query extra when includeQueryExtra is false', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    const groupBy = [{ fieldId: statusFieldId, order: SortFunc.Asc }];

    const result = await service.getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 2,
      groupBy,
      includeQueryExtra: false,
    });

    expect(getDocIdsByQuery).not.toHaveBeenCalled();
    expect(result.extra).toBeUndefined();

    const query = execute.mock.calls[0]?.[1];
    expect(query).toBeInstanceOf(ListTableRecordsQuery);
    expect((query as ListTableRecordsQuery).sort).toEqual(groupBy);
    expect((query as ListTableRecordsQuery).groupBy).toEqual([statusFieldId]);
  });

  it('loads grouped query extra by default for projected record reads', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    const groupBy = [{ fieldId: statusFieldId, order: SortFunc.Asc }];
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 2, 0, 2, [
        { fields: { [statusFieldId]: 'Open' }, count: 2 },
      ]),
    });

    const result = await service.getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 2,
      groupBy,
      projection: [statusFieldId, noteFieldId],
    });

    expect(getDocIdsByQuery).not.toHaveBeenCalled();
    expect(result.extra?.groupPoints).toEqual([
      expect.objectContaining({ type: 0, depth: 0, value: 'Open' }),
      { type: 1, count: 2 },
    ]);

    const query = execute.mock.calls[0]?.[1];
    expect(query).toBeInstanceOf(ListTableRecordsQuery);
    expect((query as ListTableRecordsQuery).sort).toEqual(groupBy);
    expect((query as ListTableRecordsQuery).groupBy).toEqual([statusFieldId]);
  });

  it('loads grouped query extra for projected record reads when explicitly requested', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    const groupBy = [{ fieldId: statusFieldId, order: SortFunc.Asc }];
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 2, 0, 2, [
        { fields: { [statusFieldId]: 'Open' }, count: 2 },
      ]),
    });

    const result = await service.getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 2,
      groupBy,
      projection: [statusFieldId, noteFieldId],
      includeQueryExtra: true,
    });

    expect(getDocIdsByQuery).not.toHaveBeenCalled();
    expect(result.extra?.groupPoints).toEqual([
      expect.objectContaining({ type: 0, depth: 0, value: 'Open' }),
      { type: 1, count: 2 },
    ]);
  });

  it('does not synthesize an unknown group when the v2 handler strips all group keys', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    const groupBy = [{ fieldId: statusFieldId, order: SortFunc.Asc }];
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 2, 0, 2),
    });

    const result = await service.getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      groupBy,
      includeQueryExtra: true,
    });

    expect(result.extra?.groupPoints).toBeUndefined();
  });

  it('keeps search hit metadata when the v2 handler strips all group keys', async () => {
    const recordId = 'rec1111111111111111';
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [{ id: recordId, fields: { [primaryFieldId]: 'A' }, version: 1 }],
        1,
        0,
        2,
        undefined,
        [
          {
            index: 1,
            fieldId: FieldId.create(primaryFieldId)._unsafeUnwrap(),
            recordId: RecordId.create(recordId)._unsafeUnwrap(),
          },
        ]
      ),
    });

    const result = await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      groupBy: [{ fieldId: statusFieldId, order: SortFunc.Asc }],
      search: ['A'],
      includeQueryExtra: true,
    });

    const query = execute.mock.calls[0]?.[1] as ListTableRecordsQuery;
    expect(query.includeSearchFieldMatches).toBe(true);
    expect(result.extra).toEqual({
      searchHitIndex: [{ fieldId: primaryFieldId, recordId }],
    });
  });

  it('builds group extra from the group levels applied by the v2 handler', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [],
        3,
        0,
        3,
        [
          { fields: { [statusFieldId]: 'Open' }, count: 2 },
          { fields: { [statusFieldId]: 'Closed' }, count: 1 },
        ],
        undefined,
        [{ fieldId: statusFieldId, order: 'asc' }]
      ),
    });

    const result = await service.getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      groupBy: [
        { fieldId: noteFieldId, order: SortFunc.Asc },
        { fieldId: statusFieldId, order: SortFunc.Asc },
      ],
      includeQueryExtra: true,
    });

    expect(
      result.extra?.groupPoints
        ?.filter((point) => point.type === GroupPointType.Header)
        .map((point) => ({ depth: point.depth, value: point.value }))
    ).toEqual([
      { depth: 0, value: 'Open' },
      { depth: 0, value: 'Closed' },
    ]);
  });

  it('reads records through pure v2 list without legacy snapshot bulk', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;

    const result = await service.getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 2,
    });

    expect(result.records.map((record) => record.id)).toEqual([
      'rec1111111111111111',
      'rec2222222222222222',
    ]);
    expect(getSnapshotBulkWithPermission).not.toHaveBeenCalled();
    expect(getFieldsByQuery).not.toHaveBeenCalled();
    expect(pluginPrepare).toHaveBeenCalled();
    expect(tableFindOne).toHaveBeenCalled();
  });

  it('preserves ID-keyed record presentation while omitting empty cells', async () => {
    const userId = `usr${'a'.repeat(16)}`;
    testTable = createTestTable((builder) => {
      builder
        .field()
        .checkbox()
        .withId(FieldId.create(checkboxFieldId)._unsafeUnwrap())
        .withName(FieldName.create('Done')._unsafeUnwrap())
        .done();
      builder
        .field()
        .createdBy()
        .withId(FieldId.create(createdByFieldId)._unsafeUnwrap())
        .withName(FieldName.create('Created By')._unsafeUnwrap())
        .done();
    });
    tableFindOne.mockResolvedValue({ isErr: () => false, value: testTable });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          {
            id: 'rec1111111111111111',
            fields: {
              [primaryFieldId]: 'A',
              [statusFieldId]: '',
              [noteFieldId]: null,
              [checkboxFieldId]: false,
            },
            version: 1,
            createdBy: userId,
          },
          {
            id: 'rec2222222222222222',
            fields: {
              [primaryFieldId]: 'B',
              [checkboxFieldId]: true,
            },
            version: 1,
          },
        ],
        2,
        0,
        2
      ),
    });

    const result = await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      cellFormat: CellFormat.Json,
      skip: 0,
      take: 2,
    });

    expect(result.records[0]?.fields).toEqual({
      [primaryFieldId]: 'A',
      [statusFieldId]: '',
      [createdByFieldId]: expect.objectContaining({
        id: userId,
        title: userId,
      }),
    });
    expect(result.records[0]?.name).toBe('A');
    expect(result.records[1]?.fields).toEqual({
      [primaryFieldId]: 'B',
      [checkboxFieldId]: true,
    });
  });

  it('hydrates legacy generated audit-user ids into public user cells', async () => {
    const userId = `usr${'a'.repeat(16)}`;
    const listUsersByIds = vi.fn().mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: [
        {
          id: userId,
          name: 'Alice',
          email: 'alice@example.com',
          avatarUrl: '/api/attachments/avatar/alice.png',
        },
      ],
    });
    testTable = createTestTable((builder) => {
      builder
        .field()
        .createdBy()
        .withId(FieldId.create(createdByFieldId)._unsafeUnwrap())
        .withName(FieldName.create('Created By')._unsafeUnwrap())
        .done();
    });
    tableFindOne.mockResolvedValue({ isErr: () => false, value: testTable });
    isRegistered.mockImplementation(
      (token) =>
        token === v2CoreTokens.queryBus ||
        token === v2CoreTokens.commandBus ||
        token === v2CoreTokens.tableRepository ||
        token === v2CoreTokens.recordQueryPluginRunner ||
        token === v2CoreTokens.userLookupService
    );
    resolve.mockImplementation((token) => {
      if (token === v2CoreTokens.queryBus) return { execute };
      if (token === v2CoreTokens.commandBus) return { execute: commandExecute };
      if (token === v2CoreTokens.tableRepository) return { findOne: tableFindOne };
      if (token === v2CoreTokens.recordQueryPluginRunner) return { prepare: pluginPrepare };
      if (token === v2CoreTokens.userLookupService) return { listUsersByIds };
      return undefined;
    });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          {
            id: 'rec1111111111111111',
            fields: {
              [primaryFieldId]: 'A',
              [createdByFieldId]: userId,
            },
            version: 1,
          },
        ],
        1,
        0,
        1
      ),
    });

    const result = await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 1,
    });

    expect(listUsersByIds).toHaveBeenCalledWith([userId], { includeDeleted: true });
    expect(result.records[0]?.fields[createdByFieldId]).toEqual({
      id: userId,
      title: 'Alice',
      email: 'alice@example.com',
      avatarUrl: expect.stringContaining(`/avatar/${userId}`),
    });
  });

  it('resolves last-modified-by user names for legacy raw-id cells', async () => {
    const lastModifiedByFieldId = `fld${'e'.repeat(16)}`;
    const userId = `usr${'a'.repeat(16)}`;
    const listUsersByIds = vi.fn().mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: [
        {
          id: userId,
          name: 'Bieber',
          email: 'bieber@example.com',
        },
      ],
    });
    testTable = createTestTable((builder) => {
      builder
        .field()
        .lastModifiedBy()
        .withId(FieldId.create(lastModifiedByFieldId)._unsafeUnwrap())
        .withName(FieldName.create('Last Modified By')._unsafeUnwrap())
        .done();
    });
    tableFindOne.mockResolvedValue({ isErr: () => false, value: testTable });
    isRegistered.mockImplementation(
      (token) =>
        token === v2CoreTokens.queryBus ||
        token === v2CoreTokens.commandBus ||
        token === v2CoreTokens.tableRepository ||
        token === v2CoreTokens.recordQueryPluginRunner ||
        token === v2CoreTokens.userLookupService
    );
    resolve.mockImplementation((token) => {
      if (token === v2CoreTokens.queryBus) return { execute };
      if (token === v2CoreTokens.commandBus) return { execute: commandExecute };
      if (token === v2CoreTokens.tableRepository) return { findOne: tableFindOne };
      if (token === v2CoreTokens.recordQueryPluginRunner) return { prepare: pluginPrepare };
      if (token === v2CoreTokens.userLookupService) return { listUsersByIds };
      return undefined;
    });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          {
            id: 'rec1111111111111111',
            fields: {
              [primaryFieldId]: 'A',
              [lastModifiedByFieldId]: userId,
            },
            version: 1,
          },
        ],
        1,
        0,
        1
      ),
    });

    const result = await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 1,
    });

    expect(listUsersByIds).toHaveBeenCalledWith([userId], { includeDeleted: true });
    expect(result.records[0]?.fields[lastModifiedByFieldId]).toEqual({
      id: userId,
      title: 'Bieber',
      email: 'bieber@example.com',
      avatarUrl: expect.stringContaining(`/avatar/${userId}`),
    });
  });

  it('hydrates lookup user cells and conditional-lookup user group headers', async () => {
    const userId = `usr${'w'.repeat(16)}`;
    const listUsersByIds = vi.fn().mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: [{ id: userId, name: 'Wendy', email: 'wendy@example.com' }],
    });
    const innerUser = createUserField({
      id: FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap(),
      name: FieldName.create('Inner user')._unsafeUnwrap(),
      isMultiple: UserMultiplicity.single(),
    })._unsafeUnwrap();
    testTable = createTestTable((builder) => {
      builder.addFieldFromResult(
        LookupField.create({
          id: FieldId.create(lookupUserFieldId)._unsafeUnwrap(),
          name: FieldName.create('Lookup user')._unsafeUnwrap(),
          innerField: innerUser,
          lookupOptions: createLookupOptions('r'),
          isMultipleCellValue: true,
        })
      );
      builder.addFieldFromResult(
        createConditionalLookupField({
          id: FieldId.create(conditionalUserFieldId)._unsafeUnwrap(),
          name: FieldName.create('Conditional user')._unsafeUnwrap(),
          innerField: innerUser,
          conditionalLookupOptions: createConditionalLookupOptions('u'),
          isMultipleCellValue: true,
        })
      );
    });
    tableFindOne.mockResolvedValue({ isErr: () => false, value: testTable });
    isRegistered.mockImplementation(
      (token) =>
        token === v2CoreTokens.queryBus ||
        token === v2CoreTokens.commandBus ||
        token === v2CoreTokens.tableRepository ||
        token === v2CoreTokens.recordQueryPluginRunner ||
        token === v2CoreTokens.userLookupService
    );
    resolve.mockImplementation((token) => {
      if (token === v2CoreTokens.queryBus) return { execute };
      if (token === v2CoreTokens.commandBus) return { execute: commandExecute };
      if (token === v2CoreTokens.tableRepository) return { findOne: tableFindOne };
      if (token === v2CoreTokens.recordQueryPluginRunner) return { prepare: pluginPrepare };
      if (token === v2CoreTokens.userLookupService) return { listUsersByIds };
      return undefined;
    });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          {
            id: 'rec1111111111111111',
            fields: {
              [primaryFieldId]: 'A',
              [lookupUserFieldId]: [
                {
                  id: userId,
                  title: userId,
                  avatarUrl: '/api/attachments/avatar/legacy.png',
                },
              ],
              [conditionalUserFieldId]: [
                {
                  id: userId,
                  title: userId,
                  avatarUrl: '/api/attachments/avatar/legacy.png',
                },
              ],
            },
            version: 1,
          },
        ],
        1,
        0,
        1,
        [
          {
            fields: {
              [conditionalUserFieldId]: [
                {
                  id: userId,
                  title: userId,
                  avatarUrl: '/api/attachments/avatar/legacy.png',
                },
              ],
            },
            count: 1,
          },
        ]
      ),
    });

    const result = await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      groupBy: [{ fieldId: conditionalUserFieldId, order: SortFunc.Asc }],
    });

    expect(listUsersByIds).toHaveBeenCalledWith([userId], { includeDeleted: true });
    expect(result.records[0]?.fields[lookupUserFieldId]).toEqual([
      {
        id: userId,
        title: 'Wendy',
        email: 'wendy@example.com',
        avatarUrl: expect.stringContaining(`/avatar/${userId}`),
      },
    ]);
    expect(result.records[0]?.fields[conditionalUserFieldId]).toEqual([
      {
        id: userId,
        title: 'Wendy',
        email: 'wendy@example.com',
        avatarUrl: expect.stringContaining(`/avatar/${userId}`),
      },
    ]);
    expect(result.extra?.groupPoints).toEqual([
      expect.objectContaining({
        type: 0,
        depth: 0,
        value: [
          {
            id: userId,
            title: 'Wendy',
            avatarUrl: expect.stringContaining(`/avatar/${userId}`),
          },
        ],
      }),
      { type: 1, count: 1 },
    ]);
  });

  it('does not fill tracked-subset LastModifiedBy cells from the record system user', async () => {
    const lastModifiedByFieldId = `fld${'x'.repeat(16)}`;
    const userId = `usr${'a'.repeat(16)}`;
    testTable = createTestTable((builder) => {
      builder
        .field()
        .lastModifiedBy()
        .withId(FieldId.create(lastModifiedByFieldId)._unsafeUnwrap())
        .withName(FieldName.create('Last Modified By')._unsafeUnwrap())
        .withTrackedFieldIds([FieldId.create(primaryFieldId)._unsafeUnwrap()])
        .done();
    });
    tableFindOne.mockResolvedValue({ isErr: () => false, value: testTable });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          {
            id: 'rec1111111111111111',
            fields: { [primaryFieldId]: 'A' },
            version: 1,
            lastModifiedBy: userId,
          },
        ],
        1,
        0,
        1
      ),
    });

    const result = await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 1,
    });

    expect(result.records[0]?.lastModifiedBy).toBe(userId);
    expect(result.records[0]?.fields).not.toHaveProperty(lastModifiedByFieldId);
  });

  it('uses each field formatter for cellFormat=text record values', async () => {
    testTable = createTestTable((builder) => {
      builder
        .field()
        .number()
        .withId(FieldId.create(formattedNumberFieldId)._unsafeUnwrap())
        .withName(FieldName.create('Amount')._unsafeUnwrap())
        .withFormatting(NumberFormatting.create({ type: 'decimal', precision: 2 })._unsafeUnwrap())
        .done();
    });
    tableFindOne.mockResolvedValue({ isErr: () => false, value: testTable });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          {
            id: 'rec1111111111111111',
            fields: {
              [primaryFieldId]: 'A',
              [formattedNumberFieldId]: 1.234,
            },
            version: 1,
          },
        ],
        1,
        0,
        1
      ),
    });

    const result = await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      cellFormat: CellFormat.Text,
      skip: 0,
      take: 1,
    });

    expect(result.records[0]?.fields[formattedNumberFieldId]).toBe('1.23');
  });

  it('uses conditional lookup inner formatting for cellFormat=text values', async () => {
    const innerNumber = createNumberField({
      id: FieldId.create(`fld${'j'.repeat(16)}`)._unsafeUnwrap(),
      name: FieldName.create('Inner amount')._unsafeUnwrap(),
      formatting: NumberFormatting.create({ type: 'decimal', precision: 2 })._unsafeUnwrap(),
    })._unsafeUnwrap();
    testTable = createTestTable((builder) => {
      builder.addFieldFromResult(
        createConditionalLookupField({
          id: FieldId.create(conditionalNumberFieldId)._unsafeUnwrap(),
          name: FieldName.create('Conditional amount')._unsafeUnwrap(),
          innerField: innerNumber,
          conditionalLookupOptions: createConditionalLookupOptions('n'),
          isMultipleCellValue: false,
        })
      );
    });
    tableFindOne.mockResolvedValue({ isErr: () => false, value: testTable });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          {
            id: 'rec1111111111111111',
            fields: {
              [primaryFieldId]: 'A',
              [conditionalNumberFieldId]: 1.234,
            },
            version: 1,
          },
        ],
        1,
        0,
        1
      ),
    });

    const result = await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      cellFormat: CellFormat.Text,
      skip: 0,
      take: 1,
    });

    expect(result.records[0]?.fields[conditionalNumberFieldId]).toBe('1.23');
  });

  it('uses the primary field formatter for JSON record names', async () => {
    const builder = Table.builder()
      .withId(TableId.create(tableIdText)._unsafeUnwrap())
      .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
      .withName(TableName.create('Formatted primary')._unsafeUnwrap());
    builder
      .field()
      .number()
      .withId(FieldId.create(formattedNumberFieldId)._unsafeUnwrap())
      .withName(FieldName.create('Amount')._unsafeUnwrap())
      .withFormatting(NumberFormatting.create({ type: 'decimal', precision: 2 })._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();
    testTable = builder.build()._unsafeUnwrap();
    tableFindOne.mockResolvedValue({ isErr: () => false, value: testTable });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          {
            id: 'rec1111111111111111',
            fields: { [formattedNumberFieldId]: 1.234 },
            version: 1,
          },
        ],
        1,
        0,
        1
      ),
    });

    const result = await service.getRecords(tableIdText, {
      fieldKeyType: FieldKeyType.Id,
      cellFormat: CellFormat.Json,
      skip: 0,
      take: 1,
    });

    expect(result.records[0]?.name).toBe('1.23');
    expect(result.records[0]?.fields[formattedNumberFieldId]).toBe(1.234);
  });

  it('builds ShareDB snapshots from pure v2 records with persisted versions and getByIds scope', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          {
            id: 'rec1111111111111111',
            fields: { [primaryFieldId]: 'A' },
            version: 7,
            autoNumber: 1,
            createdTime: createdTimeIso,
          },
        ],
        1,
        0,
        1
      ),
    });

    const result = await service.getSocketSnapshotBulk(tableId, ['rec1111111111111111'], {
      [primaryFieldId]: true,
    });

    expect(result).toEqual([
      {
        id: 'rec1111111111111111',
        v: 7,
        type: 'json0',
        data: {
          id: 'rec1111111111111111',
          fields: { [primaryFieldId]: 'A' },
          name: 'A',
          autoNumber: 1,
          createdTime: createdTimeIso,
        },
      },
    ]);
    expect(pluginPrepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'getByIds',
        payload: expect.objectContaining({
          recordIds: ['rec1111111111111111'],
          projectionFieldIds: [primaryFieldId],
          ignoreViewQuery: true,
          keepPrimaryKey: true,
        }),
      })
    );
    expect(getSnapshotBulkWithPermission).not.toHaveBeenCalled();
  });

  it('loads 18 records by id in one v2 query and preserves requested order', async () => {
    const recordIds = Array.from(
      { length: 18 },
      (_, index) => `rec${String(index).padStart(16, '0')}`
    );
    execute.mockImplementationOnce(async (_context, query: ListTableRecordsQuery) => {
      const selectedRecordIds = [...(query.selectedRecordIds ?? [])].reverse();
      return {
        isErr: () => false,
        value: ListTableRecordsResult.create(
          selectedRecordIds.map((recordId, index) => ({
            id: recordId,
            fields: { [primaryFieldId]: `value-${index}` },
            version: index + 1,
          })),
          selectedRecordIds.length,
          0,
          selectedRecordIds.length
        ),
      };
    });

    const result = await service.getRecordsByIds(tableIdText, recordIds, {
      projection: [primaryFieldId],
      fieldKeyType: FieldKeyType.Id,
      cellFormat: CellFormat.Json,
    });

    expect(result.map((record) => record.id)).toEqual(recordIds);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(pluginPrepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'getByIds',
        payload: expect.objectContaining({
          recordIds,
          projectionFieldIds: [primaryFieldId],
          ignoreViewQuery: true,
          keepPrimaryKey: false,
        }),
      })
    );
  });

  it('throws instead of silently dropping a missing record when throwOnMissing is set', async () => {
    const recordIds = Array.from(
      { length: 18 },
      (_, index) => `rec${String(index).padStart(16, '0')}`
    );
    execute.mockImplementationOnce(async (_context, query: ListTableRecordsQuery) => {
      // Return every requested record except the last one.
      const selectedRecordIds = (query.selectedRecordIds ?? []).slice(0, -1);
      return {
        isErr: () => false,
        value: ListTableRecordsResult.create(
          selectedRecordIds.map((recordId, index) => ({
            id: recordId,
            fields: { [primaryFieldId]: `value-${index}` },
            version: index + 1,
          })),
          selectedRecordIds.length,
          0,
          selectedRecordIds.length
        ),
      };
    });

    await expect(
      service.getRecordsByIds(tableIdText, recordIds, {
        projection: [primaryFieldId],
        fieldKeyType: FieldKeyType.Id,
        cellFormat: CellFormat.Json,
        throwOnMissing: true,
      })
    ).rejects.toMatchObject({ message: 'Record not found' });
  });

  it('chunks ShareDB snapshot reads above the public list limit', async () => {
    const recordIds = Array.from(
      { length: 1001 },
      (_, index) => `rec${String(index).padStart(16, '0')}`
    );
    execute.mockImplementation(async (_context, query: ListTableRecordsQuery) => {
      const selectedRecordIds = query.selectedRecordIds ?? [];
      return {
        isErr: () => false,
        value: ListTableRecordsResult.create(
          selectedRecordIds.map((recordId, index) => ({
            id: recordId,
            fields: { [primaryFieldId]: recordId },
            version: index + 1,
          })),
          selectedRecordIds.length,
          0,
          selectedRecordIds.length
        ),
      };
    });

    const result = await service.getSocketSnapshotBulk(tableIdText, recordIds, {
      [primaryFieldId]: true,
    });

    expect(result).toHaveLength(1001);
    expect(result.map((snapshot) => snapshot.id)).toEqual(recordIds);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(
      execute.mock.calls.map((call) => (call[1] as ListTableRecordsQuery).selectedRecordIds?.length)
    ).toEqual([1000, 1]);
  });

  it('resolves ShareDB query ids through the v2 list scope without legacy doc-id reads', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;

    const result = await service.getSocketDocIds(tableId, {
      viewId: `viw${'v'.repeat(16)}`,
      skip: 0,
      take: 2,
    });

    expect(result).toEqual({
      ids: ['rec1111111111111111', 'rec2222222222222222'],
    });
    expect(pluginPrepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'list',
        payload: expect.objectContaining({
          viewId: `viw${'v'.repeat(16)}`,
          limit: 2,
          offset: 0,
        }),
      })
    );
    const query = execute.mock.calls[0]?.[1] as ListTableRecordsQuery;
    expect(query.projection).toEqual([]);
    expect(getDocIdsByQuery).not.toHaveBeenCalled();
  });

  it('keeps searchHitIndex on ShareDB doc-ids when cell projection is empty', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          { id: 'rec1111111111111111', fields: {}, version: 1 },
          { id: 'rec2222222222222222', fields: {}, version: 1 },
        ],
        2,
        0,
        2,
        undefined,
        [
          {
            index: 1,
            fieldId: FieldId.create(primaryFieldId)._unsafeUnwrap(),
            recordId: RecordId.create('rec1111111111111111')._unsafeUnwrap(),
          },
          {
            index: 1,
            fieldId: FieldId.create(statusFieldId)._unsafeUnwrap(),
            recordId: RecordId.create('rec2222222222222222')._unsafeUnwrap(),
          },
        ]
      ),
    });

    const result = await service.getSocketDocIds(tableId, {
      skip: 0,
      take: 2,
      search: ['2'],
    });

    const query = execute.mock.calls[0]?.[1] as ListTableRecordsQuery;
    expect(query.projection).toEqual([]);
    expect(query.includeSearchFieldMatches).toBe(true);
    expect(query.searchIndexMode).toBe('matched');
    expect(query.requireReadableSearchFields).toBe(true);
    expect(result.extra).toEqual({
      searchHitIndex: [
        { fieldId: primaryFieldId, recordId: 'rec1111111111111111' },
        { fieldId: statusFieldId, recordId: 'rec2222222222222222' },
      ],
    });
  });

  it('keeps ShareDB membership on the v2 list query when a plugin mask is present', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    const recordSpec = { isSatisfiedBy: () => true } as never;
    pluginPrepare.mockResolvedValueOnce({
      isErr: () => false,
      value: {
        guard: async () => ({ isErr: () => false, value: undefined }),
        getScope: () => ({
          isErr: () => false,
          value: {
            recordSpec,
            fieldMasks: [{ fieldId: statusFieldId, visibleWhen: recordSpec }],
            legacyPermissionQueryCompatible: true,
          },
        }),
      },
    });

    const result = await service.getSocketDocIds(tableId, {
      groupBy: [{ fieldId: statusFieldId, order: SortFunc.Asc }],
      skip: 0,
      take: 2,
    });

    expect(result.ids).toEqual(['rec1111111111111111', 'rec2222222222222222']);
    expect(getDocIdsByQuery).not.toHaveBeenCalled();
    const query = execute.mock.calls[0]?.[1] as ListTableRecordsQuery;
    expect(query.queryScope?.recordSpec).toBe(recordSpec);
  });

  describe('ShareDB authorization compatibility matrix', () => {
    it('keeps masked ShareDB membership on the v2 list query', async () => {
      const recordSpec = { isSatisfiedBy: () => true } as never;
      pluginPrepare.mockResolvedValueOnce({
        isErr: () => false,
        value: {
          guard: async () => ({ isErr: () => false, value: undefined }),
          getScope: () => ({
            isErr: () => false,
            value: {
              recordSpec,
              fieldMasks: [{ fieldId: statusFieldId, visibleWhen: recordSpec }],
              legacyPermissionQueryCompatible: true,
            },
          }),
        },
      });

      const result = await service.getSocketDocIds(tableIdText, {
        groupBy: [{ fieldId: statusFieldId, order: SortFunc.Asc }],
        skip: 0,
        take: 3,
      });

      expect(result.ids).toEqual(['rec1111111111111111', 'rec2222222222222222']);
      expect(getDocIdsByQuery).not.toHaveBeenCalled();
    });

    it.each([
      {
        label: 'masked sort without query extra',
        query: {
          orderBy: [{ fieldId: statusFieldId, order: SortFunc.Asc }],
          includeQueryExtra: false,
        },
      },
      {
        label: 'masked group without query extra',
        query: {
          groupBy: [{ fieldId: statusFieldId, order: SortFunc.Asc }],
          includeQueryExtra: false,
        },
      },
      {
        label: 'masked search without query extra',
        query: {
          search: ['secret', statusFieldId, true] as [string, string, boolean],
          includeQueryExtra: false,
        },
      },
    ])('keeps $label on the v2 list query', async ({ query }) => {
      const recordSpec = { isSatisfiedBy: () => true } as never;
      pluginPrepare.mockResolvedValueOnce({
        isErr: () => false,
        value: {
          guard: async () => ({ isErr: () => false, value: undefined }),
          getScope: () => ({
            isErr: () => false,
            value: {
              recordSpec,
              fieldMasks: [{ fieldId: statusFieldId, visibleWhen: recordSpec }],
              legacyPermissionQueryCompatible: true,
            },
          }),
        },
      });

      const result = await service.getSocketDocIds(tableIdText, {
        ...query,
        skip: 0,
        take: 2,
      });

      expect(result.ids).toEqual(['rec1111111111111111', 'rec2222222222222222']);
      expect(getDocIdsByQuery).not.toHaveBeenCalled();
    });

    it('stays on strict V2 when any restricting plugin removes legacy compatibility', async () => {
      const recordSpec = { isSatisfiedBy: () => true } as never;
      pluginPrepare.mockResolvedValueOnce({
        isErr: () => false,
        value: {
          guard: async () => ({ isErr: () => false, value: undefined }),
          getScope: () => ({
            isErr: () => false,
            value: {
              recordSpec,
              fieldMasks: [{ fieldId: statusFieldId, visibleWhen: recordSpec }],
            },
          }),
        },
      });

      const result = await service.getSocketDocIds(tableIdText, {
        groupBy: [{ fieldId: statusFieldId, order: SortFunc.Asc }],
        includeQueryExtra: false,
        skip: 0,
        take: 2,
      });

      expect(result.ids).toEqual(['rec1111111111111111', 'rec2222222222222222']);
      expect(getDocIdsByQuery).not.toHaveBeenCalled();
    });
  });

  it('intersects ShareDB snapshot projection with v2 readable fields', async () => {
    pluginPrepare.mockResolvedValueOnce({
      isErr: () => false,
      value: {
        guard: async () => ({ isErr: () => false, value: undefined }),
        getScope: () => ({
          isErr: () => false,
          value: { readableFieldIds: new Set([primaryFieldId]) },
        }),
      },
    });

    await service.getSocketSnapshotBulk(`tbl${'c'.repeat(16)}`, ['rec1111111111111111'], {
      [primaryFieldId]: true,
      [noteFieldId]: true,
    });

    const query = execute.mock.calls[0]?.[1] as ListTableRecordsQuery;
    expect(query.projection).toEqual([primaryFieldId]);
    expect(query.queryScope?.readableFieldIds).toEqual(new Set([primaryFieldId]));
  });

  it('applies collapsed group filters before resolving ShareDB query ids', async () => {
    const collapsedGroupId = String(string2Hash(`${statusFieldId}_Open`));
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 2, 0, 2, [
        { fields: { [statusFieldId]: 'Open' }, count: 2 },
      ]),
    });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 0, 0, 2),
    });

    await service.getSocketDocIds(`tbl${'c'.repeat(16)}`, {
      viewId: `viw${'v'.repeat(16)}`,
      groupBy: [{ fieldId: statusFieldId, order: SortFunc.Asc }],
      collapsedGroupIds: [collapsedGroupId],
      skip: 0,
      take: 2,
      includeQueryExtra: false,
    });

    expect(getGroupRelatedData).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(2);
    const query = execute.mock.calls[1]?.[1] as ListTableRecordsQuery;
    // V1 parity: null-inclusive isNot keeps empty-bucket rows visible.
    expect(query.filter).toEqual({
      conjunction: 'and',
      items: [
        {
          conjunction: 'or',
          items: [{ fieldId: statusFieldId, operator: 'isNot', value: 'Open' }],
        },
      ],
    });
  });

  it('builds range collapsed filters from group levels applied by the v2 handler', async () => {
    const collapsedGroupId = String(string2Hash(`${statusFieldId}_Open`));
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [],
        2,
        0,
        1,
        [{ fields: { [statusFieldId]: 'Open' }, count: 2 }],
        undefined,
        [{ fieldId: statusFieldId, order: 'asc' }]
      ),
    });

    const filter = await (
      service as unknown as {
        buildRangeFilter: (
          tableId: string,
          query: {
            viewId: string;
            groupBy: Array<{ fieldId: string; order: SortFunc }>;
            collapsedGroupIds: string[];
          }
        ) => Promise<unknown>;
      }
    ).buildRangeFilter(tableIdText, {
      viewId: `viw${'v'.repeat(16)}`,
      groupBy: [
        { fieldId: noteFieldId, order: SortFunc.Asc },
        { fieldId: statusFieldId, order: SortFunc.Asc },
      ],
      collapsedGroupIds: [collapsedGroupId],
    });

    expect(filter).toEqual({
      conjunction: 'and',
      items: [
        {
          conjunction: 'or',
          items: [{ fieldId: statusFieldId, operator: 'isNot', value: 'Open' }],
        },
      ],
    });
  });

  it('excludes a collapsed empty-value group with isNotEmpty', async () => {
    // Impl joins path values with Array.join, which renders null as ''.
    const collapsedGroupId = String(
      string2Hash(`${statusFieldId}_${[convertValueToStringify(null)].join('_')}`)
    );
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 2, 0, 2, [
        { fields: { [statusFieldId]: null }, count: 2 },
      ]),
    });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 0, 0, 2),
    });

    await service.getSocketDocIds(`tbl${'c'.repeat(16)}`, {
      viewId: `viw${'v'.repeat(16)}`,
      groupBy: [{ fieldId: statusFieldId, order: SortFunc.Asc }],
      collapsedGroupIds: [collapsedGroupId],
      skip: 0,
      take: 2,
      includeQueryExtra: false,
    });

    const query = execute.mock.calls[1]?.[1] as ListTableRecordsQuery;
    expect(query.filter).toEqual({
      conjunction: 'and',
      items: [
        {
          conjunction: 'or',
          items: [{ fieldId: statusFieldId, operator: 'isNotEmpty', value: null }],
        },
      ],
    });
  });

  it('excludes a collapsed date group at formatting granularity (exactFormatDate)', async () => {
    const groupValueIso = '2026-06-02T00:00:00.000Z';
    tableFindOne.mockResolvedValue({
      isErr: () => false,
      value: createTestTable((builder) => {
        builder
          .field()
          .date()
          .withId(FieldId.create(dateFieldIdText)._unsafeUnwrap())
          .withName(FieldName.create('Created Date')._unsafeUnwrap())
          .withFormatting(
            DateTimeFormatting.create({
              date: 'YYYY-MM-DD',
              time: V2TimeFormatting.None,
              timeZone: 'Asia/Shanghai',
            })._unsafeUnwrap()
          )
          .done();
      }),
    });
    const collapsedGroupId = String(string2Hash(`${dateFieldIdText}_${groupValueIso}`));
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 2, 0, 2, [
        { fields: { [dateFieldIdText]: groupValueIso }, count: 2 },
      ]),
    });
    execute.mockResolvedValueOnce({
      isErr: () => false,
      value: ListTableRecordsResult.create([], 0, 0, 2),
    });

    await service.getSocketDocIds(`tbl${'c'.repeat(16)}`, {
      viewId: `viw${'v'.repeat(16)}`,
      groupBy: [{ fieldId: dateFieldIdText, order: SortFunc.Asc }],
      collapsedGroupIds: [collapsedGroupId],
      skip: 0,
      take: 2,
      includeQueryExtra: false,
    });

    const query = execute.mock.calls[1]?.[1] as ListTableRecordsQuery;
    expect(query.filter).toEqual({
      conjunction: 'and',
      items: [
        {
          conjunction: 'or',
          items: [
            {
              fieldId: dateFieldIdText,
              operator: 'isNot',
              value: {
                // The group key is already an absolute instant: it must pass
                // through unchanged regardless of the server process timezone.
                exactDate: groupValueIso,
                mode: 'exactFormatDate',
                timeZone: 'Asia/Shanghai',
              },
            },
          ],
        },
      ],
    });
  });

  it('formats sorted top-level system datetime fields from table aggregate (no FieldService)', async () => {
    execute.mockResolvedValue({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          {
            id: 'rec1111111111111111',
            fields: { createdTime: createdTimeIso },
            version: 1,
            createdTime: createdTimeIso,
          },
        ],
        1,
        0,
        1
      ),
    });

    const result = await service.getRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Name,
      skip: 0,
      take: 1,
      orderBy: [{ fieldId: createdTimeFieldId, order: SortFunc.Asc }],
    });

    expect(result.records[0]?.createdTime).toBe('2026-03-19');
    expect(getSnapshotBulkWithPermission).not.toHaveBeenCalled();
    // Pure read path must not re-fetch fields via V1 FieldService.
    expect(getFieldsByQuery).not.toHaveBeenCalled();
  });

  it('does not normalize system datetime fields when they are not part of the active sort', async () => {
    execute.mockResolvedValue({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          {
            id: 'rec1111111111111111',
            fields: { [primaryFieldId]: 'Title' },
            version: 1,
            createdTime: createdTimeIso,
          },
        ],
        1,
        0,
        1
      ),
    });

    const result = await service.getRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 1,
    });

    expect(result.records[0]?.createdTime).toBe(createdTimeIso);
    expect(getSnapshotBulkWithPermission).not.toHaveBeenCalled();
  });

  it('applies readable field scope from query plugins to list projection', async () => {
    pluginPrepare.mockResolvedValueOnce({
      isErr: () => false,
      value: {
        guard: async () => ({ isErr: () => false, value: undefined }),
        getScope: () => ({
          isErr: () => false,
          value: { readableFieldIds: new Set(['fldVisible0000000001']) },
        }),
      },
    });
    execute.mockResolvedValue({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          {
            id: 'rec1111111111111111',
            fields: { fldVisible0000000001: 'alpha' },
            version: 1,
          },
        ],
        1,
        0,
        1
      ),
    });
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
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 1,
      viewId: `viw${'v'.repeat(16)}`,
    });

    expect(result.records[0]?.fields).toEqual({
      fldVisible0000000001: 'alpha',
    });
    expect(getSnapshotBulkWithPermission).not.toHaveBeenCalled();
    const query = execute.mock.calls[0]?.[1];
    expect((query as ListTableRecordsQuery).projection).toEqual(['fldVisible0000000001']);
    expect((query as ListTableRecordsQuery).queryScope?.readableFieldIds).toEqual(
      new Set(['fldVisible0000000001'])
    );
  });

  it('returns 403 when getRecord finds the row only outside authority row scope', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    const recordId = 'rec1111111111111111';
    const fakeSpec = {
      isSatisfiedBy: () => false,
    };
    pluginPrepare
      .mockResolvedValueOnce({
        isErr: () => false,
        value: {
          guard: async () => ({ isErr: () => false, value: undefined }),
          getScope: () => ({
            isErr: () => false,
            value: { recordSpec: fakeSpec },
          }),
        },
      })
      // first getRecords under scope: empty
      // second prepare for exists check with full scope
      .mockResolvedValueOnce({
        isErr: () => false,
        value: {
          guard: async () => ({ isErr: () => false, value: undefined }),
          getScope: () => ({
            isErr: () => false,
            value: { recordSpec: fakeSpec },
          }),
        },
      });

    execute
      .mockResolvedValueOnce({
        isErr: () => false,
        value: ListTableRecordsResult.create([], 0, 0, 1),
      })
      .mockResolvedValueOnce({
        isErr: () => false,
        value: ListTableRecordsResult.create([{ id: recordId, fields: {}, version: 1 }], 1, 0, 1),
      });

    await expect(
      service.getRecord(tableId, recordId, { fieldKeyType: FieldKeyType.Id })
    ).rejects.toMatchObject({
      response: expect.stringContaining('Record permission not allowed'),
    });
  });

  it('passes keepPrimaryKey into the query plugin for filterLinkCellSelected', async () => {
    const tableId = `tbl${'c'.repeat(16)}`;
    await service.getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      filterLinkCellSelected: [`fld${'d'.repeat(16)}`, `rec${'e'.repeat(16)}`],
      skip: 0,
      take: 2,
    });

    expect(pluginPrepare).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ keepPrimaryKey: true }),
      })
    );
  });

  it('honors explicit projection on pure v2 list without snapshot bulk', async () => {
    execute.mockResolvedValue({
      isErr: () => false,
      value: ListTableRecordsResult.create(
        [
          {
            id: 'rec1111111111111111',
            fields: { Title: 'Alpha' },
            version: 1,
          },
        ],
        1,
        0,
        1
      ),
    });

    const result = await service.getRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Name,
      projection: ['Title'],
      skip: 0,
      take: 1,
    });

    expect(result.records[0]?.fields).toEqual({ Title: 'Alpha' });
    expect(getSnapshotBulkWithPermission).not.toHaveBeenCalled();
  });

  it.each([
    {
      operation: 'upload',
      mutate: async (
        tableId: string,
        recordId: string,
        fieldId: string,
        attachment: { id: string; name: string }
      ) => {
        uploadFromUrl.mockResolvedValueOnce(attachment);
        await service.uploadAttachment(
          tableId,
          recordId,
          fieldId,
          undefined,
          'https://example.test/uploaded.png'
        );
      },
    },
    {
      operation: 'insert',
      mutate: async (
        tableId: string,
        recordId: string,
        fieldId: string,
        attachment: { id: string; name: string }
      ) => {
        await service.insertAttachment(tableId, recordId, fieldId, [attachment] as never);
      },
    },
  ])(
    'reads $operation attachment source state through projected v2 getRecord only',
    async ({ mutate }) => {
      const tableId = `tbl${'c'.repeat(16)}`;
      const recordId = 'rec1111111111111111';
      const attachmentFieldId = `fld${'a'.repeat(16)}`;
      const existingAttachment = { id: 'atc-existing', name: 'existing.png' };
      const addedAttachment = { id: 'atc-added', name: 'added.png' };
      testTable = createTestTable((builder) => {
        builder
          .field()
          .attachment()
          .withId(FieldId.create(attachmentFieldId)._unsafeUnwrap())
          .withName(FieldName.create('File')._unsafeUnwrap())
          .done();
      });
      tableFindOne.mockResolvedValue({
        isErr: () => false,
        value: testTable,
      });
      const getRecord = vi.spyOn(service, 'getRecord').mockResolvedValueOnce({
        id: recordId,
        fields: { [attachmentFieldId]: [existingAttachment] },
      });
      const updateRecord = vi.spyOn(service, 'updateRecord').mockResolvedValueOnce({
        id: recordId,
        fields: { [attachmentFieldId]: [existingAttachment, addedAttachment] },
      });

      await mutate(tableId, recordId, attachmentFieldId, addedAttachment);

      expect(getRecord).toHaveBeenCalledWith(tableId, recordId, {
        fieldKeyType: FieldKeyType.Id,
        projection: [attachmentFieldId],
      });
      expect(legacyGetRecordsById).not.toHaveBeenCalled();
      expect(updateRecord).toHaveBeenCalledWith(tableId, recordId, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: { [attachmentFieldId]: [existingAttachment, addedAttachment] },
        },
      });
    }
  );

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

  it('checks the record-level migration guard before v2 mutations', async () => {
    const error = new Error('space data database migration is switching');
    assertTableRecordWritable.mockRejectedValueOnce(error);

    await expect(
      service.updateRecords(`tbl${'c'.repeat(16)}`, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ id: 'rec1111111111111111', fields: { [statusFieldId]: 'Done' } }],
      })
    ).rejects.toBe(error);

    expect(assertTableRecordWritable).toHaveBeenCalledWith(`tbl${'c'.repeat(16)}`);
    expect(commandExecute).not.toHaveBeenCalled();
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

  it('uses the last duplicate occurrence when native v2 updateRecords also reorders', async () => {
    commandExecute.mockResolvedValueOnce({
      isErr: () => false,
      value: createUpdateRecordsResult({
        tableId: `tbl${'c'.repeat(16)}`,
        records: [
          { id: 'rec2222222222222222', fields: { [statusFieldId]: 'Open' } },
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

    await service.updateRecords(`tbl${'c'.repeat(16)}`, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        { id: 'rec1111111111111111', fields: { [statusFieldId]: 'Open' } },
        { id: 'rec2222222222222222', fields: { [statusFieldId]: 'Open' } },
        { id: 'rec1111111111111111', fields: { [statusFieldId]: 'Done', [noteFieldId]: 'latest' } },
      ],
      order: {
        viewId: `viw${'c'.repeat(16)}`,
        anchorId: 'rec3333333333333333',
        position: 'after',
      },
    });

    const command = commandExecute.mock.calls[0]?.[1];
    expect(
      command.records?.map((record: { recordId: { toString(): string } }) =>
        record.recordId.toString()
      )
    ).toEqual(['rec2222222222222222', 'rec1111111111111111']);
    expect(command.records?.[1]?.fieldValues.get(statusFieldId)).toBe('Done');
    expect(command.records?.[1]?.fieldValues.get(noteFieldId)).toBe('latest');
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
