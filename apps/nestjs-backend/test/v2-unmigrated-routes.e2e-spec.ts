import type { INestApplication } from '@nestjs/common';
import { FieldType, NumberFormattingType, Relationship } from '@teable/core';
import {
  IdReturnType,
  axios,
  copy,
  copyById,
  enableShareView,
  exportCsvFromTable,
  getCalendarDailyCollection,
  getField,
  getFieldFilterLinkRecords,
  getFields,
  getIdsFromRanges,
  getRecordGetCollaborators,
  getRecordHistory,
  getRecordListHistory,
  getRecordStatus,
  getTableById,
  getTableList,
  updateTableDescription,
  updateField,
  updateTableIcon,
  updateTableName,
} from '@teable/openapi';
import { vi } from 'vitest';

import { thresholdConfig } from '../src/configs/threshold.config';
import {
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../src/features/canary/interceptors/v2-indicator.interceptor';
import { FieldOpenApiService } from '../src/features/field/open-api/field-open-api.service';
import { TableOpenApiService } from '../src/features/table/open-api/table-open-api.service';
import {
  createBase,
  createField,
  createTable,
  initApp,
  permanentDeleteBase,
  permanentDeleteTable,
} from './utils/init-app';

describe('T6893 remaining table APIs v2 dual-path (e2e)', () => {
  let app: INestApplication;
  let fieldOpenApiService: FieldOpenApiService;
  let tableOpenApiService: TableOpenApiService;
  let tableId: string;
  let fieldId: string;
  let dateFieldId: string;
  let amountFieldId: string;
  let userFieldId: string;
  let amountColumnIndex: number;
  let recordId: string;
  let viewId: string;
  const baseId = globalThis.testConfig.baseId;
  let previousForceV2All: string | undefined;
  let thresholds: { maxCopyCells: number };

  beforeAll(async () => {
    const appContext = await initApp();
    app = appContext.app;
    thresholds = app.get(thresholdConfig.KEY);
    fieldOpenApiService = app.get(FieldOpenApiService);
    tableOpenApiService = app.get(TableOpenApiService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    const table = await createTable(baseId, {
      name: 't6893_v2_routes',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'When', type: FieldType.Date },
        {
          name: 'Amount',
          type: FieldType.Number,
          options: {
            formatting: {
              type: NumberFormattingType.Currency,
              precision: 2,
              symbol: '$',
            },
          },
        },
        {
          name: 'Assignee',
          type: FieldType.User,
          options: { isMultiple: false, shouldNotify: false },
        },
      ],
      records: [
        {
          fields: {
            Title: 'Alpha',
            When: '2026-01-15T00:00:00.000Z',
            Amount: 1234.5,
            Assignee: {
              id: globalThis.testConfig.userId,
              title: globalThis.testConfig.userName,
              email: globalThis.testConfig.email,
            },
          },
        },
      ],
    });
    tableId = table.id;
    fieldId = table.fields[0].id;
    dateFieldId = table.fields[1].id;
    amountFieldId = table.fields[2].id;
    userFieldId = table.fields[3].id;
    amountColumnIndex = table.fields.findIndex((field) => field.id === amountFieldId);
    recordId = table.records[0].id;
    viewId = table.defaultViewId!;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tableId) {
      await permanentDeleteTable(baseId, tableId);
    }
    if (previousForceV2All == null) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
  });

  it('lists and reads fields through v2 without the legacy field open-api service', async () => {
    const legacyList = vi
      .spyOn(fieldOpenApiService, 'getFields')
      .mockRejectedValue(new Error('legacy FieldOpenApiService.getFields must not be used'));

    const listResponse = await getFields(tableId);
    expect(listResponse.data.some((field) => field.id === fieldId)).toBe(true);
    expect(listResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
    expect(listResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getFields');
    expect(listResponse.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
    expect(legacyList).not.toHaveBeenCalled();

    const fieldResponse = await getField(tableId, fieldId);
    expect(fieldResponse.data.id).toBe(fieldId);
    expect(fieldResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getFields');
  });

  it('returns the persisted field version from the v2 socket snapshot endpoint', async () => {
    const getSnapshots = () =>
      axios.get<Array<{ id: string; v: number; type: string; data: { id: string; name: string } }>>(
        `/table/${tableId}/field/socket/snapshot-bulk`,
        {
          params: { ids: [fieldId] },
        }
      );
    const before = await getSnapshots();

    await updateField(tableId, fieldId, { name: 'Renamed title' });

    const response = await getSnapshots();

    expect(response.data).toEqual([
      expect.objectContaining({
        id: fieldId,
        v: before.data[0].v + 1,
        type: 'json0',
        data: expect.objectContaining({ id: fieldId, name: 'Renamed title' }),
      }),
    ]);

    const docIds = await axios.get<{ ids: string[] }>(`/table/${tableId}/field/socket/doc-ids`);
    expect(docIds.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getFields');
    expect(docIds.data.ids).toEqual(expect.arrayContaining([fieldId, dateFieldId, amountFieldId]));
  });

  it('reads field filter-link records through v2', async () => {
    const foreignTable = await createTable(baseId, {
      name: 't6893_filter_link_foreign',
    });

    try {
      const linkField = await createField(tableId, {
        name: 'Foreign',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: foreignTable.id,
        },
      });

      const response = await getFieldFilterLinkRecords(tableId, linkField.id);
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getViewFilterLinkRecords');
      expect(response.data).toEqual([]);
    } finally {
      await permanentDeleteTable(baseId, foreignTable.id);
    }
  });

  it('reads a table through v2 without the legacy table open-api service', async () => {
    const legacyGet = vi
      .spyOn(tableOpenApiService, 'getTable')
      .mockRejectedValue(new Error('legacy TableOpenApiService.getTable must not be used'));

    const response = await getTableById(baseId, tableId);
    expect(response.data.id).toBe(tableId);
    expect(response.data.name).toBe('t6893_v2_routes');
    expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
    expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getTable');
    expect(legacyGet).not.toHaveBeenCalled();
  });

  it('lists and updates table metadata through v2', async () => {
    const listResponse = await getTableList(baseId);
    expect(listResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getTable');
    expect(listResponse.data.map((table) => table.id)).toContain(tableId);

    const nameResponse = await updateTableName(baseId, tableId, { name: 'Renamed table' });
    const descriptionResponse = await updateTableDescription(baseId, tableId, {
      description: 'V2 description',
    });
    const iconResponse = await updateTableIcon(baseId, tableId, { icon: '🧪' });

    expect(nameResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateTable');
    expect(descriptionResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateTable');
    expect(iconResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateTable');

    const response = await getTableById(baseId, tableId);
    expect(response.data).toMatchObject({
      name: 'Renamed table',
      description: 'V2 description',
      icon: '🧪',
    });
  });

  it('reads table socket snapshots and doc ids through v2', async () => {
    const snapshots = await axios.get<Array<{ id: string; data: { id: string } }>>(
      `/base/${baseId}/table/socket/snapshot-bulk`,
      { params: { ids: [tableId] } }
    );
    expect(snapshots.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getTable');
    expect(snapshots.data).toEqual([
      expect.objectContaining({ id: tableId, data: expect.objectContaining({ id: tableId }) }),
    ]);

    const docIds = await axios.get<{ ids: string[] }>(`/base/${baseId}/table/socket/doc-ids`);
    expect(docIds.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getTable');
    expect(docIds.data.ids).toContain(tableId);
  });

  it('infers the primary lookup field when creating a cross-base link through v2', async () => {
    const foreignBase = await createBase({
      spaceId: globalThis.testConfig.spaceId,
      name: 't6893_cross_base_target',
    });

    try {
      const foreignTable = await createTable(foreignBase.id, {
        name: 't6893_cross_base_foreign',
      });
      const hostTable = await createTable(baseId, {
        name: 't6893_cross_base_host',
        fields: [
          {
            name: 'Title',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Foreign record',
            type: FieldType.Link,
            options: {
              baseId: foreignBase.id,
              relationship: Relationship.ManyOne,
              foreignTableId: foreignTable.id,
            },
          },
        ],
      });

      try {
        const linkField = hostTable.fields.find((field) => field.name === 'Foreign record');
        expect(linkField?.options).toEqual(
          expect.objectContaining({ lookupFieldId: foreignTable.fields[0].id })
        );
      } finally {
        await permanentDeleteTable(baseId, hostTable.id);
      }
    } finally {
      await permanentDeleteBase(foreignBase.id);
    }
  });

  it('copies a cell through the v2 record read path', async () => {
    const response = await copy(tableId, {
      viewId,
      ranges: [
        [0, 0],
        [0, 0],
      ],
    });
    expect(response.data.content).toContain('Alpha');
    expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
    expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('copy');
  });

  it('copies selected ids through the v2 record read path', async () => {
    const response = await copyById(tableId, {
      viewId,
      selection: { recordIds: [recordId], fieldIds: [fieldId] },
    });

    expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('copy');
    expect(response.data.content).toContain('Alpha');
  });

  it('resolves selection ranges to record and field ids through v2', async () => {
    const response = await getIdsFromRanges(tableId, {
      viewId,
      ranges: [
        [0, 0],
        [0, 0],
      ],
      returnType: IdReturnType.All,
    });

    expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getRecords');
    expect(response.data.recordIds).toEqual([recordId]);
    expect(response.data.fieldIds).toEqual([fieldId]);
  });

  it('formats copied values through their field definition', async () => {
    const response = await copy(tableId, {
      viewId,
      ranges: [
        [amountColumnIndex, 0],
        [amountColumnIndex, 0],
      ],
    });

    expect(response.data.content).toBe('$1,234.50');
  });

  it('rejects a range copy that exceeds the configured cell limit', async () => {
    const previousMaxCopyCells = thresholds.maxCopyCells;
    thresholds.maxCopyCells = 1;
    try {
      await expect(
        copy(tableId, {
          viewId,
          ranges: [
            [0, 0],
            [1, 0],
          ],
        })
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      thresholds.maxCopyCells = previousMaxCopyCells;
    }
  });

  it('rejects a copy by id that exceeds the configured cell limit', async () => {
    const previousMaxCopyCells = thresholds.maxCopyCells;
    thresholds.maxCopyCells = 1;
    try {
      await expect(
        copyById(tableId, {
          viewId,
          selection: {
            recordIds: [recordId],
            fieldIds: [fieldId, dateFieldId],
          },
        })
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      thresholds.maxCopyCells = previousMaxCopyCells;
    }
  });

  it('reads calendar daily collection through v2 when a view is present', async () => {
    const response = await getCalendarDailyCollection(tableId, {
      viewId,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-31T00:00:00.000Z',
      startDateFieldId: dateFieldId,
      endDateFieldId: dateFieldId,
    });
    expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getCalendarDailyCollection');
    expect(response.data.countMap).toBeTypeOf('object');
  });

  it('exports CSV through the v2 record query path', async () => {
    const response = await exportCsvFromTable(tableId, {
      projection: [fieldId, amountFieldId],
    });

    expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('exportCsv');
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.data).toContain('Title,Amount');
    expect(response.data).toContain('Alpha');
    expect(response.data).toContain('$1,234.50');
  });

  it('reads record status and collaborators through v2 queries', async () => {
    const status = await getRecordStatus(tableId, recordId, { viewId });
    expect(status.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getRecordStatus');
    expect(status.data).toEqual({ isDeleted: false, isVisible: true });

    const collaborators = await getRecordGetCollaborators(tableId, { fieldId: userFieldId });
    expect(collaborators.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getRecords');
    expect(collaborators.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: globalThis.testConfig.userId,
          userName: globalThis.testConfig.userName,
          email: globalThis.testConfig.email,
        }),
      ])
    );
  });

  it('attributes record history endpoints to the v2 canary feature', async () => {
    const response = await getRecordHistory(tableId, recordId, {});

    expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
    expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getRecordHistory');
    expect(response.data.historyList).toEqual([]);

    const listResponse = await getRecordListHistory(tableId, {});
    expect(listResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
    expect(listResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getRecordHistory');
    expect(listResponse.data.historyList).toEqual([]);
  });

  it('reads shared record socket snapshots and doc ids through v2', async () => {
    const share = await enableShareView({ tableId, viewId });
    const shareId = share.data.shareId;

    const docIds = await axios.post<{ ids: string[] }>(`/share/${shareId}/socket/record/doc-ids`, {
      take: 10,
    });
    expect(docIds.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewRecords');
    expect(docIds.data.ids).toContain(recordId);

    const snapshots = await axios.post<Array<{ id: string; data: { id: string } }>>(
      `/share/${shareId}/socket/record/snapshot-bulk`,
      { ids: [recordId] }
    );
    expect(snapshots.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewRecords');
    expect(snapshots.data).toEqual([
      expect.objectContaining({ id: recordId, data: expect.objectContaining({ id: recordId }) }),
    ]);
  });
});
