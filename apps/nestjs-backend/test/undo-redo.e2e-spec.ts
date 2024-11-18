/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo, ILinkFieldOptions, IRollupFieldOptions } from '@teable/core';
import {
  CellValueType,
  DbFieldType,
  FieldKeyType,
  FieldType,
  getRandomString,
  Relationship,
  ViewType,
} from '@teable/core';
import {
  axios,
  clear,
  convertField,
  copy,
  createField,
  createRecords,
  createView,
  deleteField,
  deleteFields,
  deleteRecord,
  deleteRecords,
  deleteSelection,
  deleteView,
  getField,
  getFields,
  getRecord,
  getRecords,
  getView,
  getViewList,
  paste,
  redo,
  undo,
  updateRecord,
  updateRecordOrders,
  updateRecords,
  updateViewColumnMeta,
  updateViewDescription,
  updateViewFilter,
  updateViewName,
  updateViewOrder,
} from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { createAwaitWithEvent } from './utils/event-promise';
import { initApp, permanentDeleteTable, createTable, updateRecordByApi } from './utils/init-app';

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
    await permanentDeleteTable(baseId, table.id);
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

  it('should undo / redo delete multiple fields', async () => {
    const fieldId = table.fields[1].id;
    await awaitWithEvent(() =>
      updateRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [table.fields[1].id]: 666 } },
      })
    );

    const formulaField = (
      await awaitWithEvent(() =>
        createField(table.id, {
          type: FieldType.Formula,
          options: {
            expression: `{${table.fields[1].id}}`,
          },
        })
      )
    ).data;

    // delete 1 3
    await awaitWithEvent(() => deleteFields(table.id, [fieldId, formulaField.id]));

    const fields = (
      await getFields(table.id, {
        viewId: table.views[0].id,
      })
    ).data;

    expect(fields.length).toEqual(2);

    const result = await undo(table.id);
    expect(result.data.status).toEqual('fulfilled');

    // get back 1 3
    const fieldsAfterUndo = (
      await getFields(table.id, {
        viewId: table.views[0].id,
      })
    ).data;

    expect(fieldsAfterUndo[1].id).toEqual(fieldId);
    expect(fieldsAfterUndo[3].id).toEqual(formulaField.id);
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

    expect(fieldsAfterRedo.length).toEqual(2);
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

  it('should undo / redo paste simple selection', async () => {
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

  it('should undo / redo create view', async () => {
    const view = (
      await awaitWithEvent(() =>
        createView(table.id, {
          type: ViewType.Grid,
          name: 'view1',
        })
      )
    ).data;

    await undo(table.id);

    const viewsAfterUndo = (await getViewList(table.id)).data;
    expect(viewsAfterUndo.find((v) => v.id === view.id)).toBeUndefined();

    await redo(table.id);

    const viewsAfterRedo = (await getViewList(table.id)).data;
    expect(viewsAfterRedo.find((v) => v.id === view.id)).toMatchObject({
      id: view.id,
      name: view.name,
      type: view.type,
    });
  });

  it('should undo / redo delete view', async () => {
    const view = (
      await awaitWithEvent(() =>
        createView(table.id, {
          type: ViewType.Grid,
          name: 'view1',
        })
      )
    ).data;

    await awaitWithEvent(() => deleteView(table.id, view.id));

    await undo(table.id);

    const viewsAfterUndo = (await getViewList(table.id)).data;
    expect(viewsAfterUndo.find((v) => v.id === view.id)).toMatchObject({
      id: view.id,
      name: view.name,
      type: view.type,
    });

    await redo(table.id);

    const viewsAfterRedo = (await getViewList(table.id)).data;
    expect(viewsAfterRedo.find((v) => v.id === view.id)).toBeUndefined();
  });

  it('should undo / redo update view property', async () => {
    // name
    const view = table.views[0];
    (await awaitWithEvent(() => updateViewName(table.id, view.id, { name: 'newName' }))).data;

    await undo(table.id);

    expect((await getView(table.id, view.id)).data.name).toEqual(view.name);

    await redo(table.id);

    expect((await getView(table.id, view.id)).data.name).toEqual('newName');

    // description
    (
      await awaitWithEvent(() =>
        updateViewDescription(table.id, view.id, { description: 'newName' })
      )
    ).data;

    await undo(table.id);

    expect((await getView(table.id, view.id)).data.description).toEqual(view.description);

    await redo(table.id);

    expect((await getView(table.id, view.id)).data.description).toEqual('newName');

    // filter

    (
      await awaitWithEvent(() =>
        updateViewFilter(table.id, view.id, {
          filter: {
            filterSet: [
              {
                fieldId: table.fields![0].id,
                value: 'text',
                operator: 'is',
              },
            ],
            conjunction: 'and',
          },
        })
      )
    ).data;

    await undo(table.id);

    expect((await getView(table.id, view.id)).data.filter).toEqual(view.filter);

    await redo(table.id);

    expect((await getView(table.id, view.id)).data.filter).toEqual({
      filterSet: [
        {
          fieldId: table.fields![0].id,
          value: 'text',
          operator: 'is',
        },
      ],
      conjunction: 'and',
    });
  });

  it('should undo / redo update view column meta', async () => {
    const view = table.views[0];
    (
      await awaitWithEvent(() =>
        updateViewColumnMeta(table.id, view.id, [
          {
            fieldId: table.fields[1].id,
            columnMeta: {
              order: 10,
            },
          },
        ])
      )
    ).data;

    const fields = (await getFields(table.id, { viewId: view.id })).data;

    expect(fields[2].id).toEqual(table.fields[1].id);

    await undo(table.id);

    const fieldsAfterUndo = (await getFields(table.id, { viewId: view.id })).data;

    expect(fieldsAfterUndo[1].id).toEqual(table.fields[1].id);

    await redo(table.id);

    const fieldsAfterRedo = (await getFields(table.id, { viewId: view.id })).data;

    expect(fieldsAfterRedo[2].id).toEqual(table.fields[1].id);
  });

  it('should undo / redo update view order', async () => {
    const view = table.views[0];
    const view1 = (
      await awaitWithEvent(() =>
        createView(table.id, {
          type: ViewType.Grid,
          name: 'view1',
        })
      )
    ).data;

    (
      await awaitWithEvent(() =>
        updateViewOrder(table.id, view.id, { anchorId: view1.id, position: 'after' })
      )
    ).data;

    await undo(table.id);

    const viewsAfterUndo = (await getViewList(table.id)).data;
    expect(viewsAfterUndo[0].id).equal(view.id);

    await redo(table.id);

    const viewsAfterRedo = (await getViewList(table.id)).data;
    expect(viewsAfterRedo[1].id).equal(view.id);
  });

  describe('modify field constraint', () => {
    it('should undo modify field constraint', async () => {
      await awaitWithEvent(() =>
        convertField(table.id, table.fields[0].id, {
          ...table.fields[0],
          unique: true,
        })
      );

      await expect(
        updateRecords(table.id, {
          fieldKeyType: FieldKeyType.Id,
          records: [
            {
              id: table.records[0].id,
              fields: { [table.fields[0].id]: 'A' },
            },
            {
              id: table.records[1].id,
              fields: { [table.fields[0].id]: 'A' },
            },
          ],
        })
      ).rejects.toThrowError();

      await undo(table.id);

      await updateRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            id: table.records[0].id,
            fields: { [table.fields[0].id]: 'A' },
          },
          {
            id: table.records[1].id,
            fields: { [table.fields[0].id]: 'A' },
          },
        ],
      });
    });

    it('should redo modify field constraint', async () => {
      await awaitWithEvent(() =>
        convertField(table.id, table.fields[0].id, {
          ...table.fields[0],
          unique: true,
        })
      );

      await undo(table.id);
      await redo(table.id);

      await expect(
        updateRecords(table.id, {
          fieldKeyType: FieldKeyType.Id,
          records: [
            {
              id: table.records[0].id,
              fields: { [table.fields[0].id]: 'A' },
            },
            {
              id: table.records[1].id,
              fields: { [table.fields[0].id]: 'A' },
            },
          ],
        })
      ).rejects.toThrowError();
    });
  });

  describe('link related', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let table3: ITableFullVo;
    const refField1Ro: IFieldRo = {
      type: FieldType.SingleLineText,
    };

    const refField2Ro: IFieldRo = {
      type: FieldType.Number,
    };

    let refField1: IFieldVo;
    let refField2: IFieldVo;

    beforeEach(async () => {
      table1 = await createTable(baseId, { name: 'table1' });
      table2 = await createTable(baseId, { name: 'table2' });
      table3 = await createTable(baseId, { name: 'table3' });

      console.log('table1', table1.id);
      console.log('table2', table2.id);
      console.log('table3', table3.id);

      refField1 = (await createField(table1.id, refField1Ro)).data;
      refField2 = (await createField(table1.id, refField2Ro)).data;

      await updateRecordByApi(table1.id, table1.records[0].id, refField1.id, 'x');
      await updateRecordByApi(table1.id, table1.records[1].id, refField1.id, 'y');

      await updateRecordByApi(table1.id, table1.records[0].id, refField2.id, 1);
      await updateRecordByApi(table1.id, table1.records[1].id, refField2.id, 2);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
      await permanentDeleteTable(baseId, table3.id);
    });

    it('should undo / redo delete record with link', async () => {
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const linkField = (await createField(table1.id, linkFieldRo)).data;

      const record = await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });

      console.log('updated:record', record);
      await deleteRecord(table1.id, table1.records[0].id);

      await undo(table1.id);

      const recordAfterUndo = (
        await getRecord(table1.id, table1.records[0].id, { fieldKeyType: FieldKeyType.Id })
      ).data;
      expect(recordAfterUndo.fields[linkField.id]).toMatchObject({
        id: table2.records[0].id,
      });

      await redo(table1.id);

      const recordsAfterRedo = (
        await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id, viewId: table1.views[0].id })
      ).data;
      expect(recordsAfterRedo.records.length).toEqual(2);
    });

    it('should undo / redo convert link to single line text', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
      };

      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');

      const sourceLinkField = (await createField(table1.id, sourceFieldRo)).data;

      await updateRecordByApi(table1.id, table1.records[0].id, sourceLinkField.id, {
        id: table2.records[0].id,
      });

      const newLinkField = (
        await awaitWithEvent(() => convertField(table1.id, sourceLinkField.id, newFieldRo))
      ).data;

      await undo(table1.id);

      const newLinkFieldAfterUndo = (await getField(table1.id, newLinkField.id)).data;
      expect(newLinkFieldAfterUndo).toMatchObject(sourceLinkField);

      // make sure records has been updated
      const recordsAfterUndo = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id }))
        .data;
      expect(recordsAfterUndo.records[0].fields[newLinkFieldAfterUndo.id]).toEqual({
        id: table2.records[0].id,
        title: 'B1',
      });

      await redo(table1.id);

      const newLinkFieldAfterRedo = (await getField(table1.id, newLinkField.id)).data;

      expect(newLinkFieldAfterRedo).toMatchObject(newLinkField);

      // make sure records has been updated
      const recordsAfterRedo = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id }))
        .data;
      expect(recordsAfterRedo.records[0].fields[newLinkFieldAfterRedo.id]).toEqual('B1');
    });

    it('should undo / redo convert link when convert link from one table to another', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table3.id,
        },
      };

      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');
      // set primary key in table3
      await updateRecordByApi(table3.id, table3.records[0].id, table3.fields[0].id, 'C1');

      const sourceLinkField = (await createField(table1.id, sourceFieldRo)).data;

      const lookupFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: sourceLinkField.id,
        },
      };
      const sourceLookupField = (await awaitWithEvent(() => createField(table1.id, lookupFieldRo)))
        .data;

      const formulaLinkFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${sourceLinkField.id}}`,
        },
      };
      const formulaLookupFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${sourceLookupField.id}}`,
        },
      };

      const sourceFormulaLinkField = (
        await awaitWithEvent(() => createField(table1.id, formulaLinkFieldRo))
      ).data;
      const sourceFormulaLookupField = (
        await awaitWithEvent(() => createField(table1.id, formulaLookupFieldRo))
      ).data;

      await updateRecordByApi(table1.id, table1.records[0].id, sourceLinkField.id, {
        id: table2.records[0].id,
      });

      // make sure records has been updated
      const { records: rs } = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id })).data;
      expect(rs[0].fields[sourceLinkField.id]).toEqual({ id: table2.records[0].id, title: 'B1' });
      expect(rs[0].fields[sourceLookupField.id]).toEqual('B1');
      expect(rs[0].fields[sourceFormulaLinkField.id]).toEqual('B1');
      expect(rs[0].fields[sourceFormulaLookupField.id]).toEqual('B1');

      const newLinkField = (
        await awaitWithEvent(() => convertField(table1.id, sourceLinkField.id, newFieldRo))
      ).data;

      await undo(table1.id);

      const newLinkFieldAfterUndo = (await getField(table1.id, newLinkField.id)).data;

      expect(newLinkFieldAfterUndo).toMatchObject(sourceLinkField);
      const targetLookupFieldAfterUndo = (await getField(table1.id, sourceLookupField.id)).data;
      expect(targetLookupFieldAfterUndo.hasError).toBeUndefined();

      await redo(table1.id);

      const newLinkFieldAfterRedo = (await getField(table1.id, newLinkField.id)).data;

      expect(newLinkFieldAfterRedo).toMatchObject(newLinkField);

      await updateRecordByApi(table1.id, table1.records[0].id, newLinkFieldAfterRedo.id, {
        id: table3.records[0].id,
      });

      const targetLookupField = (await getField(table1.id, sourceLookupField.id)).data;
      const targetFormulaLinkField = (await getField(table1.id, sourceFormulaLinkField.id)).data;
      const targetFormulaLookupField = (await getField(table1.id, sourceFormulaLookupField.id))
        .data;

      expect(targetLookupField.hasError).toBeTruthy();
      expect(targetFormulaLinkField.hasError).toBeUndefined();
      expect(targetFormulaLookupField.hasError).toBeUndefined();

      // make sure records has been updated
      const { records } = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id })).data;
      expect(records[0].fields[newLinkFieldAfterRedo.id]).toEqual({
        id: table3.records[0].id,
        title: 'C1',
      });
      expect(records[0].fields[targetLookupField.id]).toEqual('B1');
      expect(records[0].fields[targetFormulaLinkField.id]).toEqual('C1');
      expect(records[0].fields[targetFormulaLookupField.id]).toEqual('B1');
    });

    it('should undo / redo convert two-way to one-way link', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: true,
        },
      };

      const sourceField = (await createField(table1.id, sourceFieldRo)).data;

      (await convertField(table1.id, sourceField.id, newFieldRo)).data;

      await undo(table1.id);

      const fieldAfterUndo = (await getField(table1.id, sourceField.id)).data;

      expect(fieldAfterUndo).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          isOneWay: false,
        },
      });

      await redo(table1.id);

      const fieldAfterRedo = (await getField(table1.id, sourceField.id)).data;

      expect(fieldAfterRedo).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          isOneWay: true,
        },
      });

      const symmetricFieldId = (fieldAfterRedo.options as ILinkFieldOptions).symmetricFieldId;
      expect(symmetricFieldId).toBeUndefined();
    });

    it('should undo / redo convert one-way link to two-way link', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: true,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: false,
        },
      };

      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'y');
      await updateRecordByApi(table2.id, table2.records[2].id, table2.fields[0].id, 'zzz');

      const sourceField = (await createField(table1.id, sourceFieldRo)).data;
      await updateRecordByApi(table1.id, table1.records[0].id, sourceField.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      await createField(table1.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: sourceField.id,
        },
      });
      await createField(table1.id, {
        type: FieldType.Rollup,
        options: {
          expression: `count({values})`,
          formatting: {
            precision: 2,
            type: 'decimal',
          },
        } as IRollupFieldOptions,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: sourceField.id,
        },
      });

      (await convertField(table1.id, sourceField.id, newFieldRo)).data;

      await undo(table1.id);
      const fieldAfterUndo = (await getField(table1.id, sourceField.id)).data;

      expect(fieldAfterUndo).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          isOneWay: true,
        },
      });

      // perform redo
      await redo(table1.id);
      const fieldAfterRedo = (await getField(table1.id, sourceField.id)).data;

      expect(fieldAfterRedo).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          isOneWay: false,
        },
      });

      const symmetricFieldId = (fieldAfterRedo.options as ILinkFieldOptions).symmetricFieldId;
      expect(symmetricFieldId).toBeDefined();

      const symmetricField = (await getField(table2.id, symmetricFieldId as string)).data;

      expect(symmetricField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1.id,
          lookupFieldId: table1.fields[0].id,
        },
      });

      const { records } = (await getRecords(table2.id, { fieldKeyType: FieldKeyType.Id })).data;
      expect(records[0].fields[symmetricField.id]).toMatchObject({ id: table1.records[0].id });
      expect(records[1].fields[symmetricField.id]).toMatchObject({ id: table1.records[0].id });
    });
  });
});
