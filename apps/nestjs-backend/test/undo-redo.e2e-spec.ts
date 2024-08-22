/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, getRandomString } from '@teable/core';
import {
  axios,
  clear,
  createField,
  createRecords,
  deleteRecord,
  deleteRecords,
  deleteSelection,
  getRecord,
  getRecords,
  redo,
  undo,
  updateRecord,
  type ITableFullVo,
} from '@teable/openapi';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { createAwaitWithEvent } from './utils/event-promise';
import { initApp, deleteTable, createTable } from './utils/init-app';

describe('Undo Redo (e2e)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  let eventEmitterService: EventEmitterService;
  let awaitWithEvent: <T>(fn: () => Promise<T>) => Promise<T>;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    eventEmitterService = app.get(EventEmitterService);
    const windowId = 'win' + getRandomString(8);
    axios.interceptors.request.use((config) => {
      config.headers['X-Window-Id'] = windowId;
      return config;
    });
    awaitWithEvent = createAwaitWithEvent(eventEmitterService, Events.OPERATION_PUSH);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    table = await createTable(baseId, { name: 'table1' });
  });

  afterEach(async () => {
    await deleteTable(baseId, table.id);
  });

  it('should undo / redo create records', async () => {
    await createField(table.id, { type: FieldType.CreatedTime });
    await createField(table.id, { type: FieldType.LastModifiedTime });

    const record1 = (
      await awaitWithEvent(() =>
        createRecords(table.id, {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: { [table.fields[0].id]: 'record1' } }],
          order: {
            viewId: table.views[0].id,
            anchorId: table.records[0].id,
            position: 'after',
          },
        })
      )
    ).data.records[0];

    const allRecords = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: table.views[0].id,
    });
    expect(allRecords.data.records).toHaveLength(4);

    await undo(table.id);

    const allRecordsAfterUndo = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: table.views[0].id,
    });
    expect(allRecordsAfterUndo.data.records).toHaveLength(3);
    expect(allRecordsAfterUndo.data.records.find((r) => r.id === record1.id)).toBeUndefined();

    await redo(table.id);

    const allRecordsAfterRedo = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: table.views[0].id,
    });
    expect(allRecordsAfterRedo.data.records).toHaveLength(4);

    // back to index 1
    expect(allRecordsAfterRedo.data.records[1]).toMatchObject(record1);
  });

  it('should undo / redo delete record', async () => {
    await createField(table.id, { type: FieldType.CreatedTime });
    await createField(table.id, { type: FieldType.LastModifiedTime });

    // index 1
    const record1 = (
      await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: { [table.fields[0].id]: 'record1' } }],
        order: {
          viewId: table.views[0].id,
          anchorId: table.records[0].id,
          position: 'after',
        },
      })
    ).data.records[0];

    await awaitWithEvent(() => deleteRecord(table.id, record1.id));

    const allRecords = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: table.views[0].id,
    });
    // 4 -> 3
    expect(allRecords.data.records).toHaveLength(3);

    await undo(table.id);

    const allRecordsAfterUndo = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: table.views[0].id,
    });
    // 3 -> 4
    expect(allRecordsAfterUndo.data.records).toHaveLength(4);
    // back to index 1
    expect(allRecordsAfterUndo.data.records[1]).toMatchObject(record1);

    await redo(table.id);

    const allRecordsAfterRedo = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: table.views[0].id,
    });
    expect(allRecordsAfterRedo.data.records).toHaveLength(3);
    expect(allRecordsAfterRedo.data.records.find((r) => r.id === record1.id)).toBeUndefined();
  });

  it('should undo / redo delete selection records', async () => {
    await createField(table.id, { type: FieldType.CreatedTime });
    await createField(table.id, { type: FieldType.LastModifiedTime });

    // index 1
    const record1 = (
      await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: { [table.fields[0].id]: 'record1' } }],
        order: {
          viewId: table.views[0].id,
          anchorId: table.records[0].id,
          position: 'after',
        },
      })
    ).data.records[0];

    // delete index 1
    await awaitWithEvent(() =>
      deleteSelection(table.id, {
        viewId: table.views[0].id,
        ranges: [
          [0, 1],
          [1, 1],
        ],
      })
    );

    const allRecords = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: table.views[0].id,
    });

    expect(allRecords.data.records.find((r) => r.id === record1.id)).toBeUndefined();

    // 4 -> 3
    expect(allRecords.data.records).toHaveLength(3);

    await undo(table.id);

    const allRecordsAfterUndo = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: table.views[0].id,
    });
    // 3 -> 4
    expect(allRecordsAfterUndo.data.records).toHaveLength(4);
    // back to index 1
    expect(allRecordsAfterUndo.data.records[1]).toMatchObject(record1);

    await redo(table.id);

    const allRecordsAfterRedo = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: table.views[0].id,
    });
    expect(allRecordsAfterRedo.data.records).toHaveLength(3);
    expect(allRecordsAfterRedo.data.records.find((r) => r.id === record1.id)).toBeUndefined();
  });

  it('should undo / redo delete multiple records', async () => {
    await createField(table.id, { type: FieldType.CreatedTime });
    await createField(table.id, { type: FieldType.LastModifiedTime });

    // index 1
    const record1 = (
      await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: { [table.fields[0].id]: 'record1' } }],
        order: {
          viewId: table.views[0].id,
          anchorId: table.records[0].id,
          position: 'after',
        },
      })
    ).data.records[0];

    // delete index 1
    await awaitWithEvent(() => deleteRecords(table.id, [record1.id]));

    const allRecords = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: table.views[0].id,
    });

    expect(allRecords.data.records.find((r) => r.id === record1.id)).toBeUndefined();

    // 4 -> 3
    expect(allRecords.data.records).toHaveLength(3);

    await undo(table.id);

    const allRecordsAfterUndo = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: table.views[0].id,
    });
    // 3 -> 4
    expect(allRecordsAfterUndo.data.records).toHaveLength(4);
    // back to index 1
    expect(allRecordsAfterUndo.data.records[1]).toMatchObject(record1);

    await redo(table.id);

    const allRecordsAfterRedo = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: table.views[0].id,
    });
    expect(allRecordsAfterRedo.data.records).toHaveLength(3);
    expect(allRecordsAfterRedo.data.records.find((r) => r.id === record1.id)).toBeUndefined();
  });

  it('should undo / redo update record', async () => {
    await createField(table.id, { type: FieldType.CreatedTime });
    await createField(table.id, { type: FieldType.LastModifiedTime });

    await awaitWithEvent(() =>
      updateRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [table.fields[0].id]: 'A' } },
      })
    );

    const updatedRecord = (
      await awaitWithEvent(() =>
        updateRecord(table.id, table.records[0].id, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [table.fields[0].id]: 'B' } },
        })
      )
    ).data;

    expect(updatedRecord.fields[table.fields[0].id]).toEqual('B');

    await undo(table.id);

    const updatedRecordAfter = (
      await getRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
      })
    ).data;

    expect(updatedRecordAfter.fields[table.fields[0].id]).toEqual('A');

    await undo(table.id);

    const updatedRecordAfter2 = (
      await getRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
      })
    ).data;

    expect(updatedRecordAfter2.fields[table.fields[0].id]).toBeUndefined();

    await redo(table.id);

    const updatedRecordAfterRedo = (
      await getRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
      })
    ).data;

    expect(updatedRecordAfterRedo.fields[table.fields[0].id]).toEqual('A');

    await redo(table.id);

    const updatedRecordAfterRedo2 = (
      await getRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
      })
    ).data;

    expect(updatedRecordAfterRedo2.fields[table.fields[0].id]).toEqual('B');
  });

  it('should undo / redo clear records', async () => {
    await awaitWithEvent(() =>
      updateRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [table.fields[0].id]: 'A' } },
      })
    );

    await awaitWithEvent(() =>
      clear(table.id, {
        viewId: table.views[0].id,
        ranges: [
          [0, 0],
          [1, 0],
        ],
      })
    );

    const record = await getRecord(table.id, table.records[0].id, {
      fieldKeyType: FieldKeyType.Id,
    });

    expect(record.data.fields[table.fields[0].id]).toBeUndefined();

    await undo(table.id);

    const updatedRecordAfter = (
      await getRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
      })
    ).data;

    expect(updatedRecordAfter.fields[table.fields[0].id]).toEqual('A');

    await redo(table.id);

    const updatedRecordAfterRedo = (
      await getRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
      })
    ).data;

    expect(updatedRecordAfterRedo.fields[table.fields[0].id]).toBeUndefined();
  });
});
