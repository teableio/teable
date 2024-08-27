/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, getRandomString } from '@teable/core';
import {
  axios,
  clear,
  copy,
  createField,
  createRecords,
  deleteField,
  deleteRecord,
  deleteRecords,
  deleteSelection,
  getFields,
  getRecord,
  getRecords,
  paste,
  redo,
  undo,
  updateRecord,
  updateRecordOrders,
  updateRecords,
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
    await awaitWithEvent(() => createField(table.id, { type: FieldType.CreatedTime }));
    await awaitWithEvent(() => createField(table.id, { type: FieldType.LastModifiedTime }));

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

    await updateRecord(table.id, record1.id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [table.fields[0].id]: 'new value' } },
    });
  });

  it('should undo / redo delete record', async () => {
    await awaitWithEvent(() => createField(table.id, { type: FieldType.CreatedTime }));
    await awaitWithEvent(() => createField(table.id, { type: FieldType.LastModifiedTime }));

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
    await awaitWithEvent(() => createField(table.id, { type: FieldType.CreatedTime }));
    await awaitWithEvent(() => createField(table.id, { type: FieldType.LastModifiedTime }));

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
    await awaitWithEvent(() => createField(table.id, { type: FieldType.CreatedTime }));
    await awaitWithEvent(() => createField(table.id, { type: FieldType.LastModifiedTime }));

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
    await awaitWithEvent(() => createField(table.id, { type: FieldType.CreatedTime }));
    await awaitWithEvent(() => createField(table.id, { type: FieldType.LastModifiedTime }));

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

  it('should undo / redo update record value with order', async () => {
    // update and move 0 to 2
    const recordId = table.records[0].id;
    await awaitWithEvent(() =>
      updateRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [table.fields[0].id]: 'A' } },
        order: {
          viewId: table.views[0].id,
          anchorId: table.records[2].id,
          position: 'after',
        },
      })
    );

    const records = (
      await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: table.views[0].id,
      })
    ).data;

    expect(records.records[2].fields[table.fields[0].id]).toEqual('A');

    await undo(table.id);

    const recordsAfterUndo = (
      await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: table.views[0].id,
      })
    ).data;

    expect(recordsAfterUndo.records[0].id).toEqual(recordId);
    expect(recordsAfterUndo.records[0].fields[table.fields[0].id]).toBeUndefined();

    await redo(table.id);

    const recordsAfterRedo = (
      await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: table.views[0].id,
      })
    ).data;

    expect(recordsAfterRedo.records[2].fields[table.fields[0].id]).toEqual('A');
  });

  it('should undo / redo update record order in view', async () => {
    // update and move 0 to 2
    const recordId = table.records[0].id;
    await awaitWithEvent(() =>
      updateRecordOrders(table.id, table.views[0].id, {
        anchorId: table.records[2].id,
        position: 'after',
        recordIds: [table.records[0].id],
      })
    );

    const records = (
      await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: table.views[0].id,
      })
    ).data;

    expect(records.records[2].id).toEqual(recordId);

    await undo(table.id);

    const recordsAfterUndo = (
      await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: table.views[0].id,
      })
    ).data;

    expect(recordsAfterUndo.records[0].id).toEqual(recordId);

    await redo(table.id);

    const recordsAfterRedo = (
      await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: table.views[0].id,
      })
    ).data;

    expect(recordsAfterRedo.records[2].id).toEqual(recordId);
  });

  it('should undo / redo delete field', async () => {
    // update and move 0 to 2
    const fieldId = table.fields[1].id;
    await awaitWithEvent(() =>
      updateRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [table.fields[1].id]: 666 } },
      })
    );

    await awaitWithEvent(() => deleteField(table.id, fieldId));

    const fields = (
      await getFields(table.id, {
        viewId: table.views[0].id,
      })
    ).data;

    expect(fields.length).toEqual(2);

    await undo(table.id);

    const fieldsAfterUndo = (
      await getFields(table.id, {
        viewId: table.views[0].id,
      })
    ).data;

    expect(fieldsAfterUndo[1].id).toEqual(fieldId);

    const recordsAfterUndo = (
      await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: table.views[0].id,
      })
    ).data;

    expect(recordsAfterUndo.records[0].fields[fieldId]).toEqual(666);

    await redo(table.id);

    const fieldsAfterRedo = (
      await getFields(table.id, {
        viewId: table.views[0].id,
      })
    ).data;

    expect(fieldsAfterRedo.length).toEqual(2);
  });

  it('should undo / redo create field', async () => {
    const field = await awaitWithEvent(() =>
      createField(table.id, {
        type: FieldType.SingleLineText,
        order: {
          viewId: table.views[0].id,
          orderIndex: 0.5,
        },
      })
    );
    const fieldId = field.data.id;

    const fields = (
      await getFields(table.id, {
        viewId: table.views[0].id,
      })
    ).data;

    expect(fields[1].id).toEqual(fieldId);

    await undo(table.id);

    const fieldsAfterUndo = (
      await getFields(table.id, {
        viewId: table.views[0].id,
      })
    ).data;

    expect(fieldsAfterUndo.length).toEqual(3);

    await redo(table.id);

    const fieldsAfterRedo = (
      await getFields(table.id, {
        viewId: table.views[0].id,
      })
    ).data;

    expect(fieldsAfterRedo[1].id).toEqual(fieldId);
  });

  // event throw error because of sqlite(record history create many)
  it('should undo / redo delete field with outgoing references', async () => {
    // update and move 0 to 2
    const fieldId = table.fields[1].id;
    await awaitWithEvent(() =>
      updateRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [table.fields[1].id]: 666 } },
      })
    );

    const formulaField = await awaitWithEvent(() =>
      createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${table.fields[1].id}}`,
        },
      })
    );

    await awaitWithEvent(() => deleteField(table.id, fieldId));

    const fields = (
      await getFields(table.id, {
        viewId: table.views[0].id,
      })
    ).data;

    expect(fields.length).toEqual(3);
    expect(fields[2].hasError).toBeTruthy();

    await undo(table.id);

    const fieldsAfterUndo = (
      await getFields(table.id, {
        viewId: table.views[0].id,
      })
    ).data;

    expect(fieldsAfterUndo[1].id).toEqual(fieldId);
    expect(fieldsAfterUndo[3].id).toEqual(formulaField.data.id);
    expect(fieldsAfterUndo[3].hasError).toBeFalsy();

    const recordsAfterUndo = (
      await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: table.views[0].id,
      })
    ).data;

    expect(recordsAfterUndo.records[0].fields[fieldId]).toEqual(666);

    await redo(table.id);

    const fieldsAfterRedo = (
      await getFields(table.id, {
        viewId: table.views[0].id,
      })
    ).data;

    expect(fieldsAfterRedo.length).toEqual(3);
  });

  it.only('should undo / redo paste simple selection', async () => {
    await updateRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          id: table.records[0].id,
          fields: { [table.fields[0].id]: 'A', [table.fields[1].id]: 1 },
        },
      ],
    });

    const { content, header } = (
      await copy(table.id, {
        viewId: table.views[0].id,
        ranges: [
          [0, 0],
          [0, 0],
        ],
      })
    ).data;

    await awaitWithEvent(() =>
      paste(table.id, {
        viewId: table.views[0].id,
        content,
        header,
        ranges: [
          [0, 1],
          [0, 1],
        ],
      })
    );

    const records = (
      await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: table.views[0].id,
      })
    ).data;

    expect(records.records[1].fields[table.fields[0].id]).toEqual('A');

    await undo(table.id);

    const recordsAfterUndo = (
      await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: table.views[0].id,
      })
    ).data;

    expect(recordsAfterUndo.records[1].fields[table.fields[0].id]).toBeUndefined();

    await redo(table.id);

    const recordsAfterRedo = (
      await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: table.views[0].id,
      })
    ).data;

    expect(recordsAfterRedo.records[1].fields[table.fields[0].id]).toEqual('A');
  });

  it('should undo / redo paste expanding selection', async () => {
    await awaitWithEvent(() =>
      updateRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            id: table.records[0].id,
            fields: { [table.fields[0].id]: 'A', [table.fields[1].id]: 1 },
          },
          {
            id: table.records[1].id,
            fields: { [table.fields[0].id]: 'B', [table.fields[1].id]: 2 },
          },
        ],
      })
    );

    const { content, header } = (
      await copy(table.id, {
        viewId: table.views[0].id,
        ranges: [
          [0, 0],
          [1, 1],
        ],
      })
    ).data;

    await awaitWithEvent(() =>
      paste(table.id, {
        viewId: table.views[0].id,
        content,
        header,
        ranges: [
          [2, 2],
          [2, 2],
        ],
      })
    );

    const records = (
      await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: table.views[0].id,
      })
    ).data;
    const fields = (
      await getFields(table.id, {
        viewId: table.views[0].id,
      })
    ).data;

    expect(records.records[2].fields[fields[2].id]).toEqual('A');
    expect(records.records[2].fields[fields[3].id]).toEqual(1);
    expect(records.records[3].fields[fields[2].id]).toEqual('B');
    expect(records.records[3].fields[fields[3].id]).toEqual(2);

    await undo(table.id);

    const recordsAfterUndo = (
      await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: table.views[0].id,
      })
    ).data;

    const fieldsAfterUndo = (
      await getFields(table.id, {
        viewId: table.views[0].id,
      })
    ).data;

    expect(recordsAfterUndo.records[2].fields[fieldsAfterUndo[2].id]).toBeUndefined();
    expect(recordsAfterUndo.records.length).toEqual(3);
    expect(fieldsAfterUndo.length).toEqual(3);

    await redo(table.id);

    const recordsAfterRedo = (
      await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: table.views[0].id,
      })
    ).data;

    const fieldsAfterRedo = (
      await getFields(table.id, {
        viewId: table.views[0].id,
      })
    ).data;

    expect(recordsAfterRedo.records[2].fields[fieldsAfterRedo[2].id]).toEqual('A');
    expect(recordsAfterRedo.records[2].fields[fieldsAfterRedo[3].id]).toEqual(1);
    expect(recordsAfterRedo.records[3].fields[fieldsAfterRedo[2].id]).toEqual('B');
    expect(recordsAfterRedo.records[3].fields[fieldsAfterRedo[3].id]).toEqual(2);
  });
});
