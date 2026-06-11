/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/cognitive-complexity */
import type { INestApplication } from '@nestjs/common';
import {
  Colors,
  FieldKeyType,
  FieldType,
  MultiNumberDisplayType,
  Relationship,
  Role,
  SortFunc,
  defaultNumberFormatting,
} from '@teable/core';
import type { IFieldRo, IUserCellValue } from '@teable/core';
import type { IRecordsVo, IPasteRo, IPasteVo, ITableFullVo, IUserMeVo } from '@teable/openapi';
import {
  RangeType,
  IdReturnType,
  CLEAR_URL,
  CLEAR_STREAM_URL,
  DELETE_STREAM_URL,
  DUPLICATE_STREAM_URL,
  DELETE_URL,
  GET_RECORDS_URL,
  PASTE_URL,
  PASTE_STREAM_URL,
  X_CANARY_HEADER,
  axios,
  getIdsFromRanges as apiGetIdsFromRanges,
  copy as apiCopy,
  paste as apiPaste,
  getFields,
  deleteSelection,
  clear,
  updateViewFilter,
  updateViewSort,
  USER_ME,
  UPDATE_USER_NAME,
  createSpace,
  createBase,
  emailSpaceInvitation,
  getRecords,
  urlBuilder,
} from '@teable/openapi';
import { RecordOpenApiV2Service } from '../src/features/record/open-api/record-open-api-v2.service';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import {
  permanentDeleteBase,
  createField,
  getRecord,
  initApp,
  createTable,
  createRecords,
  permanentDeleteTable,
  permanentDeleteSpace,
  updateRecordByApi,
} from './utils/init-app';

describe('OpenAPI SelectionController (e2e)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  let cookie: string;
  const baseId = globalThis.testConfig.baseId;
  const isForceV2 = process.env.FORCE_V2_ALL === 'true';

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    cookie = appCtx.cookie;
  });

  beforeEach(async () => {
    table = await createTable(baseId, { name: 'table1' });
  });

  afterEach(async () => {
    await permanentDeleteTable(baseId, table.id);
  });

  afterAll(async () => {
    await app.close();
  });

  const pasteWithCanary = async (tableId: string, pasteRo: IPasteRo, useV2: boolean) => {
    return axios.patch<IPasteVo>(
      urlBuilder(PASTE_URL, {
        tableId,
      }),
      pasteRo,
      {
        headers: {
          [X_CANARY_HEADER]: useV2 ? 'true' : 'false',
        },
      }
    );
  };

  const getRecordsWithCanary = async (
    tableId: string,
    query: Parameters<typeof getRecords>[1],
    useV2: boolean
  ) => {
    return axios.get<IRecordsVo>(
      urlBuilder(GET_RECORDS_URL, {
        tableId,
      }),
      {
        params: query,
        headers: {
          [X_CANARY_HEADER]: useV2 ? 'true' : 'false',
        },
      }
    );
  };

  const clearWithCanary = async (
    tableId: string,
    clearRo: Parameters<typeof clear>[1],
    useV2: boolean
  ) => {
    return axios.patch<null>(
      urlBuilder(CLEAR_URL, {
        tableId,
      }),
      clearRo,
      {
        headers: {
          [X_CANARY_HEADER]: useV2 ? 'true' : 'false',
        },
      }
    );
  };

  const deleteWithCanary = async (
    tableId: string,
    deleteRo: Parameters<typeof deleteSelection>[1],
    useV2: boolean
  ) => {
    return axios.delete<{ ids: string[] }>(
      urlBuilder(DELETE_URL, {
        tableId,
      }),
      {
        headers: {
          [X_CANARY_HEADER]: useV2 ? 'true' : 'false',
        },
        params: {
          ...deleteRo,
          filter: JSON.stringify(deleteRo.filter),
          orderBy: JSON.stringify(deleteRo.orderBy),
          groupBy: JSON.stringify(deleteRo.groupBy),
          ranges: JSON.stringify(deleteRo.ranges),
          collapsedGroupIds: JSON.stringify(deleteRo.collapsedGroupIds),
        },
      }
    );
  };

  const deleteStreamWithCanary = async (
    tableId: string,
    rangesRo: {
      viewId: string;
      type: RangeType;
      ranges: Array<[number, number]>;
    },
    useV2: boolean
  ) => {
    const streamUrl = axios.getUri({
      baseURL: axios.defaults.baseURL,
      url: urlBuilder(DELETE_STREAM_URL, {
        tableId,
      }),
      params: {
        viewId: rangesRo.viewId,
        type: rangesRo.type,
        ranges: JSON.stringify(rangesRo.ranges),
      },
    });

    const response = await fetch(streamUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Cookie: cookie,
        [X_CANARY_HEADER]: useV2 ? 'true' : 'false',
      },
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const progressEvents: Array<{ phase: string; deletedCount: number; totalCount: number }> = [];
    let doneEvent:
      | { id: 'done'; data: { deletedRecordIds: string[] }; deletedCount: number }
      | undefined;
    const errorEvents: Array<{
      id: 'error';
      message: string;
      batchIndex: number;
      phase: string;
      recordIds: string[];
    }> = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        const event = JSON.parse(jsonStr) as {
          id: string;
          phase?: string;
          deletedCount?: number;
          totalCount?: number;
          message?: string;
          batchIndex?: number;
          recordIds?: string[];
          data?: { deletedRecordIds: string[] };
        };

        if (event.id === 'progress') {
          progressEvents.push({
            phase: event.phase ?? 'preparing',
            deletedCount: event.deletedCount ?? 0,
            totalCount: event.totalCount ?? 0,
          });
        }

        if (event.id === 'done') {
          doneEvent = event as typeof doneEvent;
        }

        if (event.id === 'error') {
          errorEvents.push({
            id: 'error',
            message: event.message ?? '',
            batchIndex: event.batchIndex ?? -1,
            phase: event.phase ?? 'deleting',
            recordIds: event.recordIds ?? [],
          });
        }
      }
    }

    return {
      headers: {
        contentType: response.headers.get('content-type'),
        xAccelBuffering: response.headers.get('x-accel-buffering'),
        xTeableV2: response.headers.get('x-teable-v2'),
        xTeableV2Reason: response.headers.get('x-teable-v2-reason'),
        xTeableV2Feature: response.headers.get('x-teable-v2-feature'),
        link: response.headers.get('link'),
        traceparent: response.headers.get('traceparent'),
      },
      progressEvents,
      doneEvent,
      errorEvents,
    };
  };

  const duplicateStreamWithCanary = async (
    tableId: string,
    rangesRo: {
      viewId: string;
      type: RangeType;
      ranges: Array<[number, number]>;
    },
    useV2: boolean
  ) => {
    const streamUrl = axios.getUri({
      baseURL: axios.defaults.baseURL,
      url: urlBuilder(DUPLICATE_STREAM_URL, {
        tableId,
      }),
      params: {
        viewId: rangesRo.viewId,
        type: rangesRo.type,
        ranges: JSON.stringify(rangesRo.ranges),
      },
    });

    const response = await fetch(streamUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Cookie: cookie,
        [X_CANARY_HEADER]: useV2 ? 'true' : 'false',
      },
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const progressEvents: Array<{ phase: string; duplicatedCount: number; totalCount: number }> =
      [];
    let doneEvent:
      | { id: 'done'; data: { duplicatedRecordIds: string[] }; duplicatedCount: number }
      | undefined;
    const errorEvents: Array<{
      id: 'error';
      message: string;
      batchIndex: number;
      phase: string;
      recordIds: string[];
    }> = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        const event = JSON.parse(jsonStr) as {
          id: string;
          phase?: string;
          duplicatedCount?: number;
          totalCount?: number;
          message?: string;
          batchIndex?: number;
          recordIds?: string[];
          data?: { duplicatedRecordIds: string[] };
        };

        if (event.id === 'progress') {
          progressEvents.push({
            phase: event.phase ?? 'preparing',
            duplicatedCount: event.duplicatedCount ?? 0,
            totalCount: event.totalCount ?? 0,
          });
        }

        if (event.id === 'done') {
          doneEvent = event as typeof doneEvent;
        }

        if (event.id === 'error') {
          errorEvents.push({
            id: 'error',
            message: event.message ?? '',
            batchIndex: event.batchIndex ?? -1,
            phase: event.phase ?? 'duplicating',
            recordIds: event.recordIds ?? [],
          });
        }
      }
    }

    return {
      progressEvents,
      doneEvent,
      errorEvents,
    };
  };

  const clearStreamWithCanary = async (
    tableId: string,
    rangesRo: {
      viewId: string;
      type: RangeType;
      ranges: Array<[number, number]>;
    },
    useV2: boolean
  ) => {
    const streamUrl = axios.getUri({
      baseURL: axios.defaults.baseURL,
      url: urlBuilder(CLEAR_STREAM_URL, {
        tableId,
      }),
    });

    const response = await fetch(streamUrl, {
      method: 'PATCH',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        Cookie: cookie,
        [X_CANARY_HEADER]: useV2 ? 'true' : 'false',
      },
      body: JSON.stringify(rangesRo),
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const progressEvents: Array<{
      phase: string;
      processedCount: number;
      clearedCount: number;
      totalCount: number;
    }> = [];
    let doneEvent:
      | {
          id: 'done';
          processedCount: number;
          clearedCount: number;
          data: { clearedRecordIds: string[] };
        }
      | undefined;
    const errorEvents: Array<{
      id: 'error';
      message: string;
      batchIndex: number;
      phase: string;
      recordIds: string[];
    }> = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        const event = JSON.parse(jsonStr) as {
          id: string;
          phase?: string;
          processedCount?: number;
          clearedCount?: number;
          totalCount?: number;
          message?: string;
          batchIndex?: number;
          recordIds?: string[];
          data?: { clearedRecordIds: string[] };
        };

        if (event.id === 'progress') {
          progressEvents.push({
            phase: event.phase ?? 'preparing',
            processedCount: event.processedCount ?? 0,
            clearedCount: event.clearedCount ?? 0,
            totalCount: event.totalCount ?? 0,
          });
        }

        if (event.id === 'done') {
          doneEvent = event as typeof doneEvent;
        }

        if (event.id === 'error') {
          errorEvents.push({
            id: 'error',
            message: event.message ?? '',
            batchIndex: event.batchIndex ?? -1,
            phase: event.phase ?? 'clearing',
            recordIds: event.recordIds ?? [],
          });
        }
      }
    }

    return {
      progressEvents,
      doneEvent,
      errorEvents,
    };
  };

  const pasteStreamWithCanary = async (tableId: string, pasteRo: IPasteRo, useV2: boolean) => {
    const streamUrl = axios.getUri({
      baseURL: axios.defaults.baseURL,
      url: urlBuilder(PASTE_STREAM_URL, {
        tableId,
      }),
    });

    const response = await fetch(streamUrl, {
      method: 'PATCH',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        Cookie: cookie,
        [X_CANARY_HEADER]: useV2 ? 'true' : 'false',
      },
      body: JSON.stringify(pasteRo),
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const progressEvents: Array<{
      phase: string;
      processedCount: number;
      updatedCount: number;
      createdCount: number;
      totalCount: number;
    }> = [];
    let doneEvent:
      | {
          id: 'done';
          processedCount: number;
          updatedCount: number;
          createdCount: number;
          data: { createdRecordIds: string[]; ranges?: [[number, number], [number, number]] };
        }
      | undefined;
    const errorEvents: Array<{
      id: 'error';
      message: string;
      batchIndex: number;
      phase: string;
      recordIds: string[];
    }> = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        const event = JSON.parse(jsonStr) as {
          id: string;
          phase?: string;
          processedCount?: number;
          updatedCount?: number;
          createdCount?: number;
          totalCount?: number;
          message?: string;
          batchIndex?: number;
          recordIds?: string[];
          data?: { createdRecordIds: string[]; ranges?: [[number, number], [number, number]] };
        };

        if (event.id === 'progress') {
          progressEvents.push({
            phase: event.phase ?? 'preparing',
            processedCount: event.processedCount ?? 0,
            updatedCount: event.updatedCount ?? 0,
            createdCount: event.createdCount ?? 0,
            totalCount: event.totalCount ?? 0,
          });
        }

        if (event.id === 'done') {
          doneEvent = event as typeof doneEvent;
        }

        if (event.id === 'error') {
          errorEvents.push({
            id: 'error',
            message: event.message ?? '',
            batchIndex: event.batchIndex ?? -1,
            phase: event.phase ?? 'pasting',
            recordIds: event.recordIds ?? [],
          });
        }
      }
    }

    return {
      progressEvents,
      doneEvent,
      errorEvents,
    };
  };

  describe('getIdsFromRanges', () => {
    it('should return all ids for cell range ', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [
            [0, 0],
            [0, 0],
          ],
          returnType: IdReturnType.All,
        })
      ).data;

      expect(data.recordIds).toHaveLength(1);
      expect(data.fieldIds).toHaveLength(1);
    });

    it('should return all ids for row range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [[0, 1]],
          type: RangeType.Rows,
          returnType: IdReturnType.All,
        })
      ).data;

      expect(data.recordIds).toHaveLength(2);
      expect(data.fieldIds).toHaveLength(table.fields.length);
    });

    it('should return all ids for column range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [[0, 1]],
          type: RangeType.Columns,
          returnType: IdReturnType.All,
        })
      ).data;

      expect(data.recordIds).toHaveLength(table.records.length);
      expect(data.fieldIds).toHaveLength(2);
    });

    it('should return record ids for cell range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [
            [0, 0],
            [0, 1],
          ],
          returnType: IdReturnType.RecordId,
        })
      ).data;

      expect(data.recordIds).toHaveLength(2);
      expect(data.fieldIds).toBeUndefined();
    });

    it('should return record ids for row range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [[0, 1]],
          type: RangeType.Rows,
          returnType: IdReturnType.RecordId,
        })
      ).data;

      expect(data.recordIds).toHaveLength(2);
      expect(data.fieldIds).toBeUndefined();
    });

    it('should return record ids for column range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [[0, 0]],
          type: RangeType.Columns,
          returnType: IdReturnType.RecordId,
        })
      ).data;

      expect(data.recordIds).toHaveLength(table.records.length);
      expect(data.fieldIds).toBeUndefined();
    });

    it('should return field ids for cell range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [
            [0, 0],
            [0, 1],
          ],
          returnType: IdReturnType.FieldId,
        })
      ).data;

      expect(data.fieldIds).toHaveLength(1);
      expect(data.recordIds).toBeUndefined();
    });

    it('should return field ids for row range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [[0, 1]],
          type: RangeType.Rows,
          returnType: IdReturnType.FieldId,
        })
      ).data;

      expect(data.fieldIds).toHaveLength(table.fields.length);
      expect(data.recordIds).toBeUndefined();
    });

    it('should return record ids for column range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [[0, 0]],
          type: RangeType.Columns,
          returnType: IdReturnType.FieldId,
        })
      ).data;

      expect(data.fieldIds).toHaveLength(1);
      expect(data.recordIds).toBeUndefined();
    });
  });

  describe('past link records', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let table3: ITableFullVo;
    beforeEach(async () => {
      // create tables
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        name: 'table1',
        fields: [textFieldRo],
        records: [
          { fields: { 'text field': 'table1_1' } },
          { fields: { 'text field': 'table1_2' } },
          { fields: { 'text field': 'table1_3' } },
        ],
      });

      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo],
        records: [
          { fields: { 'text field': 'table2_1' } },
          { fields: { 'text field': 'table2_2' } },
          { fields: { 'text field': 'table2_3' } },
        ],
      });

      table3 = await createTable(baseId, {
        name: 'table3',
        fields: [textFieldRo],
        records: [
          { fields: { 'text field': 'table3' } },
          { fields: { 'text field': 'table3' } },
          { fields: { 'text field': 'table3' } },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should paste 2 manyOne link field in same time', async () => {
      // create link field
      const table1LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const linkField1 = await createField(table1.id, table1LinkFieldRo);
      const linkField2 = await createField(table1.id, table1LinkFieldRo);

      await apiPaste(table1.id, {
        viewId: table1.views[0].id,
        content: 'table2_1\ttable2_2',
        ranges: [
          [1, 0],
          [1, 0],
        ],
      });

      const record = await getRecord(table1.id, table1.records[0].id);

      expect(record.fields[linkField1.id]).toEqual({
        id: table2.records[0].id,
        title: 'table2_1',
      });
      expect(record.fields[linkField2.id]).toEqual({
        id: table2.records[1].id,
        title: 'table2_2',
      });
    });

    it('should paste 2 oneMany link field in same time', async () => {
      // create link field
      const table1LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      const linkField1 = await createField(table1.id, table1LinkFieldRo);
      const linkField2 = await createField(table1.id, table1LinkFieldRo);

      await apiPaste(table1.id, {
        viewId: table1.views[0].id,
        content: 'table2_1\ttable2_2',
        ranges: [
          [1, 0],
          [1, 0],
        ],
      });

      const record = await getRecord(table1.id, table1.records[0].id);

      expect(record.fields[linkField1.id]).toEqual([
        {
          id: table2.records[0].id,
          title: 'table2_1',
        },
      ]);
      expect(record.fields[linkField2.id]).toEqual([
        {
          id: table2.records[1].id,
          title: 'table2_2',
        },
      ]);
    });

    it('should paste 2 oneMany link field with same value in same time', async () => {
      // create link field
      const table1LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table3.id,
        },
      };

      const linkField1 = await createField(table1.id, table1LinkFieldRo);
      const linkField2 = await createField(table1.id, table1LinkFieldRo);

      await apiPaste(table1.id, {
        viewId: table1.views[0].id,
        content: [[{ id: table3.records[0].id }, { id: table3.records[1].id }]],
        ranges: [
          [1, 0],
          [1, 0],
        ],
        header: [linkField1, linkField2],
      });

      const record = await getRecord(table1.id, table1.records[0].id);

      expect(record.fields[linkField1.id]).toEqual([
        {
          id: table3.records[0].id,
          title: 'table3',
        },
      ]);
      expect(record.fields[linkField2.id]).toEqual([
        {
          id: table3.records[1].id,
          title: 'table3',
        },
      ]);
    });

    it('paste link field with same value', async () => {
      const table1LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      const linkField1 = await createField(table1.id, table1LinkFieldRo);

      await apiPaste(table1.id, {
        viewId: table1.views[0].id,
        content: [['table2_1']],
        ranges: [
          [1, 0],
          [1, 0],
        ],
        header: [table1.fields[0]],
      });

      const record = await getRecord(table1.id, table1.records[0].id);

      expect(record.fields[linkField1.id]).toEqual([
        {
          id: table2.records[0].id,
          title: 'table2_1',
        },
      ]);
    });
  });

  describe('api/table/:tableId/selection/clear (PATCH)', () => {
    it('should clear a standalone column without touching other fields', async () => {
      const clearTable = await createTable(baseId, {
        name: 'clear-basic',
        fields: [
          {
            name: 'Status',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Notes',
            type: FieldType.SingleLineText,
          },
        ],
        records: [
          { fields: { Status: 'todo', Notes: 'keep-1' } },
          { fields: { Status: 'doing', Notes: 'keep-2' } },
        ],
      });

      try {
        const viewId = clearTable.views[0].id;
        const statusFieldId = clearTable.fields.find((f) => f.name === 'Status')!.id;
        const notesFieldId = clearTable.fields.find((f) => f.name === 'Notes')!.id;

        await clear(clearTable.id, {
          viewId,
          type: RangeType.Columns,
          ranges: [[0, 0]],
        });

        const { data } = await getRecords(clearTable.id, {
          viewId,
          fieldKeyType: FieldKeyType.Id,
        });

        expect(data.records.map((record) => record.fields[statusFieldId] ?? null)).toEqual([
          null,
          null,
        ]);
        expect(data.records.map((record) => record.fields[notesFieldId])).toEqual([
          'keep-1',
          'keep-2',
        ]);
      } finally {
        await permanentDeleteTable(baseId, clearTable.id);
      }
    });

    it('should refresh formula and lookup dependents after clearing a column', async () => {
      const companyTable = await createTable(baseId, {
        name: 'companies-clear',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'City', type: FieldType.SingleLineText },
        ],
        records: [
          { fields: { Name: 'Alpha', City: 'Paris' } },
          { fields: { Name: 'Beta', City: 'Berlin' } },
        ],
      });
      const nameFieldId = companyTable.fields.find((f) => f.name === 'Name')!.id;
      const cityFieldId = companyTable.fields.find((f) => f.name === 'City')!.id;

      const nameFormulaField = await createField(companyTable.id, {
        name: 'Name Tag',
        type: FieldType.Formula,
        options: {
          expression: `IF({${nameFieldId}}, {${nameFieldId}}, "empty")`,
        },
      });
      companyTable.fields.push(nameFormulaField);

      const contactTable = await createTable(baseId, {
        name: 'contacts-clear',
        fields: [{ name: 'Person', type: FieldType.SingleLineText }],
        records: [{ fields: { Person: 'Alice' } }, { fields: { Person: 'Bob' } }],
      });
      const personFieldId = contactTable.fields.find((f) => f.name === 'Person')!.id;

      try {
        const linkField = await createField(contactTable.id, {
          name: 'Company',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: companyTable.id,
          },
        });
        contactTable.fields.push(linkField);

        const companyLookupField = await createField(contactTable.id, {
          name: 'Company Name',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: companyTable.id,
            linkFieldId: linkField.id,
            lookupFieldId: nameFieldId,
          },
        });
        contactTable.fields.push(companyLookupField);

        await updateRecordByApi(contactTable.id, contactTable.records[0].id, linkField.id, {
          id: companyTable.records[0].id,
        });
        await updateRecordByApi(contactTable.id, contactTable.records[1].id, linkField.id, {
          id: companyTable.records[1].id,
        });

        const companyViewId = companyTable.views[0].id;
        await clear(companyTable.id, {
          viewId: companyViewId,
          type: RangeType.Columns,
          ranges: [[0, 0]],
        });

        const companyRecords = await getRecords(companyTable.id, {
          viewId: companyViewId,
          fieldKeyType: FieldKeyType.Id,
        });
        expect(
          companyRecords.data.records.map((record) => record.fields[nameFieldId] ?? null)
        ).toEqual([null, null]);
        expect(
          companyRecords.data.records.map((record) => record.fields[nameFormulaField.id])
        ).toEqual(['empty', 'empty']);
        expect(companyRecords.data.records.map((record) => record.fields[cityFieldId])).toEqual([
          'Paris',
          'Berlin',
        ]);

        const contactViewId = contactTable.views[0].id;
        const contactRecords = await getRecords(contactTable.id, {
          viewId: contactViewId,
          fieldKeyType: FieldKeyType.Id,
        });
        const lookupValues = contactRecords.data.records.map(
          (record) => record.fields[companyLookupField.id] ?? null
        );
        expect(lookupValues).toEqual([null, null]);
        expect(contactRecords.data.records.map((record) => record.fields[personFieldId])).toEqual([
          'Alice',
          'Bob',
        ]);
      } finally {
        await permanentDeleteTable(baseId, contactTable.id);
        await permanentDeleteTable(baseId, companyTable.id);
      }
    });

    it.each(
      isForceV2
        ? [{ label: 'v2-forced', useV2: true, v2Header: 'true' }]
        : [
            { label: 'v1', useV2: false, v2Header: 'false' },
            { label: 'v2', useV2: true, v2Header: 'true' },
          ]
    )(
      'should respect search hidden-row offsets in clear for $label',
      async ({ useV2, v2Header }) => {
        const clearTable = await createTable(baseId, {
          name: `clear-search-${useV2 ? 'v2' : 'v1'}`,
          fields: [{ name: 'Name', type: FieldType.SingleLineText }],
          records: [
            { fields: { Name: 'Alpha' } },
            { fields: { Name: 'target-one' } },
            { fields: { Name: 'Bravo' } },
            { fields: { Name: 'target-two' } },
            { fields: { Name: 'Charlie' } },
          ],
        });

        try {
          const viewId = clearTable.views[0].id;
          const nameField = clearTable.fields.find((field) => field.name === 'Name')!;

          const clearRes = await clearWithCanary(
            clearTable.id,
            {
              viewId,
              ranges: [
                [0, 0],
                [0, 1],
              ],
              search: ['target', '', true],
            },
            useV2
          );

          expect(clearRes.status).toBe(200);
          expect(clearRes.headers['x-teable-v2']).toBe(v2Header);

          const records = await getRecords(clearTable.id, {
            viewId,
            fieldKeyType: FieldKeyType.Id,
          });

          expect(records.data.records[0].fields[nameField.id]).toBe('Alpha');
          expect(records.data.records[1].fields[nameField.id] ?? null).toBeNull();
          expect(records.data.records[2].fields[nameField.id]).toBe('Bravo');
          expect(records.data.records[3].fields[nameField.id] ?? null).toBeNull();
          expect(records.data.records[4].fields[nameField.id]).toBe('Charlie');
        } finally {
          await permanentDeleteTable(baseId, clearTable.id);
        }
      }
    );

    it.each(
      isForceV2
        ? [{ label: 'v2-forced', useV2: true, v2Header: 'true' }]
        : [
            { label: 'v1', useV2: false, v2Header: 'false' },
            { label: 'v2', useV2: true, v2Header: 'true' },
          ]
    )(
      'should clear correct row in $label when ignoreViewQuery+collapsed groups are provided',
      async ({ useV2, v2Header }) => {
        const clearTable = await createTable(baseId, {
          name: `clear-ignore-range-${useV2 ? 'v2' : 'v1'}`,
          fields: [
            { name: 'Title', type: FieldType.SingleLineText },
            {
              name: 'Status',
              type: FieldType.SingleSelect,
              options: {
                choices: [
                  { name: 'GroupA', color: Colors.Blue },
                  { name: 'GroupB', color: Colors.Green },
                ],
              },
            },
            { name: 'Marker', type: FieldType.SingleLineText },
          ],
          records: [
            { fields: { Title: 'A-01', Status: 'GroupA', Marker: 'mA01' } },
            { fields: { Title: 'A-02', Status: 'GroupA', Marker: 'mA02' } },
            { fields: { Title: 'B-01', Status: 'GroupB', Marker: 'mB01' } },
            { fields: { Title: 'B-02', Status: 'GroupB', Marker: 'mB02' } },
          ],
        });

        try {
          const viewId = clearTable.views[0].id;
          const titleField = clearTable.fields.find((f) => f.name === 'Title')!;
          const statusField = clearTable.fields.find((f) => f.name === 'Status')!;
          const markerField = clearTable.fields.find((f) => f.name === 'Marker')!;

          await updateViewSort(clearTable.id, viewId, {
            sort: {
              sortObjs: [{ fieldId: titleField.id, order: SortFunc.Desc }],
              manualSort: false,
            },
          });
          await updateViewFilter(clearTable.id, viewId, {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: statusField.id,
                  operator: 'is',
                  value: 'GroupA',
                },
              ],
            },
          });

          const groupBy = [{ fieldId: statusField.id, order: SortFunc.Asc }] as const;
          const orderBy = [{ fieldId: titleField.id, order: SortFunc.Asc }] as const;

          const groupedResult = await getRecords(clearTable.id, {
            viewId,
            ignoreViewQuery: true,
            groupBy: [...groupBy],
            orderBy: [...orderBy],
            fieldKeyType: FieldKeyType.Id,
          });
          const firstGroupHeader = groupedResult.data.extra?.groupPoints?.find(
            (point) => point.type === 0 && 'id' in point
          );
          expect(firstGroupHeader).toBeDefined();
          const collapsedGroupIds = [(firstGroupHeader as { id: string }).id];

          const clearRes = await clearWithCanary(
            clearTable.id,
            {
              viewId,
              ignoreViewQuery: true,
              ranges: [
                [0, 0],
                [0, 0],
              ],
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: statusField.id,
                    operator: 'isAnyOf',
                    value: ['GroupA', 'GroupB'],
                  },
                ],
              },
              orderBy: [...orderBy],
              groupBy: [...groupBy],
              projection: [markerField.id, statusField.id, titleField.id],
              collapsedGroupIds,
            },
            useV2
          );
          expect(clearRes.status).toBe(200);
          expect(clearRes.headers['x-teable-v2']).toBe(v2Header);

          const allRecords = await getRecords(clearTable.id, {
            fieldKeyType: FieldKeyType.Id,
          });

          const b01 = allRecords.data.records.find(
            (record) => record.fields[titleField.id] === 'B-01'
          );
          const a01 = allRecords.data.records.find(
            (record) => record.fields[titleField.id] === 'A-01'
          );

          expect(b01?.fields[markerField.id] ?? null).toBeNull();
          expect(a01?.fields[markerField.id]).toBe('mA01');
        } finally {
          await permanentDeleteTable(baseId, clearTable.id);
        }
      }
    );
  });

  describe('past expand col formula', () => {
    let table1: ITableFullVo;
    const numberField = {
      name: 'count',
      type: FieldType.Number,
      options: {
        formatting: defaultNumberFormatting,
        showAs: {
          type: MultiNumberDisplayType.Bar,
          color: Colors.Blue,
          showValue: true,
          maxValue: 100,
        },
      },
    };
    beforeEach(async () => {
      // create tables
      const fields: IFieldRo[] = [
        {
          name: 'name',
          type: FieldType.SingleLineText,
        },
        numberField,
      ];

      table1 = await createTable(baseId, {
        name: 'table1',
        fields: fields,
        records: [{ fields: { count: 1 } }, { fields: { count: 2 } }, { fields: { count: 3 } }],
      });

      const numberFieldId = table1.fields.find((f) => f.name === 'count')!.id;
      const formulaField: IFieldRo = {
        type: FieldType.Formula,
        name: 'formula',
        options: {
          expression: `{${numberFieldId}}`,
          formatting: numberField.options.formatting,
          showAs: numberField.options.showAs,
        },
      };
      await createField(table1.id, formulaField);
      await createField(table1.id, {
        type: FieldType.SingleLineText,
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
    });

    it('should paste expand col formula', async () => {
      const { content, header } = (
        await apiCopy(table1.id, {
          viewId: table1.views[0].id,
          ranges: [
            [1, 0],
            [2, 3],
          ],
        })
      ).data;
      await apiPaste(table1.id, {
        viewId: table1.views[0].id,
        content,
        header,
        ranges: [
          [3, 0],
          [3, 0],
        ],
      });
      const fields = (await getFields(table1.id, { viewId: table1.views[0].id })).data;
      expect(fields[4].type).toEqual(numberField.type);
      expect(fields[4].options).toEqual(numberField.options);
    });
  });

  describe('paste computed numeric coercion regression (v2)', () => {
    let table1: ITableFullVo;
    let scoreFieldId: string;
    let weightFieldId: string;
    let weightedScoreFieldId: string;

    beforeEach(async () => {
      table1 = await createTable(baseId, {
        name: 'paste-numeric-coercion',
        fields: [
          {
            name: 'Name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Score',
            type: FieldType.Number,
            options: {
              formatting: defaultNumberFormatting,
            },
          },
          {
            name: 'WeightText',
            type: FieldType.SingleLineText,
          },
        ],
        records: [{ fields: { Name: 'row-1', Score: 10, WeightText: '0.5' } }],
      });

      scoreFieldId = table1.fields.find((field) => field.name === 'Score')!.id;
      weightFieldId = table1.fields.find((field) => field.name === 'WeightText')!.id;

      const weightedScoreField = await createField(table1.id, {
        name: 'WeightedScore',
        type: FieldType.Formula,
        options: {
          expression: `{${scoreFieldId}}*{${weightFieldId}}`,
          formatting: defaultNumberFormatting,
        },
      });

      weightedScoreFieldId = weightedScoreField.id;
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
    });

    it('should recompute numeric formula without 500 when pasted text contains multiple numeric fragments in v2', async () => {
      const viewId = table1.views[0].id;

      const res = await pasteWithCanary(
        table1.id,
        {
          viewId,
          projection: [weightFieldId],
          content: '0.4/0.6',
          ranges: [
            [0, 0],
            [0, 0],
          ],
        },
        true
      );

      expect(res.status).toBe(200);
      expect(res.headers['x-teable-v2']).toBe('true');

      const records = await getRecords(table1.id, {
        viewId,
        fieldKeyType: FieldKeyType.Id,
      });

      expect(records.data.records[0].fields[weightFieldId]).toBe('0.4/0.6');
      expect(records.data.records[0].fields[weightedScoreFieldId]).toBeCloseTo(4, 10);
    });
  });

  describe('paste lookup date into date field', () => {
    const itV1Only = isForceV2 ? it.skip : it;

    itV1Only('should paste copied lookup date text into a regular date field', async () => {
      const dateFormatting = {
        date: 'YYYY-MM-DD',
        time: 'None',
        timeZone: 'UTC',
      } as const;

      const sourceTable = await createTable(baseId, {
        name: 'lookup-date-source',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          {
            name: 'Activity Date',
            type: FieldType.Date,
            options: { formatting: dateFormatting },
          },
        ],
        records: [{ fields: { Name: 'Activity 1', 'Activity Date': '2026-02-15T00:00:00.000Z' } }],
      });

      try {
        const targetDateField = await createField(table.id, {
          name: 'Last Activity Date',
          type: FieldType.Date,
          options: { formatting: dateFormatting },
        });
        table.fields.push(targetDateField);

        const sourceDateFieldId = sourceTable.fields.find(
          (field) => field.name === 'Activity Date'
        )!.id;
        const linkField = await createField(table.id, {
          name: 'Activities',
          type: FieldType.Link,
          options: {
            relationship: Relationship.OneMany,
            foreignTableId: sourceTable.id,
          },
        });
        table.fields.push(linkField);

        const lookupDateField = await createField(table.id, {
          name: 'Date (from Activities)',
          type: FieldType.Date,
          isLookup: true,
          lookupOptions: {
            foreignTableId: sourceTable.id,
            linkFieldId: linkField.id,
            lookupFieldId: sourceDateFieldId,
          },
          options: {
            formatting: dateFormatting,
          },
        });
        table.fields.push(lookupDateField);

        await updateRecordByApi(table.id, table.records[0].id, linkField.id, [
          { id: sourceTable.records[0].id },
        ]);

        const fields = (await getFields(table.id, { viewId: table.views[0].id })).data;
        const lookupFieldIndex = fields.findIndex((field) => field.id === lookupDateField.id);
        const targetDateFieldIndex = fields.findIndex((field) => field.id === targetDateField.id);

        const { content, header } = (
          await apiCopy(table.id, {
            viewId: table.views[0].id,
            ranges: [
              [lookupFieldIndex, 0],
              [lookupFieldIndex, 0],
            ],
          })
        ).data;

        await apiPaste(table.id, {
          viewId: table.views[0].id,
          content,
          header,
          ranges: [
            [targetDateFieldIndex, 0],
            [targetDateFieldIndex, 0],
          ],
        });

        const record = await getRecord(table.id, table.records[0].id);
        expect(record.fields[targetDateField.id]).toBe('2026-02-15T00:00:00.000Z');
      } finally {
        await permanentDeleteTable(baseId, sourceTable.id);
      }
    });

    itV1Only(
      'should keep the first date when copied lookup text contains multiple dates',
      async () => {
        const dateFormatting = {
          date: 'YYYY-MM-DD',
          time: 'None',
          timeZone: 'UTC',
        } as const;

        const sourceTable = await createTable(baseId, {
          name: 'lookup-date-source-multiple',
          fields: [
            { name: 'Name', type: FieldType.SingleLineText },
            {
              name: 'Activity Date',
              type: FieldType.Date,
              options: { formatting: dateFormatting },
            },
          ],
          records: [
            { fields: { Name: 'Activity 1', 'Activity Date': '2026-02-15T00:00:00.000Z' } },
            { fields: { Name: 'Activity 2', 'Activity Date': '2026-02-20T00:00:00.000Z' } },
          ],
        });

        try {
          const targetDateField = await createField(table.id, {
            name: 'Last Activity Date',
            type: FieldType.Date,
            options: { formatting: dateFormatting },
          });
          table.fields.push(targetDateField);

          const sourceDateFieldId = sourceTable.fields.find(
            (field) => field.name === 'Activity Date'
          )!.id;
          const linkField = await createField(table.id, {
            name: 'Activities',
            type: FieldType.Link,
            options: {
              relationship: Relationship.OneMany,
              foreignTableId: sourceTable.id,
            },
          });
          table.fields.push(linkField);

          const lookupDateField = await createField(table.id, {
            name: 'Date (from Activities)',
            type: FieldType.Date,
            isLookup: true,
            lookupOptions: {
              foreignTableId: sourceTable.id,
              linkFieldId: linkField.id,
              lookupFieldId: sourceDateFieldId,
            },
            options: {
              formatting: dateFormatting,
            },
          });
          table.fields.push(lookupDateField);

          await updateRecordByApi(table.id, table.records[0].id, linkField.id, [
            { id: sourceTable.records[0].id },
            { id: sourceTable.records[1].id },
          ]);

          const fields = (await getFields(table.id, { viewId: table.views[0].id })).data;
          const lookupFieldIndex = fields.findIndex((field) => field.id === lookupDateField.id);
          const targetDateFieldIndex = fields.findIndex((field) => field.id === targetDateField.id);

          const { content, header } = (
            await apiCopy(table.id, {
              viewId: table.views[0].id,
              ranges: [
                [lookupFieldIndex, 0],
                [lookupFieldIndex, 0],
              ],
            })
          ).data;

          await apiPaste(table.id, {
            viewId: table.views[0].id,
            content,
            header,
            ranges: [
              [targetDateFieldIndex, 0],
              [targetDateFieldIndex, 0],
            ],
          });

          const record = await getRecord(table.id, table.records[0].id);
          expect(record.fields[targetDateField.id]).toBe('2026-02-15T00:00:00.000Z');
        } finally {
          await permanentDeleteTable(baseId, sourceTable.id);
        }
      }
    );

    it('should paste a raw lookup date array into a regular date field in v2', async () => {
      const dateFormatting = {
        date: 'YYYY-MM-DD',
        time: 'None',
        timeZone: 'UTC',
      } as const;

      const sourceTable = await createTable(baseId, {
        name: 'lookup-date-source-v2-single',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          {
            name: 'Activity Date',
            type: FieldType.Date,
            options: { formatting: dateFormatting },
          },
        ],
        records: [{ fields: { Name: 'Activity 1', 'Activity Date': '2026-02-15T00:00:00.000Z' } }],
      });

      try {
        const targetDateField = await createField(table.id, {
          name: 'Last Activity Date',
          type: FieldType.Date,
          options: { formatting: dateFormatting },
        });
        table.fields.push(targetDateField);

        const sourceDateFieldId = sourceTable.fields.find(
          (field) => field.name === 'Activity Date'
        )!.id;
        const linkField = await createField(table.id, {
          name: 'Activities',
          type: FieldType.Link,
          options: {
            relationship: Relationship.OneMany,
            foreignTableId: sourceTable.id,
          },
        });
        table.fields.push(linkField);

        const lookupDateField = await createField(table.id, {
          name: 'Date (from Activities)',
          type: FieldType.Date,
          isLookup: true,
          lookupOptions: {
            foreignTableId: sourceTable.id,
            linkFieldId: linkField.id,
            lookupFieldId: sourceDateFieldId,
          },
          options: {
            formatting: dateFormatting,
          },
        });
        table.fields.push(lookupDateField);

        await updateRecordByApi(table.id, table.records[0].id, linkField.id, [
          { id: sourceTable.records[0].id },
        ]);

        const sourceRecord = await getRecord(table.id, table.records[0].id);
        const lookupValue = sourceRecord.fields[lookupDateField.id];
        expect(lookupValue).toEqual(['2026-02-15T00:00:00.000Z']);

        const fields = (await getFields(table.id, { viewId: table.views[0].id })).data;
        const targetDateFieldIndex = fields.findIndex((field) => field.id === targetDateField.id);

        const res = await pasteWithCanary(
          table.id,
          {
            viewId: table.views[0].id,
            content: [[lookupValue]],
            header: [lookupDateField],
            ranges: [
              [targetDateFieldIndex, 0],
              [targetDateFieldIndex, 0],
            ],
          },
          true
        );

        expect(res.status).toBe(200);
        expect(res.headers['x-teable-v2']).toBe('true');

        const record = await getRecord(table.id, table.records[0].id);
        expect(record.fields[targetDateField.id]).toBe('2026-02-15T00:00:00.000Z');
      } finally {
        await permanentDeleteTable(baseId, sourceTable.id);
      }
    });

    it('should keep the first raw lookup date when pasting multiple lookup dates in v2', async () => {
      const dateFormatting = {
        date: 'YYYY-MM-DD',
        time: 'None',
        timeZone: 'UTC',
      } as const;

      const sourceTable = await createTable(baseId, {
        name: 'lookup-date-source-v2-multiple',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          {
            name: 'Activity Date',
            type: FieldType.Date,
            options: { formatting: dateFormatting },
          },
        ],
        records: [
          { fields: { Name: 'Activity 1', 'Activity Date': '2026-02-15T00:00:00.000Z' } },
          { fields: { Name: 'Activity 2', 'Activity Date': '2026-02-20T00:00:00.000Z' } },
        ],
      });

      try {
        const targetDateField = await createField(table.id, {
          name: 'Last Activity Date',
          type: FieldType.Date,
          options: { formatting: dateFormatting },
        });
        table.fields.push(targetDateField);

        const sourceDateFieldId = sourceTable.fields.find(
          (field) => field.name === 'Activity Date'
        )!.id;
        const linkField = await createField(table.id, {
          name: 'Activities',
          type: FieldType.Link,
          options: {
            relationship: Relationship.OneMany,
            foreignTableId: sourceTable.id,
          },
        });
        table.fields.push(linkField);

        const lookupDateField = await createField(table.id, {
          name: 'Date (from Activities)',
          type: FieldType.Date,
          isLookup: true,
          lookupOptions: {
            foreignTableId: sourceTable.id,
            linkFieldId: linkField.id,
            lookupFieldId: sourceDateFieldId,
          },
          options: {
            formatting: dateFormatting,
          },
        });
        table.fields.push(lookupDateField);

        await updateRecordByApi(table.id, table.records[0].id, linkField.id, [
          { id: sourceTable.records[0].id },
          { id: sourceTable.records[1].id },
        ]);

        const sourceRecord = await getRecord(table.id, table.records[0].id);
        const lookupValue = sourceRecord.fields[lookupDateField.id];
        expect(lookupValue).toEqual(['2026-02-15T00:00:00.000Z', '2026-02-20T00:00:00.000Z']);

        const fields = (await getFields(table.id, { viewId: table.views[0].id })).data;
        const targetDateFieldIndex = fields.findIndex((field) => field.id === targetDateField.id);

        const res = await pasteWithCanary(
          table.id,
          {
            viewId: table.views[0].id,
            content: [[lookupValue]],
            header: [lookupDateField],
            ranges: [
              [targetDateFieldIndex, 0],
              [targetDateFieldIndex, 0],
            ],
          },
          true
        );

        expect(res.status).toBe(200);
        expect(res.headers['x-teable-v2']).toBe('true');

        const record = await getRecord(table.id, table.records[0].id);
        expect(record.fields[targetDateField.id]).toBe('2026-02-15T00:00:00.000Z');
      } finally {
        await permanentDeleteTable(baseId, sourceTable.id);
      }
    });
  });

  describe('api/table/:tableId/selection/delete (DELETE)', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'table2',
        fields: [
          {
            name: 'name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'number',
            type: FieldType.Number,
          },
        ],
        records: [
          { fields: { name: 'test', number: 1 } },
          { fields: { name: 'test2', number: 2 } },
          { fields: { name: 'test', number: 1 } },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should delete selected data', async () => {
      const viewId = table.views[0].id;
      const result = await deleteSelection(table.id, {
        viewId,
        type: RangeType.Rows,
        ranges: [
          [0, 0],
          [2, 2],
        ],
      });
      expect(result.data.ids).toEqual([table.records[0].id, table.records[2].id]);
    });

    it('should delete selected data with filter', async () => {
      const viewId = table.views[0].id;
      const result = await deleteSelection(table.id, {
        viewId,
        ranges: [
          [0, 0],
          [1, 1],
        ],
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: table.fields[0].id,
              value: 'test',
              operator: 'is',
            },
          ],
        },
      });
      expect(result.data.ids).toEqual([table.records[0].id, table.records[2].id]);
    });

    it('should delete selected data with orderBy', async () => {
      const viewId = table.views[0].id;
      const result = await deleteSelection(table.id, {
        viewId,
        ranges: [
          [0, 0],
          [1, 1],
        ],
        orderBy: [
          {
            fieldId: table.fields[0].id,
            order: SortFunc.Desc,
          },
        ],
      });
      expect(result.data.ids).toEqual([table.records[1].id, table.records[0].id]);
    });

    it('should delete selected data with view filter', async () => {
      const viewId = table.views[0].id;
      await updateViewFilter(table.id, viewId, {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: table.fields[0].id,
              value: 'test',
              operator: 'is',
            },
          ],
        },
      });
      const result = await deleteSelection(table.id, {
        viewId,
        ranges: [
          [0, 0],
          [1, 1],
        ],
      });
      expect(result.data.ids).toEqual([table.records[0].id, table.records[2].id]);
    });

    it.each(
      isForceV2
        ? [{ label: 'v2-forced', useV2: true, v2Header: 'true' }]
        : [
            { label: 'v1', useV2: false, v2Header: 'false' },
            { label: 'v2', useV2: true, v2Header: 'true' },
          ]
    )(
      'should delete rows matched by hide-not-match search in $label even when matches are beyond base range',
      async ({ useV2, v2Header }) => {
        const searchTable = await createTable(baseId, {
          name: `search-delete-${useV2 ? 'v2' : 'v1'}`,
          fields: [
            {
              name: 'name',
              type: FieldType.SingleLineText,
            },
          ],
          records: [
            { fields: { name: 'alpha' } },
            { fields: { name: 'beta' } },
            { fields: { name: 'gamma' } },
            { fields: { name: 'target one' } },
            { fields: { name: 'target two' } },
          ],
        });
        try {
          const viewId = searchTable.views[0].id;
          const result = await deleteWithCanary(
            searchTable.id,
            {
              viewId,
              type: RangeType.Rows,
              ranges: [[0, 1]],
              search: ['target', searchTable.fields[0].id, true],
            },
            useV2
          );

          expect(result.status).toBe(200);
          expect(result.headers['x-teable-v2']).toBe(v2Header);
          expect(result.data.ids).toEqual([searchTable.records[3].id, searchTable.records[4].id]);
        } finally {
          await permanentDeleteTable(baseId, searchTable.id);
        }
      }
    );

    it('should delete selection when filter compares text field to lookup-backed formula', async () => {
      await permanentDeleteTable(baseId, table.id);
      table = await createTable(baseId, {
        name: 'orders',
        fields: [
          {
            name: 'Order Number',
            type: FieldType.SingleLineText,
          },
        ],
        records: [
          { fields: { 'Order Number': 'ORD-001' } },
          { fields: { 'Order Number': 'ORD-002' } },
        ],
      });

      const detailTable = await createTable(baseId, {
        name: 'order details',
        fields: [
          {
            name: 'External Number',
            type: FieldType.SingleLineText,
          },
        ],
        records: [
          { fields: { 'External Number': 'ORD-001' } },
          { fields: { 'External Number': 'ORD-002' } },
        ],
      });

      try {
        const orderNumberField = table.fields.find((f) => f.name === 'Order Number')!;
        const externalNumberField = detailTable.fields.find((f) => f.name === 'External Number')!;

        const linkField = await createField(table.id, {
          name: 'Detail Link',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: detailTable.id,
          },
        });

        const lookupField = await createField(table.id, {
          name: 'External Number Lookup',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: detailTable.id,
            linkFieldId: linkField.id,
            lookupFieldId: externalNumberField.id,
          },
        });

        const formulaField = await createField(table.id, {
          name: 'Match Flag',
          type: FieldType.Formula,
          options: {
            expression: `IF({${orderNumberField.id}} = {${lookupField.id}}, "match", "not-match")`,
          },
        });

        await updateRecordByApi(table.id, table.records[0].id, linkField.id, {
          id: detailTable.records[0].id,
        });

        const record = await getRecord(table.id, table.records[0].id);
        expect(record.fields[formulaField.id]).toBe('match');

        const viewId = table.views[0].id;
        const result = await deleteSelection(table.id, {
          viewId,
          ranges: [
            [0, 0],
            [0, 0],
          ],
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: formulaField.id,
                value: 'match',
                operator: 'is',
              },
            ],
          },
        });

        expect(result.status).toBe(200);
        expect(Array.isArray(result.data.ids)).toBe(true);
      } finally {
        await permanentDeleteTable(baseId, detailTable.id);
      }
    });

    it.each(
      isForceV2
        ? [{ label: 'v2-forced', useV2: true, v2Header: 'true' }]
        : [
            { label: 'v1', useV2: false, v2Header: 'false' },
            { label: 'v2', useV2: true, v2Header: 'true' },
          ]
    )(
      'should delete correct row in $label when ignoreViewQuery+collapsed groups are provided',
      async ({ useV2, v2Header }) => {
        const deleteTable = await createTable(baseId, {
          name: `delete-ignore-range-${useV2 ? 'v2' : 'v1'}`,
          fields: [
            { name: 'Title', type: FieldType.SingleLineText },
            {
              name: 'Status',
              type: FieldType.SingleSelect,
              options: {
                choices: [
                  { name: 'GroupA', color: Colors.Blue },
                  { name: 'GroupB', color: Colors.Green },
                ],
              },
            },
          ],
          records: [
            { fields: { Title: 'A-01', Status: 'GroupA' } },
            { fields: { Title: 'A-02', Status: 'GroupA' } },
            { fields: { Title: 'B-01', Status: 'GroupB' } },
            { fields: { Title: 'B-02', Status: 'GroupB' } },
          ],
        });

        try {
          const viewId = deleteTable.views[0].id;
          const titleField = deleteTable.fields.find((f) => f.name === 'Title')!;
          const statusField = deleteTable.fields.find((f) => f.name === 'Status')!;

          await updateViewSort(deleteTable.id, viewId, {
            sort: {
              sortObjs: [{ fieldId: titleField.id, order: SortFunc.Desc }],
              manualSort: false,
            },
          });
          await updateViewFilter(deleteTable.id, viewId, {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: statusField.id,
                  operator: 'is',
                  value: 'GroupA',
                },
              ],
            },
          });

          const groupBy = [{ fieldId: statusField.id, order: SortFunc.Asc }] as const;
          const orderBy = [{ fieldId: titleField.id, order: SortFunc.Asc }] as const;

          const groupedResult = await getRecords(deleteTable.id, {
            viewId,
            ignoreViewQuery: true,
            groupBy: [...groupBy],
            orderBy: [...orderBy],
            fieldKeyType: FieldKeyType.Id,
          });
          const firstGroupHeader = groupedResult.data.extra?.groupPoints?.find(
            (point) => point.type === 0 && 'id' in point
          );
          expect(firstGroupHeader).toBeDefined();
          const collapsedGroupIds = [(firstGroupHeader as { id: string }).id];

          const deleteRes = await deleteWithCanary(
            deleteTable.id,
            {
              viewId,
              ignoreViewQuery: true,
              ranges: [[0, 0]],
              type: RangeType.Rows,
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: statusField.id,
                    operator: 'isAnyOf',
                    value: ['GroupA', 'GroupB'],
                  },
                ],
              },
              orderBy: [...orderBy],
              groupBy: [...groupBy],
              collapsedGroupIds,
            },
            useV2
          );
          expect(deleteRes.status).toBe(200);
          expect(deleteRes.headers['x-teable-v2']).toBe(v2Header);
          expect(deleteRes.data.ids).toHaveLength(1);

          const recordsAfter = await getRecords(deleteTable.id, {
            fieldKeyType: FieldKeyType.Id,
          });

          expect(
            recordsAfter.data.records.some((record) => record.fields[titleField.id] === 'B-01')
          ).toBe(false);
          expect(
            recordsAfter.data.records.some((record) => record.fields[titleField.id] === 'A-01')
          ).toBe(true);
        } finally {
          await permanentDeleteTable(baseId, deleteTable.id);
        }
      }
    );
  });

  describe('api/table/:tableId/selection/delete-stream (SSE)', () => {
    it('should stream v2 delete progress and return the deleted ids', async () => {
      const streamTable = await createTable(baseId, {
        name: 'delete-stream',
        fields: [
          { name: 'name', type: FieldType.SingleLineText },
          { name: 'number', type: FieldType.Number },
        ],
        records: [
          { fields: { name: 'stream-1', number: 1 } },
          { fields: { name: 'stream-2', number: 2 } },
          { fields: { name: 'stream-3', number: 3 } },
        ],
      });

      try {
        const { progressEvents, doneEvent, errorEvents } = await deleteStreamWithCanary(
          streamTable.id,
          {
            viewId: streamTable.views[0].id,
            type: RangeType.Rows,
            ranges: [[0, 2]],
          },
          true
        );

        expect(errorEvents).toHaveLength(0);
        expect(doneEvent?.data.deletedRecordIds).toEqual(
          streamTable.records.map((record) => record.id)
        );
        expect(progressEvents.some((event) => event.totalCount === 3)).toBe(true);
        expect(progressEvents.some((event) => event.deletedCount > 0)).toBe(true);

        const recordsAfter = await getRecords(streamTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });
        expect(recordsAfter.data.records).toHaveLength(0);
      } finally {
        await permanentDeleteTable(baseId, streamTable.id);
      }
    });

    it('should expose stream response headers for v2 delete', async () => {
      const streamTable = await createTable(baseId, {
        name: 'delete-stream-headers',
        fields: [{ name: 'name', type: FieldType.SingleLineText }],
        records: [{ fields: { name: 'stream-headers-1' } }],
      });

      try {
        const { headers } = await deleteStreamWithCanary(
          streamTable.id,
          {
            viewId: streamTable.views[0].id,
            type: RangeType.Rows,
            ranges: [[0, 0]],
          },
          true
        );

        expect(headers.contentType).toContain('text/event-stream');
        expect(headers.xAccelBuffering).toBe('no');
        expect(headers.xTeableV2).toBe('true');
        expect(headers.xTeableV2Feature).toBe('deleteRecord');
      } finally {
        await permanentDeleteTable(baseId, streamTable.id);
      }
    });

    it('should allow delete-stream when v2 canary is disabled and fall back to v1 synchronous delete', async () => {
      const streamTable = await createTable(baseId, {
        name: 'delete-stream-v1-fallback',
        fields: [
          { name: 'name', type: FieldType.SingleLineText },
          { name: 'number', type: FieldType.Number },
        ],
        records: [
          { fields: { name: 'stream-v1-1', number: 1 } },
          { fields: { name: 'stream-v1-2', number: 2 } },
          { fields: { name: 'stream-v1-3', number: 3 } },
        ],
      });

      try {
        const { progressEvents, doneEvent, errorEvents } = await deleteStreamWithCanary(
          streamTable.id,
          {
            viewId: streamTable.views[0].id,
            type: RangeType.Rows,
            ranges: [[0, 2]],
          },
          false
        );

        expect(errorEvents).toHaveLength(0);
        expect(progressEvents.length).toBeGreaterThan(0);
        expect(progressEvents[0]).toMatchObject({
          phase: 'preparing',
          deletedCount: 0,
        });
        expect(progressEvents.at(-1)).toMatchObject({
          totalCount: 3,
        });
        expect(doneEvent?.data.deletedRecordIds).toEqual(
          streamTable.records.map((record) => record.id)
        );
        expect(doneEvent?.deletedCount).toBe(3);

        const recordsAfter = await getRecords(streamTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });
        expect(recordsAfter.data.records).toHaveLength(0);
      } finally {
        await permanentDeleteTable(baseId, streamTable.id);
      }
    });

    it('should keep streaming after chunk error events and still deliver the final done event', async () => {
      const streamTable = await createTable(baseId, {
        name: 'delete-stream-partial-error',
        fields: [
          { name: 'name', type: FieldType.SingleLineText },
          { name: 'number', type: FieldType.Number },
        ],
        records: [
          { fields: { name: 'stream-error-1', number: 1 } },
          { fields: { name: 'stream-error-2', number: 2 } },
          { fields: { name: 'stream-error-3', number: 3 } },
        ],
      });

      const recordOpenApiV2Service = app.get(RecordOpenApiV2Service);
      const deleteByRangeStreamSpy = vi
        .spyOn(recordOpenApiV2Service, 'deleteByRangeStream')
        .mockImplementation(async function* () {
          yield {
            id: 'progress',
            phase: 'deleting',
            batchIndex: 0,
            totalCount: 3,
            deletedCount: 1,
            batchDeletedCount: 1,
          };
          yield {
            id: 'error',
            phase: 'deleting',
            batchIndex: 1,
            totalCount: 3,
            deletedCount: 1,
            recordIds: [streamTable.records[1]!.id],
            message: 'chunk 2 failed',
            code: 'unexpected',
          };
          yield {
            id: 'done',
            totalCount: 3,
            deletedCount: 2,
            data: {
              deletedCount: 2,
              deletedRecordIds: [streamTable.records[0]!.id, streamTable.records[2]!.id],
            },
          };
        });

      try {
        const { progressEvents, doneEvent, errorEvents } = await deleteStreamWithCanary(
          streamTable.id,
          {
            viewId: streamTable.views[0].id,
            type: RangeType.Rows,
            ranges: [[0, 2]],
          },
          true
        );

        expect(progressEvents).toHaveLength(1);
        expect(errorEvents).toEqual([
          {
            id: 'error',
            message: 'chunk 2 failed',
            batchIndex: 1,
            phase: 'deleting',
            recordIds: [streamTable.records[1]!.id],
          },
        ]);
        expect(doneEvent).toMatchObject({
          id: 'done',
          deletedCount: 2,
          data: {
            deletedRecordIds: [streamTable.records[0]!.id, streamTable.records[2]!.id],
          },
        });
      } finally {
        deleteByRangeStreamSpy.mockRestore();
        await permanentDeleteTable(baseId, streamTable.id);
      }
    });
  });

  describe('api/table/:tableId/selection/clear-stream (SSE)', () => {
    it('should stream v2 clear progress and clear the selected cells', async () => {
      const streamTable = await createTable(baseId, {
        name: 'clear-stream',
        fields: [
          { name: 'name', type: FieldType.SingleLineText },
          { name: 'number', type: FieldType.Number },
        ],
        records: [
          { fields: { name: 'stream-1', number: 1 } },
          { fields: { name: 'stream-2', number: 2 } },
          { fields: { name: 'stream-3', number: 3 } },
        ],
      });

      try {
        const nameFieldId = streamTable.fields.find((field) => field.name === 'name')!.id;
        const numberFieldId = streamTable.fields.find((field) => field.name === 'number')!.id;

        const { progressEvents, doneEvent, errorEvents } = await clearStreamWithCanary(
          streamTable.id,
          {
            viewId: streamTable.views[0].id,
            type: RangeType.Rows,
            ranges: [[0, 2]],
          },
          true
        );

        expect(errorEvents).toHaveLength(0);
        expect(doneEvent?.processedCount).toBe(3);
        expect(doneEvent?.clearedCount).toBe(3);
        expect(progressEvents.some((event) => event.totalCount === 3)).toBe(true);
        expect(progressEvents.some((event) => event.clearedCount > 0)).toBe(true);

        const recordsAfter = await getRecords(streamTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });
        expect(recordsAfter.data.records).toHaveLength(3);
        expect(recordsAfter.data.records.map((record) => record.fields[nameFieldId])).toEqual([
          undefined,
          undefined,
          undefined,
        ]);
        expect(recordsAfter.data.records.map((record) => record.fields[numberFieldId])).toEqual([
          undefined,
          undefined,
          undefined,
        ]);
      } finally {
        await permanentDeleteTable(baseId, streamTable.id);
      }
    });

    it('should allow clear-stream when v2 canary is disabled and fall back to v1 clear', async () => {
      const streamTable = await createTable(baseId, {
        name: 'clear-stream-v1-fallback',
        fields: [
          { name: 'name', type: FieldType.SingleLineText },
          { name: 'number', type: FieldType.Number },
        ],
        records: [
          { fields: { name: 'stream-v1-1', number: 1 } },
          { fields: { name: 'stream-v1-2', number: 2 } },
        ],
      });

      try {
        const nameFieldId = streamTable.fields.find((field) => field.name === 'name')!.id;

        const { progressEvents, doneEvent, errorEvents } = await clearStreamWithCanary(
          streamTable.id,
          {
            viewId: streamTable.views[0].id,
            type: RangeType.Rows,
            ranges: [[0, 1]],
          },
          false
        );

        expect(errorEvents).toHaveLength(0);
        expect(progressEvents[0]).toMatchObject({
          phase: 'preparing',
          processedCount: 0,
        });
        expect(doneEvent?.processedCount).toBe(2);
        expect(doneEvent?.clearedCount).toBe(2);

        const recordsAfter = await getRecords(streamTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });
        expect(recordsAfter.data.records.map((record) => record.fields[nameFieldId])).toEqual([
          undefined,
          undefined,
        ]);
      } finally {
        await permanentDeleteTable(baseId, streamTable.id);
      }
    });
  });

  describe('api/table/:tableId/selection/duplicate-stream (SSE)', () => {
    it('should stream v2 duplicate progress and return the duplicated ids', async () => {
      const streamTable = await createTable(baseId, {
        name: 'duplicate-stream',
        fields: [
          { name: 'name', type: FieldType.SingleLineText },
          { name: 'number', type: FieldType.Number },
        ],
        records: [
          { fields: { name: 'stream-1', number: 1 } },
          { fields: { name: 'stream-2', number: 2 } },
        ],
      });

      try {
        const { progressEvents, doneEvent, errorEvents } = await duplicateStreamWithCanary(
          streamTable.id,
          {
            viewId: streamTable.views[0].id,
            type: RangeType.Rows,
            ranges: [[0, 1]],
          },
          true
        );

        expect(errorEvents).toHaveLength(0);
        expect(doneEvent?.duplicatedCount).toBe(2);
        expect(doneEvent?.data.duplicatedRecordIds).toHaveLength(2);
        expect(progressEvents.some((event) => event.totalCount === 2)).toBe(true);
        expect(progressEvents.some((event) => event.duplicatedCount > 0)).toBe(true);

        const recordsAfter = await getRecords(streamTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });
        expect(recordsAfter.data.records).toHaveLength(4);
      } finally {
        await permanentDeleteTable(baseId, streamTable.id);
      }
    });

    it('should allow duplicate-stream when v2 canary is disabled and fall back to v1 duplication', async () => {
      const streamTable = await createTable(baseId, {
        name: 'duplicate-stream-v1-fallback',
        fields: [
          { name: 'name', type: FieldType.SingleLineText },
          { name: 'number', type: FieldType.Number },
        ],
        records: [
          { fields: { name: 'stream-v1-1', number: 1 } },
          { fields: { name: 'stream-v1-2', number: 2 } },
        ],
      });

      try {
        const { progressEvents, doneEvent, errorEvents } = await duplicateStreamWithCanary(
          streamTable.id,
          {
            viewId: streamTable.views[0].id,
            type: RangeType.Rows,
            ranges: [[0, 1]],
          },
          false
        );

        expect(errorEvents).toHaveLength(0);
        expect(progressEvents.length).toBeGreaterThan(0);
        expect(progressEvents[0]).toMatchObject({
          phase: 'preparing',
          duplicatedCount: 0,
        });
        expect(doneEvent?.duplicatedCount).toBe(2);

        const recordsAfter = await getRecords(streamTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });
        expect(recordsAfter.data.records).toHaveLength(4);
      } finally {
        await permanentDeleteTable(baseId, streamTable.id);
      }
    });
  });

  describe('api/table/:tableId/selection/paste-stream (SSE)', () => {
    it('should stream v2 paste progress and return the created ids', async () => {
      const streamTable = await createTable(baseId, {
        name: 'paste-stream',
        fields: [
          { name: 'name', type: FieldType.SingleLineText },
          { name: 'number', type: FieldType.Number },
        ],
        records: [
          { fields: { name: 'stream-1', number: 1 } },
          { fields: { name: 'stream-2', number: 2 } },
        ],
      });

      try {
        const nameFieldId = streamTable.fields.find((field) => field.name === 'name')!.id;

        const { progressEvents, doneEvent, errorEvents } = await pasteStreamWithCanary(
          streamTable.id,
          {
            viewId: streamTable.views[0].id,
            ranges: [
              [0, 0],
              [1, 2],
            ],
            content: [
              ['updated-1', 11],
              ['updated-2', 22],
              ['created-3', 33],
            ],
          },
          true
        );

        expect(errorEvents).toHaveLength(0);
        expect(doneEvent?.processedCount).toBe(3);
        expect(doneEvent?.updatedCount).toBe(2);
        expect(doneEvent?.createdCount).toBe(1);
        expect(doneEvent?.data.createdRecordIds).toHaveLength(1);
        expect(progressEvents.some((event) => event.totalCount === 3)).toBe(true);
        expect(progressEvents.some((event) => event.processedCount > 0)).toBe(true);

        const recordsAfter = await getRecords(streamTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });
        expect(recordsAfter.data.records).toHaveLength(3);
        expect(recordsAfter.data.records.map((record) => record.fields[nameFieldId])).toEqual([
          'updated-1',
          'updated-2',
          'created-3',
        ]);
      } finally {
        await permanentDeleteTable(baseId, streamTable.id);
      }
    });

    it('T3238 should not create rows when v2 paste-stream updates records out of the filtered view', async () => {
      const rowCount = 600;
      const createBatchSize = 200;
      const streamTable = await createTable(baseId, {
        name: 'T3238 paste-stream filtered empty rows',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [],
      });

      try {
        const viewId = streamTable.views[0].id;
        const nameFieldId = streamTable.fields.find((field) => field.name === 'Name')!.id;

        for (let offset = 0; offset < rowCount; offset += createBatchSize) {
          await createRecords(streamTable.id, {
            records: Array.from({ length: Math.min(createBatchSize, rowCount - offset) }, () => ({
              fields: {},
            })),
          });
        }

        await updateViewFilter(streamTable.id, viewId, {
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: nameFieldId,
                operator: 'isEmpty',
                value: null,
              },
            ],
          },
        });

        const filteredRecordsBefore = await getRecords(streamTable.id, {
          viewId,
          fieldKeyType: FieldKeyType.Id,
          take: rowCount,
        });
        expect(filteredRecordsBefore.data.records).toHaveLength(rowCount);

        const { progressEvents, doneEvent, errorEvents } = await pasteStreamWithCanary(
          streamTable.id,
          {
            viewId,
            ranges: [
              [0, 0],
              [0, rowCount - 1],
            ],
            content: Array.from({ length: rowCount }, (_, index) => [`T3238-${index}`]),
          },
          true
        );

        expect(errorEvents).toHaveLength(0);
        expect(doneEvent?.processedCount).toBe(rowCount);
        expect(doneEvent?.updatedCount).toBe(rowCount);
        expect(doneEvent?.createdCount).toBe(0);
        expect(doneEvent?.data.createdRecordIds).toHaveLength(0);
        expect(progressEvents.some((event) => event.totalCount === rowCount)).toBe(true);

        const allRecordsAfter = await getRecords(streamTable.id, {
          fieldKeyType: FieldKeyType.Id,
          take: rowCount,
        });
        expect(allRecordsAfter.data.records).toHaveLength(rowCount);
        expect(
          new Set(allRecordsAfter.data.records.map((record) => record.fields[nameFieldId]))
        ).toEqual(new Set(Array.from({ length: rowCount }, (_, index) => `T3238-${index}`)));

        const filteredRecordsAfter = await getRecords(streamTable.id, {
          viewId,
          fieldKeyType: FieldKeyType.Id,
          take: 1,
        });
        expect(filteredRecordsAfter.data.records).toHaveLength(0);
      } finally {
        await permanentDeleteTable(baseId, streamTable.id);
      }
    });

    it.skipIf(isForceV2)(
      'should allow paste-stream when v2 canary is disabled and fall back to v1 paste',
      async () => {
        const streamTable = await createTable(baseId, {
          name: 'paste-stream-v1-fallback',
          fields: [
            { name: 'name', type: FieldType.SingleLineText },
            { name: 'number', type: FieldType.Number },
          ],
          records: [{ fields: { name: 'stream-v1-1', number: 1 } }],
        });

        try {
          const nameFieldId = streamTable.fields.find((field) => field.name === 'name')!.id;

          const { progressEvents, doneEvent, errorEvents } = await pasteStreamWithCanary(
            streamTable.id,
            {
              viewId: streamTable.views[0].id,
              ranges: [
                [0, 0],
                [1, 1],
              ],
              content: [
                ['fallback-1', 11],
                ['fallback-2', 22],
              ],
            },
            false
          );

          expect(errorEvents).toHaveLength(0);
          expect(progressEvents.length).toBeGreaterThan(0);
          expect(progressEvents[0]).toMatchObject({
            phase: 'preparing',
            processedCount: 0,
          });
          expect(doneEvent?.processedCount).toBe(2);
          expect(doneEvent?.data.ranges).toEqual([
            [0, 0],
            [1, 1],
          ]);

          const recordsAfter = await getRecords(streamTable.id, {
            fieldKeyType: FieldKeyType.Id,
          });
          expect(recordsAfter.data.records).toHaveLength(2);
          expect(recordsAfter.data.records.map((record) => record.fields[nameFieldId])).toEqual([
            'fallback-1',
            'fallback-2',
          ]);
        } finally {
          await permanentDeleteTable(baseId, streamTable.id);
        }
      }
    );
  });

  describe('paste user', () => {
    let spaceId: string;
    let baseId: string;
    let tableData: ITableFullVo;
    let user1Info: IUserMeVo;
    let user2Info: IUserMeVo;
    beforeAll(async () => {
      spaceId = await createSpace({
        name: 'paste-same-name-user',
      }).then((res) => res.data.id);
      baseId = await createBase({
        name: 'paste-same-name-user',
        spaceId,
      }).then((res) => res.data.id);

      const user1 = await createNewUserAxios({
        email: 'paste-same-name-user@test.com',
        password: '12345678',
      });
      user1Info = await user1.get<IUserMeVo>(USER_ME).then((res) => res.data);
      const user2 = await createNewUserAxios({
        email: 'paste-same-name-user2@test.com',
        password: '12345678',
      });
      await user2.patch(UPDATE_USER_NAME, {
        name: 'paste-same-name-user',
      });
      user2Info = await user2.get<IUserMeVo>(USER_ME).then((res) => res.data);

      await emailSpaceInvitation({
        spaceId,
        emailSpaceInvitationRo: {
          emails: [user1Info.email, user2Info.email],
          role: Role.Editor,
        },
      });
    });

    beforeEach(async () => {
      tableData = await createTable(baseId, {
        name: 'table3',
        fields: [
          { name: 'name', type: FieldType.SingleLineText },
          { name: 'number', type: FieldType.Number },
          { name: 'user', type: FieldType.User },
        ],
        records: [
          {
            fields: {
              name: '1',
              number: 1,
              user: { id: user1Info.id, title: user1Info.name, email: user1Info.email },
            },
          },
          {
            fields: {
              name: '2',
              number: 2,
              user: { id: user2Info.id, title: user2Info.name, email: user2Info.email },
            },
          },
          {
            fields: {
              name: '3',
              number: 1,
            },
          },
          {
            fields: {
              name: '4',
              number: 2,
            },
          },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, tableData.id);
    });

    afterAll(async () => {
      await permanentDeleteBase(baseId);
      await permanentDeleteSpace(spaceId);
    });

    it('api/table/:tableId/selection/paste (POST) - exist same name user', async () => {
      await apiPaste(tableData.id, {
        viewId: tableData.defaultViewId!,
        content: 'paste-same-name-user',
        ranges: [
          [2, 2],
          [2, 2],
        ],
        header: [tableData.fields[0]],
      });
      const record = await getRecord(tableData.id, tableData.records[2].id);
      expect((record.fields[tableData.fields[2].id] as IUserCellValue)?.title).toBe(
        'paste-same-name-user'
      );
    });

    it('api/table/:tableId/selection/paste (POST) - exist same name user with cell value', async () => {
      await apiPaste(tableData.id, {
        viewId: tableData.defaultViewId!,
        content: [
          [
            {
              id: user2Info.id,
              title: user2Info.name,
              email: user2Info.email,
            },
          ],
          [
            {
              id: user1Info.id,
              title: user1Info.name,
              email: user1Info.email,
            },
          ],
        ],
        ranges: [
          [2, 2],
          [2, 2],
        ],
      });
      const recordsData = await getRecords(tableData.id, {
        viewId: tableData.defaultViewId!,
        skip: 2,
        take: 2,
      }).then((res) => res.data);
      expect(
        recordsData.records.map((r) => (r.fields[tableData.fields[2].name] as IUserCellValue)?.id)
      ).toEqual([user2Info.id, user1Info.id]);
    });
  });

  it('paste content end with newline', async () => {
    await apiPaste(table.id, {
      viewId: table.defaultViewId!,
      content: 'test\ntest2',
      ranges: [
        [0, 0],
        [0, 0],
      ],
    });
    await apiPaste(table.id, {
      viewId: table.defaultViewId!,
      content: 'test3\n',
      ranges: [
        [0, 0],
        [0, 0],
      ],
    });
    const records = await getRecords(table.id, {
      viewId: table.defaultViewId!,
    });
    expect(records.data.records.map((r) => r.fields[table.fields[0].name])).toEqual([
      'test3',
      'test2',
      undefined,
    ]);
  });

  describe('paste with projection', () => {
    let projectionTable: ITableFullVo;

    beforeEach(async () => {
      // Create a table with 4 fields: A, B, C, D
      projectionTable = await createTable(baseId, {
        name: 'projection-table',
        fields: [
          { name: 'Field A', type: FieldType.SingleLineText },
          { name: 'Field B', type: FieldType.SingleLineText },
          { name: 'Field C', type: FieldType.SingleLineText },
          { name: 'Field D', type: FieldType.SingleLineText },
        ],
        records: [
          { fields: { 'Field A': 'A1', 'Field B': 'B1', 'Field C': 'C1', 'Field D': 'D1' } },
          { fields: { 'Field A': 'A2', 'Field B': 'B2', 'Field C': 'C2', 'Field D': 'D2' } },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, projectionTable.id);
    });

    it('should paste correctly when projection order is shuffled', async () => {
      const fieldA = projectionTable.fields.find((f) => f.name === 'Field A')!;
      const fieldB = projectionTable.fields.find((f) => f.name === 'Field B')!;
      const fieldC = projectionTable.fields.find((f) => f.name === 'Field C')!;
      const fieldD = projectionTable.fields.find((f) => f.name === 'Field D')!;

      // Projection order is shuffled: D, B, A (skip C)
      // Original order in table: A, B, C, D
      const projection = [fieldD.id, fieldB.id, fieldA.id];

      // Paste 3 columns of data: should map to D, B, A respectively
      await apiPaste(projectionTable.id, {
        viewId: projectionTable.views[0].id,
        content: 'NewD1\tNewB1\tNewA1',
        ranges: [
          [0, 0],
          [0, 0],
        ],
        projection,
      });

      const recordsData = await getRecords(projectionTable.id, {
        viewId: projectionTable.views[0].id,
        fieldKeyType: FieldKeyType.Id,
      });

      const firstRecord = recordsData.data.records[0];

      // Verify: should update according to projection order
      expect(firstRecord.fields[fieldA.id]).toBe('NewA1'); // projection column 3
      expect(firstRecord.fields[fieldB.id]).toBe('NewB1'); // projection column 2
      expect(firstRecord.fields[fieldC.id]).toBe('C1'); // not in projection, should remain unchanged
      expect(firstRecord.fields[fieldD.id]).toBe('NewD1'); // projection column 1
    });

    it('should paste correctly when projection order is reversed', async () => {
      const fieldA = projectionTable.fields.find((f) => f.name === 'Field A')!;
      const fieldB = projectionTable.fields.find((f) => f.name === 'Field B')!;
      const fieldC = projectionTable.fields.find((f) => f.name === 'Field C')!;
      const fieldD = projectionTable.fields.find((f) => f.name === 'Field D')!;

      // Projection completely reversed: D, C, B, A
      const projection = [fieldD.id, fieldC.id, fieldB.id, fieldA.id];

      // Paste 2x2 data
      await apiPaste(projectionTable.id, {
        viewId: projectionTable.views[0].id,
        content: 'NewD1\tNewC1\nNewD2\tNewC2',
        ranges: [
          [0, 0],
          [1, 1],
        ],
        projection,
      });

      const recordsData = await getRecords(projectionTable.id, {
        viewId: projectionTable.views[0].id,
        fieldKeyType: FieldKeyType.Id,
      });

      // Verify first row: column 0 (index 0) maps to D, column 1 (index 1) maps to C
      const firstRecord = recordsData.data.records[0];
      expect(firstRecord.fields[fieldA.id]).toBe('A1'); // not in paste range, should remain unchanged
      expect(firstRecord.fields[fieldB.id]).toBe('B1'); // not in paste range, should remain unchanged
      expect(firstRecord.fields[fieldC.id]).toBe('NewC1');
      expect(firstRecord.fields[fieldD.id]).toBe('NewD1');

      // Verify second row
      const secondRecord = recordsData.data.records[1];
      expect(secondRecord.fields[fieldA.id]).toBe('A2');
      expect(secondRecord.fields[fieldB.id]).toBe('B2');
      expect(secondRecord.fields[fieldC.id]).toBe('NewC2');
      expect(secondRecord.fields[fieldD.id]).toBe('NewD2');
    });

    it('should paste to correct field when using shuffled projection with column offset', async () => {
      const fieldA = projectionTable.fields.find((f) => f.name === 'Field A')!;
      const fieldB = projectionTable.fields.find((f) => f.name === 'Field B')!;
      const fieldC = projectionTable.fields.find((f) => f.name === 'Field C')!;
      const fieldD = projectionTable.fields.find((f) => f.name === 'Field D')!;

      // Projection shuffled order: C, A, D
      const projection = [fieldC.id, fieldA.id, fieldD.id];

      // Paste to column index 1 (maps to Field A in projection)
      await apiPaste(projectionTable.id, {
        viewId: projectionTable.views[0].id,
        content: 'UpdatedA1',
        ranges: [
          [1, 0],
          [1, 0],
        ],
        projection,
      });

      const recordsData = await getRecords(projectionTable.id, {
        viewId: projectionTable.views[0].id,
        fieldKeyType: FieldKeyType.Id,
      });

      const firstRecord = recordsData.data.records[0];

      // Field A should be updated (projection index 1)
      expect(firstRecord.fields[fieldA.id]).toBe('UpdatedA1');
      // Other fields should remain unchanged
      expect(firstRecord.fields[fieldB.id]).toBe('B1');
      expect(firstRecord.fields[fieldC.id]).toBe('C1');
      expect(firstRecord.fields[fieldD.id]).toBe('D1');
    });
  });

  describe('paste with orderBy (view row order)', () => {
    /**
     * Critical test for ensuring paste operations target the correct rows
     * when a view has custom sort order.
     *
     * Without the orderBy parameter, paste would use the default __auto_number order,
     * causing updates to go to the wrong records.
     */
    let sortTable: ITableFullVo;

    beforeEach(async () => {
      // Create a table for sort tests with explicit records
      // Creation order: A(100), B(200), C(300), D(400), E(500)
      // Default order (by auto_number): A, B, C, D, E
      // Descending by Value: E(500), D(400), C(300), B(200), A(100)
      sortTable = await createTable(baseId, {
        name: 'sort-paste-table',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Value', type: FieldType.Number },
        ],
        records: [
          { fields: { Name: 'RecordA', Value: 100 } },
          { fields: { Name: 'RecordB', Value: 200 } },
          { fields: { Name: 'RecordC', Value: 300 } },
          { fields: { Name: 'RecordD', Value: 400 } },
          { fields: { Name: 'RecordE', Value: 500 } },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, sortTable.id);
    });

    it('should paste to correct rows when orderBy is specified (descending)', async () => {
      /**
       * Test scenario:
       * - Records in creation order: A(100), B(200), C(300), D(400), E(500)
       * - View sorted by Value DESC: E(500), D(400), C(300), B(200), A(100)
       * - Paste "Updated" to row 0 with orderBy=[{fieldId: valueFieldId, order: 'desc'}]
       * - Should update E (first in DESC order), NOT A (first in creation order)
       */
      const nameField = sortTable.fields.find((f) => f.name === 'Name')!;
      const valueField = sortTable.fields.find((f) => f.name === 'Value')!;

      await apiPaste(sortTable.id, {
        viewId: sortTable.views[0].id,
        content: 'SortTestUpdated',
        ranges: [
          [0, 0],
          [0, 0],
        ],
        orderBy: [{ fieldId: valueField.id, order: SortFunc.Desc }],
      });

      // Verify E was updated (not A)
      const records = await getRecords(sortTable.id, {
        viewId: sortTable.views[0].id,
        fieldKeyType: FieldKeyType.Id,
      });

      const recordE = records.data.records.find((r) => r.fields[valueField.id] === 500);
      const recordA = records.data.records.find((r) => r.fields[valueField.id] === 100);

      expect(recordE?.fields[nameField.id]).toBe('SortTestUpdated');
      expect(recordA?.fields[nameField.id]).toBe('RecordA'); // Should remain unchanged
    });

    it('should paste multiple rows in correct sort order', async () => {
      /**
       * Test scenario:
       * - View sorted by Value DESC: E(500), D(400), C(300), B(200), A(100)
       * - Paste to rows 1-3 with orderBy DESC
       * - Should update D, C, B (rows 1-3 in DESC order)
       */
      const nameField = sortTable.fields.find((f) => f.name === 'Name')!;
      const valueField = sortTable.fields.find((f) => f.name === 'Value')!;

      await apiPaste(sortTable.id, {
        viewId: sortTable.views[0].id,
        content: 'SortRow1\nSortRow2\nSortRow3',
        ranges: [
          [0, 1],
          [0, 3],
        ],
        orderBy: [{ fieldId: valueField.id, order: SortFunc.Desc }],
      });

      // Verify D, C, B were updated in order
      const records = await getRecords(sortTable.id, {
        viewId: sortTable.views[0].id,
        fieldKeyType: FieldKeyType.Id,
      });

      const recordD = records.data.records.find((r) => r.fields[valueField.id] === 400);
      const recordC = records.data.records.find((r) => r.fields[valueField.id] === 300);
      const recordB = records.data.records.find((r) => r.fields[valueField.id] === 200);
      const recordE = records.data.records.find((r) => r.fields[valueField.id] === 500);
      const recordA = records.data.records.find((r) => r.fields[valueField.id] === 100);

      expect(recordD?.fields[nameField.id]).toBe('SortRow1'); // First in paste range (row 1 in DESC)
      expect(recordC?.fields[nameField.id]).toBe('SortRow2'); // Second in paste range (row 2 in DESC)
      expect(recordB?.fields[nameField.id]).toBe('SortRow3'); // Third in paste range (row 3 in DESC)
      expect(recordE?.fields[nameField.id]).toBe('RecordE'); // Row 0, not in paste range
      expect(recordA?.fields[nameField.id]).toBe('RecordA'); // Row 4, not in paste range
    });

    it('should paste to correct rows with ascending sort', async () => {
      /**
       * Test scenario:
       * - View sorted by Value ASC: A(100), B(200), C(300), D(400), E(500)
       * - This matches creation order, so row 0 should be A
       * - Paste to row 0 with orderBy ASC
       * - Should update A (first in ASC order)
       */
      const nameField = sortTable.fields.find((f) => f.name === 'Name')!;
      const valueField = sortTable.fields.find((f) => f.name === 'Value')!;

      await apiPaste(sortTable.id, {
        viewId: sortTable.views[0].id,
        content: 'AscTestUpdated',
        ranges: [
          [0, 0],
          [0, 0],
        ],
        orderBy: [{ fieldId: valueField.id, order: SortFunc.Asc }],
      });

      const records = await getRecords(sortTable.id, {
        viewId: sortTable.views[0].id,
        fieldKeyType: FieldKeyType.Id,
      });

      const recordA = records.data.records.find((r) => r.fields[valueField.id] === 100);
      const recordE = records.data.records.find((r) => r.fields[valueField.id] === 500);

      expect(recordA?.fields[nameField.id]).toBe('AscTestUpdated');
      expect(recordE?.fields[nameField.id]).toBe('RecordE'); // Should remain unchanged
    });
  });

  describe('paste with view-level sort and filter (no client orderBy)', () => {
    /**
     * Regression test: when the view has a saved sort/filter but the client
     * does NOT send orderBy/filter in the paste request, the paste should
     * still target the correct rows using the view's saved configuration.
     *
     * This tests the v1-to-v2 adapter path where the adapter passes
     * sort:undefined to v2 core, which should then fall back to view defaults.
     */
    let viewSortTable: ITableFullVo;

    beforeEach(async () => {
      viewSortTable = await createTable(baseId, {
        name: 'view-sort-paste-table',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Value', type: FieldType.Number },
        ],
        records: [
          { fields: { Name: 'RecordA', Value: 100 } },
          { fields: { Name: 'RecordB', Value: 200 } },
          { fields: { Name: 'RecordC', Value: 300 } },
          { fields: { Name: 'RecordD', Value: 400 } },
          { fields: { Name: 'RecordE', Value: 500 } },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, viewSortTable.id);
    });

    it('should paste to correct row when view has sort+filter and client omits orderBy', async () => {
      const nameField = viewSortTable.fields.find((f) => f.name === 'Name')!;
      const valueField = viewSortTable.fields.find((f) => f.name === 'Value')!;
      const viewId = viewSortTable.views[0].id;

      // Set view-level sort: Value DESC
      await updateViewSort(viewSortTable.id, viewId, {
        sort: {
          sortObjs: [{ fieldId: valueField.id, order: SortFunc.Desc }],
          manualSort: false,
        },
      });

      // Set view-level filter: Value >= 200 (filters out RecordA=100)
      await updateViewFilter(viewSortTable.id, viewId, {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: valueField.id,
              value: 200,
              operator: 'isGreaterEqual',
            },
          ],
        },
      });

      // Paste at row 0 WITHOUT orderBy — rely on view defaults
      // Filtered DESC order: E(500), D(400), C(300), B(200)
      // Row 0 should be E(500)
      await apiPaste(viewSortTable.id, {
        viewId,
        content: 'ViewSortUpdated',
        ranges: [
          [0, 0],
          [0, 0],
        ],
        // No orderBy or filter — the view's saved sort/filter should be used
      });

      // Query WITHOUT viewId to see all records (including those filtered out by view)
      const records = await getRecords(viewSortTable.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const recordE = records.data.records.find((r) => r.fields[valueField.id] === 500);
      const recordA = records.data.records.find((r) => r.fields[valueField.id] === 100);

      // E should be updated (first in DESC among filtered)
      expect(recordE?.fields[nameField.id]).toBe('ViewSortUpdated');
      // A should remain unchanged (filtered out by the view)
      expect(recordA?.fields[nameField.id]).toBe('RecordA');
    });

    it('should paste to correct middle row when view has sort and client omits orderBy', async () => {
      const nameField = viewSortTable.fields.find((f) => f.name === 'Name')!;
      const valueField = viewSortTable.fields.find((f) => f.name === 'Value')!;
      const viewId = viewSortTable.views[0].id;

      // Set view-level sort: Value DESC (no filter this time)
      await updateViewSort(viewSortTable.id, viewId, {
        sort: {
          sortObjs: [{ fieldId: valueField.id, order: SortFunc.Desc }],
          manualSort: false,
        },
      });

      // Paste at row 2 WITHOUT orderBy — rely on view sort
      // DESC order: E(500), D(400), C(300), B(200), A(100)
      // Row 2 should be C(300)
      await apiPaste(viewSortTable.id, {
        viewId,
        content: 'ViewSortMiddle',
        ranges: [
          [0, 2],
          [0, 2],
        ],
        // No orderBy — the view's saved sort should be used
      });

      const records = await getRecords(viewSortTable.id, {
        viewId,
        fieldKeyType: FieldKeyType.Id,
      });

      const recordC = records.data.records.find((r) => r.fields[valueField.id] === 300);

      // C should be updated (row 2 in DESC order)
      expect(recordC?.fields[nameField.id]).toBe('ViewSortMiddle');
    });
  });

  describe('paste with incomplete view filters (v1/v2 parity)', () => {
    let incompleteFilterTable: ITableFullVo;

    beforeEach(async () => {
      incompleteFilterTable = await createTable(baseId, {
        name: 'incomplete-filter-paste-table',
        fields: [
          { name: 'ID', type: FieldType.AutoNumber },
          { name: 'Label', type: FieldType.SingleLineText },
          { name: 'Number', type: FieldType.Number },
          {
            name: 'Status',
            type: FieldType.SingleSelect,
            options: {
              choices: [
                { name: 'To do', color: Colors.Orange },
                { name: 'In progress', color: Colors.Cyan },
                { name: 'Done', color: Colors.Teal },
              ],
            },
          },
        ],
        records: [
          { fields: { Label: 'row1', Status: 'To do' } },
          { fields: { Label: 'row2' } },
          { fields: { Label: 'row3' } },
          { fields: { Label: 'row4' } },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, incompleteFilterTable.id);
    });

    it.each(
      isForceV2
        ? [{ label: 'v2-forced', useV2: true, v2Header: 'true' }]
        : [
            { label: 'v1', useV2: false, v2Header: 'false' },
            { label: 'v2', useV2: true, v2Header: 'true' },
          ]
    )(
      'should ignore incomplete non-checkbox view filters before pasting in $label',
      async ({ useV2, v2Header }) => {
        const viewId = incompleteFilterTable.views[0].id;
        const autoNumberField = incompleteFilterTable.fields.find((field) => field.name === 'ID')!;
        const statusField = incompleteFilterTable.fields.find((field) => field.name === 'Status')!;

        await updateViewFilter(incompleteFilterTable.id, viewId, {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: autoNumberField.id, operator: 'is', value: null }],
          },
        });

        const visibleRecords = await getRecordsWithCanary(
          incompleteFilterTable.id,
          {
            viewId,
            fieldKeyType: FieldKeyType.Id,
          },
          useV2
        );
        expect(visibleRecords.data.records).toHaveLength(4);

        const visibleFields = (await getFields(incompleteFilterTable.id, { viewId })).data;
        const statusColumnIndex = visibleFields.findIndex((field) => field.id === statusField.id);
        expect(statusColumnIndex).toBeGreaterThanOrEqual(0);

        const targetRecordId = incompleteFilterTable.records[2].id;
        const res = await pasteWithCanary(
          incompleteFilterTable.id,
          {
            viewId,
            content: [['In progress']],
            ranges: [
              [statusColumnIndex, 2],
              [statusColumnIndex, 2],
            ],
          },
          useV2
        );

        expect(res.status).toBe(200);
        expect(res.headers['x-teable-v2']).toBe(v2Header);

        const afterRecords = await getRecordsWithCanary(
          incompleteFilterTable.id,
          {
            fieldKeyType: FieldKeyType.Id,
          },
          useV2
        );
        expect(afterRecords.data.records).toHaveLength(4);

        const targetRecord = afterRecords.data.records.find(
          (record) => record.id === targetRecordId
        );
        expect(targetRecord?.fields[statusField.id]).toBe('In progress');
      }
    );
  });

  describe('paste with isNoneOf filter and NULL values (production regression)', () => {
    /**
     * Regression test for the production bug where paste targets the wrong record.
     *
     * Production scenario:
     * - A SingleSelect "Status" field with choices ["Open", "InProgress", "Closed"]
     * - Some records have Status = NULL (not set)
     * - View filter: Status isNoneOf ["Closed"]
     * - View sort: Name ASC
     *
     * v1 behavior: `COALESCE(Status, '') NOT IN ('Closed')` — NULL records are INCLUDED
     * v2 bug:      `Status NOT IN ('Closed')` — NULL records are EXCLUDED
     *               (because NULL NOT IN (...) returns NULL which is falsy)
     *
     * The different filtered sets cause row offsets to shift, making paste hit the wrong record.
     */
    let filterTable: ITableFullVo;

    beforeEach(async () => {
      filterTable = await createTable(baseId, {
        name: 'isNoneOf-filter-paste-table',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          {
            name: 'Status',
            type: FieldType.SingleSelect,
            options: {
              choices: [
                { name: 'Open', color: Colors.Blue },
                { name: 'InProgress', color: Colors.Yellow },
                { name: 'Closed', color: Colors.Red },
              ],
            },
          },
        ],
        records: [
          { fields: { Name: 'Alpha', Status: 'Open' } },
          { fields: { Name: 'Bravo', Status: null } }, // NULL status — must be included by isNoneOf
          { fields: { Name: 'Charlie', Status: 'InProgress' } },
          { fields: { Name: 'Delta', Status: null } }, // NULL status — must be included by isNoneOf
          { fields: { Name: 'Echo', Status: 'Closed' } }, // This should be excluded by filter
          { fields: { Name: 'Foxtrot', Status: 'Open' } },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, filterTable.id);
    });

    it('should include NULL records in isNoneOf filter and paste to correct row', async () => {
      const nameField = filterTable.fields.find((f) => f.name === 'Name')!;
      const statusField = filterTable.fields.find((f) => f.name === 'Status')!;
      const viewId = filterTable.views[0].id;

      // Set view-level sort: Name ASC
      await updateViewSort(filterTable.id, viewId, {
        sort: {
          sortObjs: [{ fieldId: nameField.id, order: SortFunc.Asc }],
          manualSort: false,
        },
      });

      // Set view-level filter: Status isNoneOf ["Closed"]
      await updateViewFilter(filterTable.id, viewId, {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: statusField.id,
              value: ['Closed'],
              operator: 'isNoneOf',
            },
          ],
        },
      });

      // Verify the filtered+sorted order first
      const beforeRecords = await getRecords(filterTable.id, {
        viewId,
        fieldKeyType: FieldKeyType.Id,
      });

      // Expected ASC order after filtering out "Closed" (Echo):
      // Row 0: Alpha (Open)
      // Row 1: Bravo (NULL) — v1 includes NULL in isNoneOf
      // Row 2: Charlie (InProgress)
      // Row 3: Delta (NULL) — v1 includes NULL in isNoneOf
      // Row 4: Foxtrot (Open)
      expect(beforeRecords.data.records).toHaveLength(5); // 6 - 1 (Closed)
      expect(beforeRecords.data.records[0].fields[nameField.id]).toBe('Alpha');
      expect(beforeRecords.data.records[1].fields[nameField.id]).toBe('Bravo');
      expect(beforeRecords.data.records[2].fields[nameField.id]).toBe('Charlie');
      expect(beforeRecords.data.records[3].fields[nameField.id]).toBe('Delta');
      expect(beforeRecords.data.records[4].fields[nameField.id]).toBe('Foxtrot');

      // Paste at row 3 (Delta, a NULL-status record) WITHOUT client orderBy
      // This is the critical test: if isNoneOf excludes NULLs, the row indices shift
      // and we would incorrectly target a different record
      await apiPaste(filterTable.id, {
        viewId,
        content: 'PastedToDelta',
        ranges: [
          [0, 3],
          [0, 3],
        ],
        // No orderBy or filter — rely on view defaults
      });

      // Re-fetch records without viewId to see all records including filtered ones
      const afterRecords = await getRecords(filterTable.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      // Find all records to check which one was actually updated
      const updatedRecord = afterRecords.data.records.find(
        (r) => r.fields[nameField.id] === 'PastedToDelta'
      );

      // Verify Delta was the one updated (not some other record)
      expect(updatedRecord).toBeDefined();
      // The updated record should have NULL status (was Delta)
      expect(updatedRecord?.fields[statusField.id]).toBeUndefined();

      // Echo (Closed) should remain unchanged — it was filtered out
      const echo = afterRecords.data.records.find((r) => r.fields[statusField.id] === 'Closed');
      expect(echo?.fields[nameField.id]).toBe('Echo');

      // Alpha should remain unchanged
      const alpha = afterRecords.data.records.find(
        (r) => r.fields[statusField.id] === 'Open' && r.fields[nameField.id] !== 'PastedToDelta'
      );
      expect(alpha).toBeDefined();
    });

    it('should paste to first NULL row correctly with isNoneOf filter', async () => {
      const nameField = filterTable.fields.find((f) => f.name === 'Name')!;
      const statusField = filterTable.fields.find((f) => f.name === 'Status')!;
      const viewId = filterTable.views[0].id;

      // Set view-level sort: Name ASC
      await updateViewSort(filterTable.id, viewId, {
        sort: {
          sortObjs: [{ fieldId: nameField.id, order: SortFunc.Asc }],
          manualSort: false,
        },
      });

      // Set view-level filter: Status isNoneOf ["Closed"]
      await updateViewFilter(filterTable.id, viewId, {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: statusField.id,
              value: ['Closed'],
              operator: 'isNoneOf',
            },
          ],
        },
      });

      // Paste at row 1 (Bravo, first NULL-status record)
      await apiPaste(filterTable.id, {
        viewId,
        content: 'PastedToBravo',
        ranges: [
          [0, 1],
          [0, 1],
        ],
      });

      const afterRecords = await getRecords(filterTable.id, {
        viewId,
        fieldKeyType: FieldKeyType.Id,
      });

      // Row 1 in the filtered ASC order should be Bravo (NULL status)
      // After paste, Bravo's Name should be updated
      // Note: since the Name changed, re-sort may change order
      // But we can verify by checking what was at row 1 got updated
      const updatedRecord = afterRecords.data.records.find(
        (r) => r.fields[nameField.id] === 'PastedToBravo'
      );
      expect(updatedRecord).toBeDefined();
      // The updated record should have NULL status (was Bravo)
      expect(updatedRecord?.fields[statusField.id]).toBeUndefined();
    });
  });

  describe('paste with ignoreViewQuery and collapsed groups (v1/v2)', () => {
    let groupedTable: ITableFullVo;

    beforeEach(async () => {
      groupedTable = await createTable(baseId, {
        name: 'ignore-view-query-paste-table',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          {
            name: 'Status',
            type: FieldType.SingleSelect,
            options: {
              choices: [
                { name: 'GroupA', color: Colors.Blue },
                { name: 'GroupB', color: Colors.Green },
              ],
            },
          },
        ],
        records: [
          { fields: { Name: 'A-01', Status: 'GroupA' } },
          { fields: { Name: 'A-02', Status: 'GroupA' } },
          { fields: { Name: 'A-03', Status: 'GroupA' } },
          { fields: { Name: 'A-04', Status: 'GroupA' } },
          { fields: { Name: 'A-05', Status: 'GroupA' } },
          { fields: { Name: 'B-01', Status: 'GroupB' } },
          { fields: { Name: 'B-02', Status: 'GroupB' } },
          { fields: { Name: 'B-03', Status: 'GroupB' } },
          { fields: { Name: 'B-04', Status: 'GroupB' } },
          { fields: { Name: 'B-05', Status: 'GroupB' } },
        ],
      });
    });

    describe('paste with search hideNotMatchRow (v1/v2)', () => {
      let searchTable: ITableFullVo;

      beforeEach(async () => {
        searchTable = await createTable(baseId, {
          name: 'search-hide-not-match-paste-table',
          fields: [
            { name: 'Name', type: FieldType.SingleLineText },
            { name: 'Count', type: FieldType.Number },
            { name: 'Notes', type: FieldType.LongText },
          ],
          records: [
            { fields: { Name: 'Alpha', Count: 10 } },
            { fields: { Name: 'target-one', Count: 20 } },
            { fields: { Name: 'Bravo', Count: 30 } },
            { fields: { Name: 'target-two', Count: 40 } },
            { fields: { Name: 'Charlie', Count: 50 } },
          ],
        });
      });

      afterEach(async () => {
        await permanentDeleteTable(baseId, searchTable.id);
      });

      it.each(
        isForceV2
          ? [{ label: 'v2-forced', useV2: true, v2Header: 'true' }]
          : [
              { label: 'v1', useV2: false, v2Header: 'false' },
              { label: 'v2', useV2: true, v2Header: 'true' },
            ]
      )('should respect search hidden-row offsets in $label', async ({ useV2, v2Header }) => {
        const nameField = searchTable.fields.find((field) => field.name === 'Name')!;
        const viewId = searchTable.views[0].id;

        const res = await pasteWithCanary(
          searchTable.id,
          {
            viewId,
            content: 'SearchBridge1\nSearchBridge2',
            ranges: [
              [0, 0],
              [0, 1],
            ],
            search: ['target', '', true],
          },
          useV2
        );

        expect(res.status).toBe(200);
        expect(res.headers['x-teable-v2']).toBe(v2Header);

        const records = await getRecords(searchTable.id, {
          viewId,
          fieldKeyType: FieldKeyType.Id,
        });

        expect(records.data.records[0].fields[nameField.id]).toBe('Alpha');
        expect(records.data.records[1].fields[nameField.id]).toBe('SearchBridge1');
        expect(records.data.records[2].fields[nameField.id]).toBe('Bravo');
        expect(records.data.records[3].fields[nameField.id]).toBe('SearchBridge2');
        expect(records.data.records[4].fields[nameField.id]).toBe('Charlie');
      });

      it.each(
        isForceV2
          ? [{ label: 'v2-forced', useV2: true, v2Header: 'true' }]
          : [
              { label: 'v1', useV2: false, v2Header: 'false' },
              { label: 'v2', useV2: true, v2Header: 'true' },
            ]
      )(
        'should paste to the second physical row in $label when it is also the second visible search hit',
        async ({ useV2, v2Header }) => {
          const adjacentTable = await createTable(baseId, {
            name: `search-adjacent-visible-hit-paste-${Date.now()}`,
            fields: [
              { name: 'Name', type: FieldType.SingleLineText },
              { name: 'Count', type: FieldType.Number },
              { name: 'Notes', type: FieldType.LongText },
            ],
            records: [
              { fields: { Name: '1', Count: 0 } },
              { fields: { Name: '', Count: 1 } },
              { fields: { Name: 'skip-me', Count: 0 } },
            ],
          });

          try {
            const nameField = adjacentTable.fields.find((field) => field.name === 'Name')!;
            const viewId = adjacentTable.views[0].id;

            const res = await pasteWithCanary(
              adjacentTable.id,
              {
                viewId,
                content: 'VisibleSecondRow',
                ranges: [
                  [0, 1],
                  [0, 1],
                ],
                search: ['1', '', true],
              },
              useV2
            );

            expect(res.status).toBe(200);
            expect(res.headers['x-teable-v2']).toBe(v2Header);

            const records = await getRecords(adjacentTable.id, {
              viewId,
              fieldKeyType: FieldKeyType.Id,
            });

            expect(records.data.records[0].fields[nameField.id]).toBe('1');
            expect(records.data.records[1].fields[nameField.id]).toBe('VisibleSecondRow');
            expect(records.data.records[2].fields[nameField.id]).toBe('skip-me');
          } finally {
            await permanentDeleteTable(baseId, adjacentTable.id);
          }
        }
      );
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, groupedTable.id);
    });

    it.each(
      isForceV2
        ? [{ label: 'v2-forced', useV2: true, v2Header: 'true' }]
        : [
            { label: 'v1', useV2: false, v2Header: 'false' },
            { label: 'v2', useV2: true, v2Header: 'true' },
          ]
    )(
      'should target the correct row in $label when client query overrides view defaults',
      async ({ useV2, v2Header }) => {
        const nameField = groupedTable.fields.find((f) => f.name === 'Name')!;
        const statusField = groupedTable.fields.find((f) => f.name === 'Status')!;
        const viewId = groupedTable.views[0].id;

        // Deliberately keep a conflicting view default sort; request sort must win when ignoreViewQuery=true.
        await updateViewSort(groupedTable.id, viewId, {
          sort: {
            sortObjs: [{ fieldId: nameField.id, order: SortFunc.Desc }],
            manualSort: false,
          },
        });
        await updateViewFilter(groupedTable.id, viewId, {
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: statusField.id,
                operator: 'is',
                value: 'GroupA',
              },
            ],
          },
        });

        const groupBy = [{ fieldId: statusField.id, order: SortFunc.Asc }] as const;
        const orderBy = [{ fieldId: nameField.id, order: SortFunc.Asc }] as const;

        const groupedResult = await getRecords(groupedTable.id, {
          viewId,
          ignoreViewQuery: true,
          groupBy: [...groupBy],
          orderBy: [...orderBy],
          fieldKeyType: FieldKeyType.Id,
        });

        const firstGroupHeader = groupedResult.data.extra?.groupPoints?.find(
          (point) => point.type === 0 && 'id' in point
        );
        expect(firstGroupHeader).toBeDefined();

        const collapsedGroupIds = [(firstGroupHeader as { id: string }).id];

        const pasteRes = await pasteWithCanary(
          groupedTable.id,
          {
            viewId,
            ignoreViewQuery: true,
            ranges: [
              [0, 0],
              [0, 0],
            ],
            content: 'Pasted-Target',
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: statusField.id,
                  operator: 'isAnyOf',
                  value: ['GroupA', 'GroupB'],
                },
              ],
            },
            orderBy: [...orderBy],
            groupBy: [...groupBy],
            projection: [nameField.id, statusField.id],
            collapsedGroupIds,
          },
          useV2
        );
        expect(pasteRes.status).toBe(200);
        expect(pasteRes.headers['x-teable-v2']).toBe(v2Header);

        const allRecords = await getRecords(groupedTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });

        expect(allRecords.data.records).toHaveLength(10);

        const updated = allRecords.data.records.find((record) => {
          return record.fields[nameField.id] === 'Pasted-Target';
        });
        expect(updated).toBeDefined();
        expect(updated?.fields[statusField.id]).toBe('GroupB');

        // If collapsed groups are ignored, GroupA rows are usually targeted first.
        expect(
          allRecords.data.records.some((record) => record.fields[nameField.id] === 'A-01')
        ).toBe(true);
        expect(
          allRecords.data.records.some((record) => record.fields[nameField.id] === 'B-01')
        ).toBe(false);
      }
    );
  });
});
