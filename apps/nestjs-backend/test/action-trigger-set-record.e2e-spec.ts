import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { axios, X_CANARY_HEADER } from '@teable/openapi';
import { ShareDbService } from '../src/share-db/share-db.service';
import type { IActionTrigger } from './utils/action-trigger';
import { collectActionTriggers } from './utils/action-trigger';
import { createRecords, createTable, initApp, permanentDeleteTable } from './utils/init-app';

const v2ResponseHeader = 'x-teable-v2';

// field-aware listeners (use-field-aware-table-listener) and the sharedb
// skipPoll contract rely on every setRecord presence event carrying the
// changed cell fieldIds, for both the v1 listener and the v2 projection
describe('Action trigger setRecord presence (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let port: string;
  let shareDbService: ShareDbService;
  const tableIds = new Set<string>();
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    cookie = appCtx.cookie;
    port = process.env.PORT!;
    shareDbService = app.get(ShareDbService);
  });

  afterAll(async () => {
    for (const tableId of [...tableIds].reverse()) {
      await permanentDeleteTable(baseId, tableId);
    }
    await app.close();
  });

  const setRecordFieldIds = (actions: ReadonlyArray<IActionTrigger>): string[] =>
    actions
      .filter(
        (action) => action.actionKey === 'setRecord' && Array.isArray(action.payload?.fieldIds)
      )
      .flatMap((action) => action.payload?.fieldIds as string[]);

  const prepareTable = async (name: string) => {
    const table = await createTable(baseId, {
      name,
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Note', type: FieldType.SingleLineText },
      ],
    });
    tableIds.add(table.id);

    const titleFieldId = table.fields[0].id;
    const noteFieldId = table.fields[1].id;
    const { records } = await createRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: {} }, { fields: {} }],
    });
    return { table, titleFieldId, noteFieldId, records };
  };

  const updateSingleRecord = async (params: {
    tableId: string;
    recordId: string;
    fieldId: string;
    value: string;
    useV2: boolean;
  }) => {
    const { tableId, recordId, fieldId, value, useV2 } = params;
    const response = await axios.patch(
      `/table/${tableId}/record/${recordId}`,
      { record: { fields: { [fieldId]: value } }, fieldKeyType: FieldKeyType.Id },
      { headers: useV2 ? { [X_CANARY_HEADER]: 'true' } : {} }
    );
    expect(response.status).toBe(200);
    if (useV2) {
      expect(response.headers[v2ResponseHeader]).toBe('true');
    } else {
      expect(response.headers[v2ResponseHeader]).not.toBe('true');
    }
  };

  const updateRecordsBatch = async (params: {
    tableId: string;
    updates: { id: string; fields: Record<string, unknown> }[];
    useV2: boolean;
  }) => {
    const { tableId, updates, useV2 } = params;
    const response = await axios.patch(
      `/table/${tableId}/record`,
      { records: updates, fieldKeyType: FieldKeyType.Id },
      { headers: useV2 ? { [X_CANARY_HEADER]: 'true' } : {} }
    );
    expect(response.status).toBe(200);
    if (useV2) {
      expect(response.headers[v2ResponseHeader]).toBe('true');
    } else {
      expect(response.headers[v2ResponseHeader]).not.toBe('true');
    }
  };

  describe.each([
    { engine: 'v1', useV2: false },
    { engine: 'v2', useV2: true },
  ])('$engine engine', ({ engine, useV2 }) => {
    it('emits setRecord with the changed fieldIds for a single record update', async () => {
      const { table, titleFieldId, noteFieldId, records } = await prepareTable(
        `set-record-presence-single-${engine}`
      );

      const actions = await collectActionTriggers({
        shareDbService,
        cookie,
        port,
        tableId: table.id,
        until: (received) => setRecordFieldIds(received).includes(noteFieldId),
        act: () =>
          updateSingleRecord({
            tableId: table.id,
            recordId: records[0].id,
            fieldId: noteFieldId,
            value: `${engine} single`,
            useV2,
          }),
      });

      expect(setRecordFieldIds(actions)).toEqual([noteFieldId]);
      expect(setRecordFieldIds(actions)).not.toContain(titleFieldId);
    });

    it('emits setRecord with the union of changed fieldIds for a batch update', async () => {
      const { table, titleFieldId, noteFieldId, records } = await prepareTable(
        `set-record-presence-batch-${engine}`
      );

      const expected = new Set([titleFieldId, noteFieldId]);
      const actions = await collectActionTriggers({
        shareDbService,
        cookie,
        port,
        tableId: table.id,
        until: (received) => {
          const ids = new Set(setRecordFieldIds(received));
          return [...expected].every((id) => ids.has(id));
        },
        act: () =>
          updateRecordsBatch({
            tableId: table.id,
            updates: [
              { id: records[0].id, fields: { [titleFieldId]: `${engine} batch title` } },
              { id: records[1].id, fields: { [noteFieldId]: `${engine} batch note` } },
            ],
            useV2,
          }),
      });

      expect(new Set(setRecordFieldIds(actions))).toEqual(expected);
    });
  });
});
